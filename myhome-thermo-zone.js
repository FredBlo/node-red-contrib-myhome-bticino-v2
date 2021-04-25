/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeThermoZoneNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // All current zone received values stored in memory from the moment node is loaded
    let payloadInfo = node.payloadInfo = {};
    payloadInfo.state = '?';
    payloadInfo.setTemperature = '?';
    payloadInfo.localOffset_ownValue = '?';
    payloadInfo.localOffset = '?';
    payloadInfo.operationType_ownValue = '?';
    payloadInfo.operationType = '?';
    payloadInfo.actuatorStates = {};
    payloadInfo.actuatorStates.On = false;
    payloadInfo.operationMode_ownValue = '?';
    payloadInfo.operationMode = '?';
    node.status_icon = ['grey','ring'];
    node.status_needTempInfo = false;
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
    runningMonitor.addMonitoredEvent ('OWN_TEMPERATURE', listenerFunction);

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
        // Checks 1 : current temperature and set objective frames (OpenWebNet doc) :
        //  - current temperature (master probe) : *#4*where*0*T## (or *#4*where*0*T*3## if local offset included)
        //  - current temperature goal set (included adjust by local offset) : *#4*where*14*T*3##
        //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
        //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
        packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\*(0|14)\\*\\d(\\d\\d\\d)(\\*3|)##');
        if (packetMatch !== null) {
          if (packetMatch[1] === '0') {
            // Current temperature from master probe
            payloadInfo.state = parseInt (packetMatch[2]) / 10;
          } else if (packetMatch[1] === '14') {
            // Current temperature objective set
            payloadInfo.setTemperature = parseInt (packetMatch[2]) / 10;
          }
        }
        // Checks 2 : Zone operation type frames (OpenWebNet doc) : *4*what*where##
        // where being : 0 = Conditioning / 1 = Heating / 102 = Antifreeze / 202 = Thermal Protection / 303 = Generic OFF
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*4\\*(\\d+)\\*' + config.zoneid + '##');
          if (packetMatch !== null) {
            payloadInfo.operationType_ownValue = packetMatch[1];
            let operationType_List = [];
            operationType_List.push (['0' , 'Conditioning']);
            operationType_List.push (['1' , 'Heating']);
            operationType_List.push (['102' , 'Antifreeze']);
            operationType_List.push (['202' , 'Thermal Protection']);
            operationType_List.push (['303' , 'Generic OFF']);

            for (let i = 0; i < operationType_List.length; i++) {
              if (operationType_List[i][0] == payloadInfo.operationType_ownValue) {
                payloadInfo.operationType = operationType_List[i][1];
                break;
              }
            }
          }
        }
        // Checks 3 : Actuator status for current zone frames (OpenWebNet doc) : *#4*where*20*Val##
        // where : Actuators N of zone Z [Z#N] -> [0-99#1-9] / All the actuators of zone Z [Z#0] / All the actuators [0#0]
        // val : 0 = OFF / 1 = ON / 2 = Opened / 3 = Closed / 4 = Stop / 5 = OFF Fan Coil / 6 = ON Vel 1 / 7 = ON Vel 2 / 8 = ON Vel 3 / 9 = ON Fan Coil
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\#(\\d)\\*20\\*(\\d)##');
          if (packetMatch !== null) {
            let curActuatorid = packetMatch[1];
            let curActuatorState = payloadInfo.actuatorStates['actuator_' + curActuatorid] = {};
            curActuatorState.state_ownValue = packetMatch[2];
            let actuatorStates_List = [];
            actuatorStates_List.push (['0' , false , 'OFF']);
            actuatorStates_List.push (['1' , true , 'ON']);
            actuatorStates_List.push (['2' , true , 'Opened']);
            actuatorStates_List.push (['3' , false , 'Closed']);
            actuatorStates_List.push (['4' , false , 'Stop']);
            actuatorStates_List.push (['5' , false , 'OFF Fan Coil']);
            actuatorStates_List.push (['6' , true , 'ON Vel 1']);
            actuatorStates_List.push (['7' , true , 'ON Vel 2']);
            actuatorStates_List.push (['8' , true , 'ON Vel 3']);
            actuatorStates_List.push (['9' , true , 'ON Fan Coil']);

            for (let i = 0; i < actuatorStates_List.length; i++) {
              if (actuatorStates_List[i][0] == curActuatorState.state_ownValue) {
                curActuatorState.On = actuatorStates_List[i][1];
                curActuatorState.state = actuatorStates_List[i][2];
                payloadInfo.actuatorStates.On = curActuatorState.On; // Easy way (but not 100% correct : the global state in taken from the last read actuator)
                break;
              }
            }
          }
        }
        // Checks 4 : Local offset acquire frames (OpenWebNet doc) : *#4*where*13*OL## with OL = Local Offset (knob status):
        // 00 = 0 / 01 = +1° / 02 = +2° / 03 = +3° / 11 = -1° / 12 = -2° / 13 = -3° / 04 = Local OFF / 05 = Local protection
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\*13\\*(\\d{2})##');
          if (packetMatch !== null) {
            payloadInfo.localOffset_ownValue = packetMatch[1];
            let localOffset_List = [];
            localOffset_List.push (['00' , 0]);  // +0°C
            localOffset_List.push (['01' , 1]);  // +1°C
            localOffset_List.push (['02' , 2]);  // +2°C
            localOffset_List.push (['03' , 3]);  // +3°C
            localOffset_List.push (['11' , -1]); // -1°C
            localOffset_List.push (['12' , -2]); // -2°C
            localOffset_List.push (['13' , -3]); // -3°C
            localOffset_List.push (['04' , 'Local OFF']);
            localOffset_List.push (['05' , 'Local protection']);

            for (let i = 0; i < localOffset_List.length; i++) {
              if (localOffset_List[i][0] == payloadInfo.localOffset_ownValue) {
                payloadInfo.localOffset = localOffset_List[i][1];
                break;
              }
            }
          }
        }
        // Checks 5 : Zone operation mode request of central unit (OpenWebNet doc) : *4*what*#where##
        // what : 110 = Manual Heating / 210 = Manual Conditioning / 111 = Automatic Heating / 211 = Automatic Conditioning / 103 = Off Heating / 203 = Off Conditioning / 102 = Antifreeze / 202 = Thermal Protection
        // where : [#1 - #99] Request zone by Central Unit.
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*4\\*(\\d{3})\\*\\#' + config.zoneid + '##');
          if (packetMatch !== null) {
            payloadInfo.operationMode_ownValue = packetMatch[1];
            let operationMode_List = [];
            operationMode_List.push ({own:'102', mode:'Antifreeze',             icon:['yellow','ring'], needTempInfo:false});
            operationMode_List.push ({own:'103', mode:'Off Heating',            icon:['grey','dot'],    needTempInfo:false});
            operationMode_List.push ({own:'110', mode:'Manual Heating',         icon:['yellow','dot'],  needTempInfo:true});
            operationMode_List.push ({own:'111', mode:'Automatic Heating',      icon:['yellow','dot'],  needTempInfo:true});
            operationMode_List.push ({own:'202', mode:'Thermal Protection',     icon:['blue','ring'],   needTempInfo:false});
            operationMode_List.push ({own:'203', mode:'Off Conditioning',       icon:['grey','dot'],    needTempInfo:false});
            operationMode_List.push ({own:'210', mode:'Manual Conditioning',    icon:['blue','dot'],    needTempInfo:true});
            operationMode_List.push ({own:'211', mode:'Automatic Conditioning', icon:['blue','dot'],    needTempInfo:true});

            // Add main & associated sub info if any
            for (let i = 0; i < operationMode_List.length; i++) {
              if (operationMode_List[i].own == payloadInfo.operationMode_ownValue) {
                payloadInfo.operationMode = operationMode_List[i].mode;
                node.status_icon = operationMode_List[i].icon;
                node.status_needTempInfo = operationMode_List[i].needTempInfo;
                break;
              }
            }
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

      // Update node status payloadInfo
      // Icon : when colo is not grey (i.e. blue or yellow), we revert to grey if actuators are not On
      let nodeStatusColor = node.status_icon[0];
      if (nodeStatusColor !== 'grey' && !payloadInfo.actuatorStates.On) {
        nodeStatusColor = 'grey';
      }
      // Text : append temperatur set point info if needed
      let nodeStatusText = payloadInfo.state + '°C (' + payloadInfo.operationMode + ((node.status_needTempInfo) ? ' @' + payloadInfo.setTemperature + '°C' : '') + ')';
      node.status ({fill: nodeStatusColor , shape: node.status_icon[1], text: nodeStatusText});

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
      // Get payload and apply conversions (asked state can be set in 'msg.payload' or 'msg.payload.state'
      if (msg.payload === undefined) {
        msg.payload = {};
      } else if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) === 'string' || typeof(msg.payload) === 'number') {
        msg.payload = {'state': msg.payload};
      }
      let payload = msg.payload;

      // Build the OpenWebNet command(s) to be sent
      let commands = [];
      let interCommandsDelay = 0;
      if (!isReadOnly) {
        // Running in Write mode
        if (parseFloat(payload.state)) {
          // Temperature to be set in MANUAL mode, command is *#4*where*#14*T*M##
          //  - where = [#1 - #99] Setup zone by Central Unit
          //  - The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
          //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
          //  - M = operation mode : 1 = heating mode / 2 = conditional mode / 3 = generic mode
          let tempSet = parseInt(payload.state*10);
          if (tempSet < 20 || isNaN(tempSet)) {
            tempSet = 20;
          } else if (tempSet > 430) {
            tempSet = 430;
          }
          tempSet = ('0000' + tempSet.toString()).slice(-4);
          commands.push ('*#4*#' + config.zoneid + '*#14*' + tempSet + '*3##');
          commands.push ('*#4*' + config.zoneid + '*14##'); // since the set command does not return the value, get it by adding a status command right after
        } else {
          let cmd_what = '';
          if (payload.state === 'ANTIFREEZE') {
            // Zone to be switched to Antifreeze mode (only valid in 'Heating mode') : *4*102*where##
            //  - where = [#1 - #99] Setup zone by Central Unit
            cmd_what = '102';
          } else if (payload.state === 'THERMAL_PROTECT') {
            // Zone to be switched to thermal protection mode (only valid in 'Conditioning mode') : *4*202*where##
            //  - where = [#1 - #99] Setup zone by Central Unit
            cmd_what = '202';
          } else if (payload.state === 'PROTECT') {
            // Zone to be switched to protection mode (Generic, works for both Heating & Conditioning modes) : *4*302*where##
            //  - where = [#1 - #99] Setup zone by Central Unit
            cmd_what = '302';
          } else if (payload.state === 'OFF') {
            // Zone to be switched to off : *4*303*where##
            //  - where = [#1 - #99] Setup zone by Central Unit
            cmd_what = '303';
          } else if (payload.state === 'AUTO') {
            // Zone to be switched to auto : *4*311*#where##
            //  - where = [#1 - #99] Setup zone by Central Unit
            cmd_what = '311';
          }
          if (cmd_what) {
            commands.push ('*4*' + cmd_what + '*#' + config.zoneid + '##');
          }
        }
      }
      if (isReadOnly || commands.length) {
        // In Read-Only mode : build a status enquiry request (no status update sent)
        // In Write mode : Since the gateway does not 'respond' when changing point state, we also add a second call to ask for point status after update.
        // -> Which commands ??? In theory (based on OpenWebNet doc), only 2 calls are required
        // Command #1 : *#4*where## (where = Zone) which returns :
        //    1: *4*what*where##     : what = Zone operation mode
        //    2: *#4*where*0*T##     : T = Zone operation temperature not adjust by local offset
        //    3: *#4*where*12*T*3##  : T = Zone operation temperature with adjust by local offset
        //    4: *#4*where*13*OL##   : OL = Local Offset (knob status)
        //    5: *#4*where*14*T*3##  : T = Zone Set-point temperature
        // BUT, during test phase, it appears not all gateways are able to repond to otherwise
        //  - F455 : does not respond anything to 'Command #1', but all responses are sent on the bus (=indirect fetch)
        //  - MH202 : does not return on 'Command #1' the 1.5: (but is sent on the BUS), returns '*#4*where*14*T##' instead
        //  - F459 & MyHOMEServer1 : all responses are received, and even more (15 actually ...)
        // Therefore, using a mode with more calls was the most stable way to go...
        // commands.push ('*#4*' + config.zoneid + '##'); // theory, not stable enough :-P, quite heavy to also include (actually, only MH202 is missing something without this)
        commands.push ('*#4*' + config.zoneid + '*12##');   // to fetch Command #1.1 + #1.3 Works OK on F455 / F459 / MyHOMEServer1 but MH202 does not return #1.1
        commands.push ('*#4*' + config.zoneid + '*0##');    // to fetch Command #1.2 Works OK on F455 / MH202 / F459 / MyHOMEServer1
        commands.push ('*#4*' + config.zoneid + '*13##');   // to fetch Command #1.4 Works OK on F455 / MH202 / F459 / MyHOMEServer1
        commands.push ('*#4*' + config.zoneid + '*14##');   // to fetch Command #1.5 Works OK on F455 / MH202 (but without the '*3') / F459 / MyHOMEServer1
        // Command #2 : *#4*where#0*20## (where = Zone) which returns :
        //    1: *#4*where#[1-9]*20*Val##  : Actuator #[1-9] status for current zone
        // BUT, during test phase : fails on F455 & MH202 (NACK), or return other results (?). Commands are NOT seen on the BUS at all...
        // Therefore, added a second call to at least gather actuator 1 status (most systems have the first actuator assigned before the others...)
        commands.push ('*#4*' + config.zoneid + '#0*20##');   // no alternative found to ask for these :-/
        commands.push ('*#4*' + config.zoneid + '#1*20##');
        // Command #3 : *#4*#where## (where = Zone) which returns :
        //    1: *4*what*#where#    : what = Zone operation mode request of Central Unit
        // Test Phase : OK on all gateways tested (F455 / MH202 / F459 / MyHOMEServer1)
        commands.push ('*#4*#' + config.zoneid + '##');
        // During tests, last command (to gather zone operation mode of central unit) failed. It seems it cannot be processed as long as the first one
        // is being processed / emitting content to the BUS. There must be a total delay of >=1.5 seconds between first command (operation mode change) and last (operation mode request)
        if (!isReadOnly) {
          interCommandsDelay = parseInt(1500/(commands.length-1));
        }
      }
      if (commands.length === 0) {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, commands, gateway, interCommandsDelay, true,
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
    RED.nodes.registerType ('myhome-thermo-zone', MyHomeThermoZoneNode);
  };
