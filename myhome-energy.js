/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeEnergyNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // Build the meter used 'WHERE'. If node is configured as being an actuator, is '7N#0' , and '5N' for power meters,
    // where N is the ID number [1-255].
    node.meterid = ((config.metertype === 'actuator') ? ('7' + config.meterid + '#0') : ('5'+ config.meterid));

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
    runningMonitor.addMonitoredEvent ('OWN_ENERGY', listenerFunction);

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
// ?? to keep      payloadInfo.powerTotal_Wh = 0;
      for (let curPacket of (typeof(packet) === 'string') ? [packet] : packet) {
        let packetMatch = null;

        switch (config.meterscope) {
          case 'instant':
            // Check 1 [WHAT=113] : Current power consumption (Instant, in Watts) [*#18*<Where>*113*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*113\\*(\\d+)##');
            if (packetMatch !== null) {
              payloadInfo.powerInstant = parseInt(packetMatch[1]);
            }
            break;
          case 'day_current':
            // Check 2 [WHAT=54] : Current daily consumption (today, in Wh) [*#18*where*54*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*54\\*(\\d+)##');
            if (packetMatch !== null) {
              payloadInfo.powerDay_Wh = parseInt(packetMatch[1]);
              payloadInfo.powerDay_Date = new Date();
            }
            break;
          case 'day':
            // Check 3 [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>*<Tag>*<Val>##]
            //            with <Tag> is the hour [1-24], '25' being day total <Val> =WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*511#(\\d{1,2})#(\\d{1,2})\\*(\\d{1,2})\\*(\\d+)##');
            if (packetMatch !== null) {
              payloadInfo.powerDay_Wh = parseInt(packetMatch[4]);
              payloadInfo.powerDay_Date = new Date(new Date().getFullYear() , packetMatch[1] , packetMatch[2] , packetMatch[3]);
            }
            break;
          case 'month_current':
            // Check 4 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53*<Val>##] with <Val> = WATT)
            //            with <Tag> is the hour [1-24], '25' being day total <Val> =WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*53\\*(\\d+)##');
            if (packetMatch !== null) {
              payloadInfo.powerMonth_Wh = parseInt(packetMatch[1]);
              payloadInfo.powerMonth_Date = new Date();
            }
            break;
          case 'month':
            // Checks 5 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>*<Val>##]	with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*52#(\\d{2})#(\\d{1,2})\\*(\\d+)##');
            if (packetMatch !== null) {
              payloadInfo.powerMonth_Wh = parseInt(packetMatch[3]);
              payloadInfo.powerMonth_Date = new Date('20'+packetMatch[1] , packetMatch[2]);
            }
            break;
          case 'sincebegin':
            // Checks 6 [WHAT=51] : Full consumption since begin (up to today, in Wh) [*#18*where*51*<Val>##]	with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*51\\*(\\d+)##');
            if (packetMatch !== null) {
              payloadInfo.powerSinceBegin_Wh = parseInt(packetMatch[1]);
            }
            break;
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
      if (typeof (payloadInfo.powerInstant) === 'number') {
        // Instant power consumption was meterd, display info
        let timeInfo = new Date().toLocaleTimeString();
        node.status ({fill: 'grey', shape: 'ring', text: timeInfo + ': ' + payloadInfo.powerInstant.toLocaleString() + 'W'});
      } else if (payloadInfo.xxxxxxx === 'xxxxx') {
        // if (payloadInfo.brightness) {
        //   // Dimmed light, include brightness in state
        //   node.status ({fill: 'yellow', shape: 'dot', text: 'On (' + payloadInfo.brightness +'%)'});
        // } else {
        //   // No brightness provided : is a simple 'ON' state
        //   node.status ({fill: 'yellow', shape: 'dot', text: 'On'});
        // }
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

          // TODO : current raw transfer of all data is made for debug / analysis
          Object.getOwnPropertyNames(payloadInfo).forEach (function(objectName , i) {
            payload[objectName] = payloadInfo[objectName];
          });
          // END // TODO:

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
      let isReadOnly = false;
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
            cmd_what = '1';
        }
        if (cmd_what) {
          commands.push ('*1*' + cmd_what + '*' + node.lightgroupid + '##');
        }
      }
      if (isReadOnly || commands.length) {
        // In Read-Only mode : build a status enquiry request (no status update sent)
        // In Write mode : Since the gateway does not 'respond' when changing point state, we also add a second call to ask for point status after update.
        commands.push ('*#1*' + node.lightgroupid + '##');
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
