/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeShutterNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Register node for updates
    node.on ('input', function (msg) {
      node.processInput (msg);
    });

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Add listener on node linked to a dedicated function call to be able to remove it on close
    if (!config.skipevents) {
      const listenerFunction = function (packet) {
        let msg = {};
        node.processReceivedBUSCommand (msg, packet);
      };
      runningMonitor.addMonitoredEvent ('OWN_SHUTTERS', listenerFunction);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a MyHome BUS command is received /////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processReceivedBUSCommand = function (msg, packet) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;

      // Build the light point name. If node is configured as being a group, add '#' as prefix
      let shuttergroupid = ((config.isgroup) ? '#' : '') + config.shutterid;

      // Check whether received command is linked to current configured node shutter group/id
      let m = packet.match ('^\\*2\\*(\\d+)\\*(' + shuttergroupid + '|0)##');
      if (m === null) {
        return;
      }

      switch (m[1]) {
        case '0':
          // STOP
          payload.state = 'STOP';
          node.status ({fill: 'grey', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'Stopped'});
          break;
        case '1':
          // OPEN
          payload.state = 'OPEN';
          node.status ({fill: 'yellow', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'Opened'});
          break;
        case '2':
          // CLOSE
          payload.state = 'CLOSE';
          node.status ({fill: 'grey', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'Closed'});
          break;
        default:
      }
      // Additional info : include initial SCS/BUS message which was read in payload
      payload.command_received = packet;
      // Build secondary payload
      let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'OPEN', 'CLOSE');

      msg.topic = 'state/' + config.topic;
      node.send ([msg, msg2]);
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a message (payload) is received from the node-RED flow ///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processInput = function (msg) {
      if (typeof(msg) === 'string') {
        try {msg = JSON.parse(msg);} catch(error){}
      }
      // Only process input received from flow when the topic matches with configuration of nodes
      if (msg.topic !== 'cmd/' + config.topic) {
        return;
      }
      // Get payload and apply conversions (asked state can be set in 'msg.payload',
      // 'msg.payload.state' or 'msg.payload.On', value being either true/false or OPEN/CLOSE/STOP
      // Final result is always kept in 'msg.payload.state' = 'OPEN', 'CLOSE' or 'STOP'
      if (msg.payload === undefined) {
        msg.payload = {};
      } else if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) === 'object') {
        if (msg.payload.state === undefined && msg.payload.On !== undefined) {
          msg.payload.state = (msg.payload.On) ? 'OPEN' : 'CLOSE';
        }
      } else if (typeof(msg.payload) === 'boolean') {
        msg.payload = {'state': (msg.payload) ? 'OPEN' : 'CLOSE'};
      } else if (typeof(msg.payload) === 'string') {
        msg.payload = {'state': msg.payload};
      }
      let payload = msg.payload;
      let nodestatusinfo = '';

      // Build the OpenWebNet command to be sent
      let shuttergroupid = ((config.isgroup) ? '#' : '') + config.shutterid;
      let command = '';
      if (config.isstatusrequest) {
        // Working in read-only mode: build a status enquiry request (no status update sent)
        nodestatusinfo = 'status refresh requested';
        command = '*#2*' + shuttergroupid + '##';
      } else if (payload.state === 'OPEN') {
        nodestatusinfo = 'command sent (Open)';
        command = '*2*1*' + shuttergroupid + '##';
      } else if (payload.state === 'CLOSE') {
        nodestatusinfo = 'command sent (Close)';
        command = '*2*2*' + shuttergroupid + '##';
      } else if (payload.state === 'STOP') {
        nodestatusinfo = 'command sent (Stop)';
        command = '*2*0*' + shuttergroupid + '##';
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
          // When running in status refresh mode, if we received an update, we process it as it was received by the bus
          // This also means process stops here and msg will be output by the called function itself
          if (cmd_responses.length) {
            node.processReceivedBUSCommand (msg, cmd_responses[0]);
            return;
          }
          // Build secondary payload
          let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'OPEN', 'CLOSE');
          // When node is configured to skip BUS/SCS updates, we update the status on node itself
          // (when node monitors BUS/SCS updates, the status gets updated through the command being monitored by the gateway, which starts a node refresh)
          if (config.skipevents) {
            node.status ({fill: (payload.state === 'OPEN') ? 'yellow' : 'grey', shape: 'ring', text: nodestatusinfo});
          }
          // Send both outputs
          node.send ([msg, msg2]);
        }, function (sdata, command, errorMsg) {
          node.error ('command [' + command + '] failed : ' + errorMsg);
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: 'command failed: ' + command});
        });
      };

      //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
      node.on ('close', function(done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType('myhome-shutter', MyHomeShutterNode);
  };
