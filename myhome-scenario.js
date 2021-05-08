/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  const LONGPRESS_ONGOING_INTERVAL = 400;

  function MyHomeScenarioNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

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
    runningMonitor.addMonitoredEvent ('OWN_SCENARIO', listenerFunction);

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
      let multiOutput = [];
      let processedPackets = 0;
      for (let curPacket of (typeof(packet) === 'string') ? [packet] : packet) {
        let curButtonID = '';
        let curActionType = '';
        let nodeStatusIcon = ['grey','ring'];
        let nodeStatusText = '';
        let packetMatch;
        let curButtonLastState;
        // Checks 1 : Basic scenario (CEN) [*15*WHAT(#<ACTION_TYPE>)*WHERE##]
        //    - WHAT = push button N value [00-31]
        //    - <ACTION_TYPE> = 1: Release after short pressure (<0.5s) / 2: Release after an extended pressure (>= 0.5s) / 3: Extended pressure (sent every 0.5s as long as button is pressed)
    		//    - WHERE = push button virtual address (A/PL)
        packetMatch = curPacket.match ('^\\*15\\*(\\d+)#{0,1}(\\d|)\\*' + config.scenarioid + '##');
        if (packetMatch !== null) {
          curButtonID = packetMatch[1];
          switch (packetMatch[2]) {
            case '1':
              // Release after short pressure (<0.5s)
              curActionType = 'SHORT';
              break;
            case '2':
              // Release after an extended pressure (>= 0.5s)
              curActionType = 'LONG';
              break;
            case '3':
              // Extended pressure (sent every 0.5s as long as button is pressed)
              curActionType = 'LONG_ONGOING';
              break;
            default:
              // no param provided, means initial pressure
              curActionType = 'PRESS_START';
          }
        }
        // Checks 2 : Advanced scenario (CEN+) [*25*<ACTION_TYPE>#WHAT*WHERE##]
        //    - <ACTION_TYPE> = 21: Short pressure (<0.5s) / 22: Start of extended pressure (>= 0.5s) / 23: Extended pressure (sent every 500ms) / 24: Release after an extended pressure
        //    - WHAT = push button N value [00-31]
        //    - WHERE = 2 [0-2047] Virtual Address
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*25\\*(\\d\\d)#(\\d)\\*2' + config.scenarioid + '##');
          if (packetMatch !== null) {
            curButtonID = packetMatch[2];
            switch (packetMatch[1]) {
              case '21':
                // Short pressure (<0.5s)
                curActionType = 'SHORT';
              break;
              case '22':
                // Start of extended pressure (>= 0.5s)
                curActionType = 'LONG_START';
                break;
              case '23':
                // Extended pressure (sent every 0.5s as long as button is pressed)
                curActionType = 'LONG_ONGOING';
                break;
              case '24':
                // Release after an extended pressure
                curActionType = 'LONG';
                break;
            }
          }
        }
        // If we reached here with a non null match, it means command was useful for node
        if (packetMatch !== null) {
          processedPackets++;
          // Define action info based on type
          curButtonLastState = payloadInfo['buttonsLastState_' + curButtonID] || {};
          switch (curActionType) {
            case 'SHORT':
              // Short pressure (<0.5s)
              curButtonLastState = {};
              curButtonLastState.actionStart = Date.now();
              curButtonLastState.actionEnd = Date.now();
              nodeStatusText = 'short pressed (<0.5s)';
              break;
            case 'LONG_START':
              // Start of extended pressure (>= 0.5s)
              curButtonLastState = {};
              curButtonLastState.actionStart = Date.now();
              nodeStatusText = 'long pressed (>0.5s) started';
              break;
            case 'LONG_ONGOING':
              // Extended pressure (sent every 0.5s as long as button is pressed)
              curButtonLastState.actionEnd = Date.now();
              curButtonLastState.countExtPressures = (curButtonLastState.countExtPressures||0) + 1;
              nodeStatusText = 'long pressed going on';
              break;
            case 'LONG':
              // Release after an extended pressure
              curButtonLastState.actionEnd = Date.now();
              nodeStatusText = 'long pressed';
              break;
          }
          // Append info which are common to all states
          curButtonLastState.buttonID = parseInt(curButtonID);
          curButtonLastState.actionType = curActionType;
          curButtonLastState.actionDuration = (curButtonLastState.actionEnd - curButtonLastState.actionStart) || 0;
          curButtonLastState.state = curButtonLastState.actionType + ((curButtonLastState.actionDuration > 0) ? ':' + curButtonLastState.actionDuration.toString() : '');
          nodeStatusText = 'Button #' + curButtonLastState.buttonID + ': '+ nodeStatusText + ((curButtonLastState.actionDuration > 0) ? ' (' + (curButtonLastState.actionDuration/1000).toFixed(1).toString() + 's)': '');
          payloadInfo['buttonsLastState_' + curButtonID] = curButtonLastState;

          // See if such action is monitored for a defined rule to be sent to a secondary output
          for (let i = 0; i < config.rules.length; i++) {
            multiOutput[i+1] = null;
            let curRule = config.rules[i];
            // Check whether pressed button is within a range this rule must monitor
            if (curButtonLastState.buttonID < curRule.buttonFrom && curButtonLastState.buttonID > curRule.buttonTo) {
              continue;
            }
            // Check whether action is a monitored one
            let toMonitor = false;
            if (curButtonLastState.actionType == 'SHORT' && curRule.onEndShortPress) {
              toMonitor = true;
            } else if ((curButtonLastState.actionType == 'LONG_START' || curButtonLastState.actionType == 'PRESS_START') && curRule.onStartPress) {
              toMonitor = true;
            } else if (curButtonLastState.actionType == 'LONG_ONGOING' && curRule.onDuringLongPress) {
              toMonitor = true;
            } else if (curButtonLastState.actionType == 'LONG' && curRule.onEndLongPress) {
              if (curButtonLastState.actionDuration >= curRule.minLongPressDuration) {
                toMonitor = true;
              }
            }
            // Reached here : monitored action, build payload
            if (toMonitor) {
              let curMsg = multiOutput[i+1] = {};
              curMsg.payload = curButtonLastState.state;
              nodeStatusIcon[0] = 'green';
            }
          }
          // Update Node displayed status
          node.status ({fill: nodeStatusIcon[0], shape: nodeStatusIcon[1], text: nodeStatusText});
        }
      }
      // Checks : all done, if nothing was processed, abord (no node / flow update detected), excepted when refresh is 'forced'
      if (processedPackets === 0 && !forceRefreshAndMsg) {
        return;
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
          Object.getOwnPropertyNames(payloadInfo).forEach ( function(objectName , i) {
          	if (objectName.match('buttonsLastState_\\d+')) {
              payload[objectName] = payloadInfo[objectName];
          	}
          });
          // MSG1 : Add misc info and add primary output to outputs
          msg.topic = 'state/' + config.topic;
          multiOutput[0] = msg;

          // Store last sent payload info & send both msg to output1 and output2
          node.lastPayloadInfo = newPayloadinfo;
          node.send(multiOutput);
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

      // Get payload and apply conversions (asked state can be set in 'msg.payload' or 'msg.payload.state'
      if (msg.payload === undefined) {
        msg.payload = {};
      } else if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) === 'string' || typeof(msg.payload) === 'number') {
        msg.payload = {'state': msg.payload.toString()};
        // Get values of buttonID and duration from payload text to object (assumig structure is 'ButtonID:Duration')
        if (typeof(msg.payload.state) === 'string') {
          let stateValue = msg.payload.state.split(/:|,|;/);
          msg.payload.buttonID = stateValue[0];
          msg.payload.actionDuration = parseInt(stateValue[1]) || 0;
        }
      }
      let payload = msg.payload;

      let commands = [];
      if (!isReadOnly) {
        // Ensure data is valid to build command
        if (isNaN (payload.buttonID) || parseInt(payload.buttonID) < 0 || parseInt(payload.buttonID) > 31) {
          node.warn ('Button ID (' + payload.buttonID + ') is invalid or not in allowed [0-31] range.');
          return;
        }
        // Duration defaults to 0
        let actionDuration = parseInt(payload.actionDuration) || 0;
        if (actionDuration < 500) {
          // Command must be sent in short press mode
          commands.push ('TODO COMMAND TO BE BUILT = SHORT');
        } else {
          // Command must be sent in long press mode (we need to have a repeat command sent at least every 500ms)
          commands.push ('TODO COMMAND TO BE BUILT @START');
          while (actionDuration > LONGPRESS_ONGOING_INTERVAL) {
            commands.push ('TODO COMMAND TO BE BUILT @REPEAT');
            actionDuration = actionDuration - LONGPRESS_ONGOING_INTERVAL;
          }
          commands.push ('TODO COMMAND TO BE BUILT @END');
        }
      }
      // when no command to send (and not working in read only mode where we only send current node info), abord
      if (commands.length === 0 & !isReadOnly) {
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
      node.on('close', function (done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType ('myhome-scenario', MyHomeScenarioNode);
  };
