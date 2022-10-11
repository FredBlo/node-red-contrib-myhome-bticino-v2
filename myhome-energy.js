/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeEnergyNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // Build the light point name. If node is configured as being a group, add '#' as prefix.
    // When NOT working on private riser, include the bus level (with suffix '#4#xx' where xx is the BUS id)
    let buslevel = config.buslevel || 'private_riser';
    node.lightgroupid = ((config.isgroup) ? '#' : '') + config.lightid + ((buslevel === 'private_riser') ? '' : '#4#' + buslevel);

    // All current zone received values stored in memory from the moment node is loaded
    let payloadInfo = node.payloadInfo = {};
    payloadInfo.state = '?';
    node.lastPayloadInfo = JSON.stringify (payloadInfo); // SmartFilter : kept in memory to be able to compare whether an update occurred while processing msg

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Register node for updates
    node.on ('input', function (msg) {
      node.processInput (msg);
    });

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Add listener on node linked to a dedicated function call to be able to remove it on close
    const listenerFunction = function (packet) {
      let msg = {};
      node.processReceivedBUSCommand (msg, packet);
    };
    runningMonitor.addMonitoredEvent ('OWN_LIGHTS', listenerFunction);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a MyHome BUS command is received /////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processReceivedBUSCommand = function (msg, packet) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;
      // When the msg contains a topic with specified 'state/', it means function was called internally (from 'processInput') to refresh values.
      // In this case, even if no packet is found to update something, node is refreshed and msg are sent
      let forceRefreshAndMsg = (msg.topic === 'state/' + config.topic);

      // Check whether received command is linked to current configured light point
      let processedPackets = 0;
      for (let curPacket of (typeof(packet) === 'string') ? [packet] : packet) {
        let packetMatch;
        // Checks 1 : Light point/group update [*1*<status>|<dimmerLevel10>*where##]
        //    - <status> [0-1] : 0 = OFF / 1 = ON
        //    - <dimmerLevel10> [2-10] : 2 = 20% / 3 = 30% / ... / 9 = 90% / 10 = 100%
        // Note : the RegEx must only keep 2 characters when <status> begins with 1 to skip 30 or 31 since these are dimming UP / DOWN
        packetMatch = curPacket.match ('^\\*1\\*(\\d|1\\d)\\*(' + node.lightgroupid + '|0)##');
        if (packetMatch !== null) {
          if ((packetMatch[1] === '0') || (packetMatch[1] === '1')) {
            payloadInfo.state = (packetMatch[1] === '1') ? 'ON' : 'OFF';
          } else {
            payloadInfo.state = 'ON';
            payloadInfo.brightness = (parseInt(packetMatch[1]) * 10);
          }
        }
        // Checks 2 : Light point/group dimmer info update [*#1*<where>*1*<dimmerLevel100>*<dimmerSpeed>##]
        //    - <dimmerLevel100> [100-200] : 100 = off / 200 = Max
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*#1\\*' + node.lightgroupid + '\\*1\\*(\\d+)\\*\\d+##');
          if (packetMatch !== null) {
            payloadInfo.state = 'ON';
            payloadInfo.brightness = (parseInt(packetMatch[1]) - 100);
          }
        }
        // If we reached here with a non null match, it means command was useful for node
        if (packetMatch !== null) {
          processedPackets++;
        }
      }
      // Checks : all done, if nothing was processed, abord (no node / flow update detected), excepted when refresh is 'forced'
      if (processedPackets === 0 && !forceRefreshAndMsg) {
        return;
      }

      // Update Node displayed status
      if (payloadInfo.state === 'OFF') {
        // turned OFF is the same for all lights (dimmed or not)
        node.status ({fill: 'grey', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'Off'});
      } else if (payloadInfo.state === 'ON') {
        if (payloadInfo.brightness) {
          // Dimmed light, include brightness in state
          node.status ({fill: 'yellow', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'On (' + payloadInfo.brightness +'%)'});
        } else {
          // No brightness provided : is a simple 'ON' state
          node.status ({fill: 'yellow', shape: (config.isgroup) ? 'ring' : 'dot', text: ((config.isgroup) ? 'group info: ' : '') + 'On'});
        }
      }

      // Send msg back as new flow : only send update as new flow when something changed after having received this new BUS info
      // (but always send it when SmartFilter is disabled or when running in 'state/' mode, i.e. read-only mode)
      if (!config.skipevents || forceRefreshAndMsg) {
        let newPayloadinfo = JSON.stringify (payloadInfo);
        if (!config.smartfilter || newPayloadinfo !== node.lastPayloadInfo || forceRefreshAndMsg) {
          // MSG1 : Build primary msg
          // MSG1 : Received command info : only include source command when was provided as string (when is an array, it comes from .processInput redirected here)
          if (!Array.isArray(packet)) {
            payload.command_received = packet;
          }
          // MSG1 : Add all current node stored values to payload
          payload.state = payloadInfo.state;
          if (payloadInfo.brightness !== undefined) {
            payload.brightness = payloadInfo.brightness;
          }
          // MSG1 : Add misc info
          msg.topic = 'state/' + config.topic;

          // MSG2 : Build secondary payload
          let msg2 = mhutils.buildSecondaryOutput (payloadInfo, config, 'On', 'ON', 'OFF');

          // Store last sent payload info & send both msg to output1 and output2
          node.lastPayloadInfo = newPayloadinfo;
          node.send ([msg, msg2]);
        }
      }
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a message (payload) is received from the node-RED flow ///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processInput = function (msg) {
      if (typeof(msg) === 'string') {
        try {msg = JSON.parse(msg);} catch(error){}
      }
      // Only process input received from flow when the topic matches with configuration of nodes
      let isReadOnly = config.isstatusrequest || false;
      if (msg.topic === 'state/' + config.topic) {
        // Running in 'state/' mode, force read-only regardless of node config mode
        isReadOnly = true;
      } else if (msg.topic !== 'cmd/' + config.topic) {
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
      } else if (!isNaN(msg.payload)) {
        if (msg.payload == 0) {
          msg.payload = {'state': 'OFF','brightness': 0};
        } else {
          msg.payload = {'state': 'ON','brightness': parseInt(msg.payload)};
        }
      } else if (typeof(msg.payload) === 'string') {
        msg.payload = {'state': msg.payload};
      }
      let payload = msg.payload;

      let commands = [];
      if (!isReadOnly) {
        // Working in update mode: build the status change request
        let cmd_what = '';
        if (payload.state === 'OFF') {
          // turning OFF is the same for all lights (dimmed or not)
          cmd_what = '0';
        } else if (payload.state === 'ON') {
          if(payload.brightness) {
            // Brightness is provided in %, convert it to WHAT command (from min 2 (20%) to max 10 (100%))
            let requested_brightness = Math.round(parseInt(payload.brightness)/10);
            if (requested_brightness < 2) {
              requested_brightness = 2;
            } else if (requested_brightness > 10) {
              requested_brightness = 10;
            }
            cmd_what = requested_brightness.toString();
          } else {
            // No brightness provided : is a simple 'ON' call
            cmd_what = '1';
          }
        } else if (payload.state === 'UP') {
          // Working in dimmer : dimming UP
          cmd_what = '30';
        } else if (payload.state === 'DOWN') {
          // Working in dimmer : dimming DOWN
          cmd_what = '31';
        }
        if (cmd_what) {
          commands.push ('*1*' + cmd_what + '*' + node.lightgroupid + '##');
        }
      }
      if ((isReadOnly || commands.length) && !config.isgroup) {
        // In Read-Only mode : build a status enquiry request (no status update sent)
        // In Write mode : Since the gateway does not 'respond' when changing point state, we also add a second call to ask for point status after update.
        // Note : This does not work for groups
        if (!config.isgroup) {
          commands.push ('*#1*' + node.lightgroupid + '##');
        }
      }
      if (commands.length === 0) {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, commands, gateway, 0, false,
        function (commands, cmd_responses, cmd_failed) {
          // Build main payload to return payloads to outputs
          payload.command_sent = commands; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          if (cmd_failed.length) {
            // Also add failed requests, but only if some failed
            payload.command_failed = cmd_failed;
          }
          // Once commands were sent, call internal function to force node info refresh (using 'state/') and msg outputs
          msg.topic = 'state/' + config.topic;
          node.processReceivedBUSCommand (msg, cmd_responses);
        }, function (cmd_failed, nodeStatusErrorMsg) {
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: nodeStatusErrorMsg});
        });
      };

      //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
      node.on ('close', function (done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType ('myhome-energy', MyHomeEnergyNode);
  };
