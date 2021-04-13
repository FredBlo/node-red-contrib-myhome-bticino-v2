/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeLightNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // Register node for updates
    node.on ('input', function (msg) {
      node.processInput (msg);
    });

    // Add listener on node linked to a dedicated function call to be able to remove it on close
    if (!config.skipevents) {
      const listenerFunction = function (packet) {
        let msg = {};
        node.processReceivedBUSCommand (msg, packet);
      };
      runningMonitor.addMonitoredEvent ('OWN_LIGHTS', listenerFunction);
    }

    // Function called when a MyHome BUS command is received
    this.processReceivedBUSCommand = function (msg, packet) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;

      // Build the light point name. If node is configured as being a group, add '#' as prefix
      let lightgroupid = ((config.isgroup) ? '#' : '') + config.lightid;

      // check if message is a status update
      if (new RegExp ('^\\*1\\*(\\d+)\\*(' + lightgroupid + '|0)##').test(packet) || // simple light status
        new RegExp ('^\\*#1\\*' + lightgroupid + '\\*1\\*(\\d+)\\*\\d+##').test(packet)) {  // dimmer updates

        let what = '';
        if(packet[1] === '#') {
          what = packet.match ('^\\*#1\\*' + lightgroupid + '\\*1\\*(\\d+)\\*\\d+##')[1];

          payload.state = 'ON';
          payload.brightness = (parseInt(what) - 100);
        } else {
          what = packet.match('^\\*1\\*(\\d+)\\*(' + lightgroupid + '|0)##')[1];

          if((what === '0') || (what === '1')) {
            payload.state = (what === '1') ? 'ON' : 'OFF';
          } else {
            payload.state = 'ON';
            payload.brightness = (parseInt(what) * 10);
          }
        }
        // Additional info : include initial SCS/BUS message which was read in payload
        payload.command_received = packet;
        // Build secondary payload
        let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'ON', 'OFF');

        // Update Node displayed status
        if (payload.state === 'OFF') {
          // turned OFF is the same for all lights (dimmed or not)
          node.status ({fill: 'grey', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'Off'});
        } else if (payload.state === 'ON') {
          if(payload.brightness) {
            // Dimmed light, include brightness in state
            node.status ({fill: 'yellow', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'On (' + payload.brightness +'%)'});
          } else {
            // No brightness provided : is a simple 'ON' state
            node.status ({fill: 'yellow', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'On'});
          }
        }
        msg.topic = 'state/' + config.topic;
        node.send ([msg, msg2]);
        return;
      }
    };

    // Function called when a message (payload) is received from the node-RED flow
    this.processInput = function (msg) {
      if (typeof(msg) === 'string') {
        try {msg = JSON.parse(msg);} catch(error){}
      }
      // Only process input received from flow when the topic matches with configuration of nodes
      if (msg.topic !== 'cmd/' + config.topic) {
        return;
      }
      // Get payload and apply conversions (asked state can be set in 'msg.payload',
      // 'msg.payload.state' or 'msg.payload.On', value being either true/false or ON/OFF
      // Final result is always kept in 'msg.payload.state' = 'ON' or 'OFF'
      if (msg.payload === undefined) {
        msg.payload = {};
      } else if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) === 'object') {
        if (msg.payload.state === undefined && msg.payload.On !== undefined) {
          msg.payload.state = (msg.payload.On) ? 'ON' : 'OFF';
        }
      } else if (typeof(msg.payload) === 'boolean') {
        msg.payload = {'state': (msg.payload) ? 'ON' : 'OFF'};
      } else if (typeof(msg.payload) === 'string') {
        msg.payload = {'state': msg.payload};
      }
      let payload = msg.payload;
      let nodestatusinfo = '';

      // Build the OpenWebNet command to be sent
      let lightgroupid = ((config.isgroup) ? '#' : '') + config.lightid;
      let command = '';
      if (config.isstatusrequest) {
        // Working in read-only mode: build a status enquiry request (no status update sent)
        nodestatusinfo = 'status refresh requested';
        command = '*#1*' + lightgroupid + '##';
      } else {
        // Working in update mode: build the status change request
        let cmd_what = '';
        if (payload.state === 'OFF') {
          // turning OFF is the same for all lights (dimmed or not)
          cmd_what = '0';
          nodestatusinfo = 'command sent (Off)';
        } else if (payload.state === 'ON') {
          nodestatusinfo = 'On';
          if(payload.brightness) {
            // Brightness is provided in %, convert it to WHAT command (from min 2 (20%) to max 10 (100%))
            var requested_brightness = Math.round(parseInt(payload.brightness)/10);
            if (requested_brightness < 2) {
              requested_brightness = 2;
            } else if (requested_brightness > 10) {
              requested_brightness = 10;
            }
            cmd_what = requested_brightness.toString();
            nodestatusinfo = 'command sent (On - '+ requested_brightness*10 + '%)';
          } else {
            // No brightness provided : is a simple 'ON' call
            nodestatusinfo = 'command sent (On)';
            cmd_what = '1';
          }
        }
        if (cmd_what) {
          command = '*1*' + cmd_what + '*' + lightgroupid + '##';
        }
      }
      if (command === '') {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, command, gateway, false,
        function (sdata, command, cmd_responses) {
          // Return values to both outputs
          // Build main payload
          payload.command_sent = command; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          msg.topic = 'state/' + config.topic;
          if (requested_brightness) {
            payload.brightness = requested_brightness*10;
          }
          // When running in status refresh mode, if we received an update, we process it as it was received by the bus
          // This also means process stops here and msg will be output by the called function itself
          if (cmd_responses.length) {
            node.processReceivedBUSCommand (msg, cmd_responses[0]);
            return;
          }
          // Build secondary payload
          let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'ON', 'OFF');
          // When node is configured to skip BUS/SCS updates, we update the status on node itself
          // (when node monitors BUS/SCS updates, the status gets updated through the command being monitored by the gateway, which starts a node refresh)
          if (config.skipevents) {
            node.status ({fill: (payload.state === 'ON') ? 'yellow' : 'grey', shape: 'ring', text: nodestatusinfo});
          }
          // Send both outputs
          node.send([msg, msg2]);
        }, function (sdata, command, errorMsg) {
          node.error ('command [' + command + '] failed : ' + errorMsg);
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: 'command failed: ' + command});
        });
      };

      node.on('close', function(done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType ('myhome-light', MyHomeLightNode);
  };
