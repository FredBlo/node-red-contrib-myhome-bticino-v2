/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeTemperatureNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // All current zone received values stored in memory from the moment node is loaded
    let payloadInfo = node.payloadInfo = {};
    payloadInfo.state = '?';
    payloadInfo.remoteControl = '?';
    payloadInfo.operationMode = '?';
    // payloadInfo.setTemperature = '?';
    // payloadInfo.localOffset_ownValue = '?';
    // payloadInfo.localOffset = '?';
    // payloadInfo.operationType_ownValue = '?';
    // payloadInfo.operationType = '?';
    // payloadInfo.actuatorStates = {};
    // payloadInfo.actuatorStates.On = false;
    // payloadInfo.operationMode_ownValue = '?';
    // payloadInfo.operationMode = '?';
    node.lastPayloadInfo = JSON.stringify (payloadInfo); // SmartFilter : kept in memory to be able to compare whether an update occurred while processing msg

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
      runningMonitor.addMonitoredEvent ('OWN_TEMPERATURE', listenerFunction);
    }

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

      // Check whether received command is linked to current configured Zone
      let processedPackets = 0;
      for (let curPacket of (typeof(packet) === 'string') ? [packet] : packet) {
        let packetMatch;
        // Checks 1 : current central unit status info frames (OpenWebNet doc) : reading '*4*what*#0##' with what in 2 digits mode
        // what: 20 = Remote control disabled / 21 = Remote control enabled / 22 = At least one probe OFF /
        //       23 = At least one probe in protection / 24 = At least one probe in manual / 30 = Failure discovered / 31 = Central Unit battery KO
        packetMatch = curPacket.match ('^\\*4\\*(\\d\\d)\\*#0##');
        if (packetMatch !== null) {
          if (packetMatch[1] === '20') {
            payloadInfo.remoteControl = false;
          } else if (packetMatch[1] === '21') {
            payloadInfo.remoteControl = true;
          } else {
            // We do not manage the other 2 digits ones
          }
        }

        // Checks 2 : Central Unit’s operation mode : '*4*what*#0##' with what in 3-4 digits (and sub info)
        // what: 110#T = Manual Heating / 210#T = Manual Conditioning
        //       103 = Off Heating / 203 = Off Conditioning / 102 = Antifreeze / 202 = Thermal Protection
        //       [1101-1103] = Memo program in Heating mode / [2101-2103] = Memo program in Conditioning mode
        //       [1201-1216] = Memo scenario in Heating mode / [2201-2216] = Memo scenario in Conditioning mode
        //       115#[1101-1103] = Holiday Heating [program on return] / 215#[2101-2103] = Holiday Conditioning  [program on return] / ... (and some more for holidays)
        //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
        //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*4\\*((\\d\\d\\d)(\\d)|(\\d+)#(\\d+))\\*#0##');
          if (packetMatch !== null) {
            payloadInfo.operationMode_ownValue = packetMatch[2];
            let operationMode_List = [];
            operationMode_List[0] = ['110' , 'Manual Heating' , packetMatch[3]];
            operationMode_List[1] = ['210' , 'Manual Conditioning ' , packetMatch[3]];
            operationMode_List[2] = ['103' , 'Off Heating' , ''];
            operationMode_List[3] = ['203' , 'Off Conditioning' , ''];
            operationMode_List[4] = ['102' , 'Antifreeze' , ''];
            operationMode_List[5] = ['202' , 'Thermal Protection' , ''];
            operationMode_List[6] = ['110' , 'Heating mode Program' , packetMatch[3]];
            operationMode_List[7] = ['210' , 'Conditioning mode Program' , packetMatch[3]];
            operationMode_List[8] = ['120' , 'Heating mode Scenario' , packetMatch[3]];
            operationMode_List[9] = ['220' , 'Conditioning mode Scenario' , packetMatch[3]];

            for (let i = 0; i < operationMode_List.length; i++) {
              if (operationMode_List[i][0] == payloadInfo.operationType_ownValue) {
                payloadInfo.operationMode = operationMode_List[i][1];
                break;
              }
            }
          }
        }
        // Checks 3 : Actuator status for current zone frames (OpenWebNet doc) : *#4*where*20*Val##
        // where : Actuators N of zone Z [Z#N] -> [0-99#1-9] / All the actuators of zone Z [Z#0] / All the actuators [0#0]
        // val : 0 = OFF / 1 = ON / 2 = Opened / 3 = Closed / 4 = Stop / 5 = OFF Fan Coil / 6 = ON Vel 1 / 7 = ON Vel 2 / 8 = ON Vel 3 / 9 = ON Fan Coil
        if (packetMatch === null) {
          // packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\#(\\d)\\*20\\*(\\d)##');
          // if (packetMatch !== null) {
          //   let curActuatorid = packetMatch[1];
          //   let curActuatorState = payloadInfo.actuatorStates['actuator_' + curActuatorid] = {};
          //   curActuatorState.state_ownValue = packetMatch[2];
          //   let actuatorStates_List = [];
          //   actuatorStates_List[0] = ['0' , false , 'OFF'];
          //   actuatorStates_List[1] = ['1' , true , 'ON'];
          //   actuatorStates_List[2] = ['2' , true , 'Opened'];
          //   actuatorStates_List[3] = ['3' , false , 'Closed'];
          //   actuatorStates_List[4] = ['4' , false , 'Stop'];
          //   actuatorStates_List[5] = ['5' , false , 'OFF Fan Coil'];
          //   actuatorStates_List[6] = ['6' , true , 'ON Vel 1'];
          //   actuatorStates_List[7] = ['7' , true , 'ON Vel 2'];
          //   actuatorStates_List[8] = ['8' , true , 'ON Vel 3'];
          //   actuatorStates_List[9] = ['9' , true , 'ON Fan Coil'];
          //
          //   for (let i = 0; i < actuatorStates_List.length; i++) {
          //     if (actuatorStates_List[i][0] == curActuatorState.state_ownValue) {
          //       curActuatorState.On = actuatorStates_List[i][1];
          //       curActuatorState.state = actuatorStates_List[i][2];
          //       payloadInfo.actuatorStates.On = curActuatorState.On; // Easy way (but not 100% correct : the global state in taken from the last read actuator)
          //       break;
          //     }
          //   }
          // }
        }
        // Checks 4 : Local offset acquire frames (OpenWebNet doc) : *#4*where*13*OL## with OL = Local Offset (knob status):
        // 00 = 0 / 01 = +1° / 02 = +2° / 03 = +3° / 11 = -1° / 12 = -2° / 13 = -3° / 04 = Local OFF / 05 = Local protection
        if (packetMatch === null) {
          // packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\*13\\*(\\d\\d)##');
          // if (packetMatch !== null) {
          //   payloadInfo.localOffset_ownValue = packetMatch[1];
          //   let localOffset_List = [];
          //   localOffset_List[0] = ['00' , 0];  // +0°C
          //   localOffset_List[1] = ['01' , 1];  // +1°C
          //   localOffset_List[2] = ['02' , 2];  // +2°C
          //   localOffset_List[3] = ['03' , 3];  // +3°C
          //   localOffset_List[4] = ['11' , -1]; // -1°C
          //   localOffset_List[5] = ['12' , -2]; // -2°C
          //   localOffset_List[6] = ['13' , -3]; // -3°C
          //   localOffset_List[7] = ['04' , 'Local OFF'];
          //   localOffset_List[8] = ['05' , 'Local protection'];
          //
          //   for (let i = 0; i < localOffset_List.length; i++) {
          //     if (localOffset_List[i][0] == payloadInfo.localOffset_ownValue) {
          //       payloadInfo.localOffset = localOffset_List[i][1];
          //       break;
          //     }
          //   }
          // }
        }
        // Checks 5 : Zone operation mode request of central unit (OpenWebNet doc) : *4*what*#where##
        // what : 110 = Manual Heating / 210 = Manual Conditioning / 111 = Automatic Heating / 211 = Automatic Conditioning / 103 = Off Heating / 203 = Off Conditioning / 102 = Antifreeze / 202 = Thermal Protection
        // where : [#1 - #99] Request zone by Central Unit.
        if (packetMatch === null) {
          // packetMatch = curPacket.match ('^\\*4\\*(\\d\\d\\d)\\*\\#' + config.zoneid + '##');
          // if (packetMatch !== null) {
          //   payloadInfo.operationMode_ownValue = packetMatch[1];
          //   let operationMode_List = [];
          //   operationMode_List[0] = ['110' , 'Manual Heating'];
          //   operationMode_List[1] = ['210' , 'Manual Conditioning'];
          //   operationMode_List[2] = ['111' , 'Automatic Heating'];
          //   operationMode_List[3] = ['211' , 'Automatic Conditioning'];
          //   operationMode_List[4] = ['103' , 'Off Heating'];
          //   operationMode_List[5] = ['203' , 'Off Conditioning'];
          //   operationMode_List[6] = ['102' , 'Antifreeze'];
          //   operationMode_List[7] = ['202' , 'Thermal Protection'];
          //
          //   for (let i = 0; i < operationMode_List.length; i++) {
          //     if (operationMode_List[i][0] == payloadInfo.operationMode_ownValue) {
          //       payloadInfo.operationMode = operationMode_List[i][1];
          //       break;
          //     }
          //   }
          // }
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

      // Update node status payloadInfo
      let nodeStatusFill;
      if (!payloadInfo.actuatorStates.On || payloadInfo.operationType === '?') {
        nodeStatusFill = 'grey';
      } else if (payloadInfo.operationType === 'Heating') {
        nodeStatusFill = 'yellow';
      } else {
        nodeStatusFill = 'blue';
      }
      let nodeStatusText = payloadInfo.state + '°C (' + payloadInfo.operationMode + ' @' + payloadInfo.setTemperature + '°C)';
      node.status ({fill: nodeStatusFill, shape: 'dot', text: nodeStatusText});

      // Send msg back as new flow : only send update as new flow when something changed after having received this new BUS info
      // (but always send it when SmartFilter is disabled or when running in 'state/' mode, i.e. read-only mode)
      let newPayloadinfo = JSON.stringify (payloadInfo);
      if (!config.smartfilter || newPayloadinfo !== node.lastPayloadInfo || forceRefreshAndMsg) {
        // MSG1 : Build primary msg
        // MSG1 : Received command info
        payload.command_received = packet;
        // MSG1 : Add all current node stored values to payload
        payload.state = payloadInfo.state;
        payload.setTemperature = payloadInfo.setTemperature;
        payload.operationType = payloadInfo.operationType;
        payload.operationType_ownValue = payloadInfo.operationType_ownValue;
        payload.localOffset = payloadInfo.localOffset;
        payload.localOffset_ownValue = payloadInfo.localOffset_ownValue;
        payload.actuatorStates = payloadInfo.actuatorStates;
        payload.operationMode_ownValue = payloadInfo.operationMode_ownValue;
        payload.operationMode = payloadInfo.operationMode;
        // MSG1 : Add misc info
        msg.topic = 'state/' + config.topic;

        // MSG2 : Build secondary payload
        let msg2 = mhutils.buildSecondaryOutput (payloadInfo, config, 'On', '', '');

        // Store last sent payload info & send both msg to output1 and output2
        node.lastPayloadInfo = newPayloadinfo;
        node.send ([msg, msg2]);
      }
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a message (payload) is received from the node-RED flow ///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processInput = function (msg) {
      if (typeof (msg) === 'string') {
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
        // TODO (or not based on possible input allowed)
        // if (msg.payload.state === undefined && msg.payload.On !== undefined) {
        //  msg.payload.state = (msg.payload.On) ? 'ON' : 'OFF';
        //  }
      } else if (typeof(msg.payload) === 'string' || typeof(msg.payload) === 'number') {
        msg.payload = {'state': msg.payload};
      }
      let payload = msg.payload;

      // Build the OpenWebNet command(s) to be sent
      let commands = [];
      if (isReadOnly) {
        // Working in read-only mode: build a status enquiry request (no status update sent)
        // In theory (based on OpenWebNet doc), only 1 call is required
        // Command #1 : *#4*#0## (where = #0 here) which returns multiple '*4*what*#0##' with different 'what' based on curtrent state
        // BUT, during test phase, it appears not all gateways react the same, as for zone
        //  - F455 : does provide the listed ones but also much more (2 on F459 -> 17 (!!) on F455. Also quite long delay before responses are all sent...). But OK, they are there
        //  - MH202 : does provide the listed ones but always returned 3 frame (what=22, 23 and 24) even if not probe OFF / Protection / manual at all...
        //  - F459 & MyHOMEServer1 : works as it should
        commands.push ('*#4*#0##');
      } else {
        // Running in Write mode
        if (parseFloat(payload.state)) {
          // Temperature to be set in MANUAL mode, command is *#4*where*#14*T*M##
          //  - where = [#1 - #99] Setup zone by Central Unit
          //  - The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
          //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
          //  - M = operation mode : 1 = heating mode / 2 = conditional mode / 3 = generic mode
          let tempSet = parseInt(payload.state*10);
          if (tempSet < 20) {
            tempSet = 20;
          } else if (tempSet > 430) {
            tempSet = 430;
          }
          tempSet = ('0000' + tempSet.toString()).slice(-4);
          commands.push ('*#4*#' + config.zoneid + '*#14*' + tempSet + '*3##');
        } else if (payload.state === 'AUTO') {
          // Zone to be switched to auto : *4*311*#where##
          //  - where = [#1 - #99] Setup zone by Central Unit
          commands.push ('*4*311*#' + config.zoneid + '##');
        } else if (payload.state === 'OFF') {
          // Zone to be switched to off : *4*303*where##
          //  - where = [#1 - #99] Setup zone by Central Unit
          commands.push ('*4*303*#' + config.zoneid + '##');
        } else if (payload.state === 'PROTECT') {
          // Zone to be switched to protection mode (only generic managed here) : *4*302*where##
          //  - where = [#1 - #99] Setup zone by Central Unit
          commands.push ('*4*302*#' + config.zoneid + '##');
        }
      }
      if (commands.length === 0) {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, commands, gateway, true,
        function (sdata, commands, cmd_responses) {
          // Build main payload to return payloads to outputs
          payload.command_sent = commands; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          // Once commands were sent, call internal function to froce node info refresh (using 'state/')and msg outputs
          msg.topic = 'state/' + config.topic;
          node.processReceivedBUSCommand (msg, cmd_responses);
        }, function (sdata, command, errorMsg) {
          node.error ('command [' + command + '] failed : ' + errorMsg);
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: 'command failed: ' + command});
        });
      };

      //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
      node.on('close', function (done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType ('myhome-thermo-central', MyHomeTemperatureNode);
  };
