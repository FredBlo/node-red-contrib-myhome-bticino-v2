/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeTemperatureNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // All current zone received values stored in meme from the moment node is loaded
    node.curTemp = '?';
    node.setTemp = '?';
    node.localOffset_ownValue = '?';
    node.localOffset = '?';
    node.operationMode_ownValue = '?';
    node.operationMode = '?';
    node.actuatorStates = {};
    node.actuatorStates.On = false;

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


      // Check whether received command is linked to current configured Zone
      let processedPackets = 0;
      for (let curPacket of (typeof(packet) === 'string') ? [packet] : packet) {
        let packetMatch;
        // Checks 1 : current temperature and set objective frames (OpenWebNet doc) :
        //  - current temperature (master probe) : *#4*where*0*T##
        //  - current temperature goal set (included adjust by local offset) : *#4*where*14*T*3##
        //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
        //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
        packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\*(0|14)\\*\\d(\\d\\d\\d)(\\*3|)##');
        if (packetMatch !== null) {
          if (packetMatch[1] === '0') {
            // Current temperature from master probe
            node.curTemp = parseInt (packetMatch[2]) / 10;
          } else if (packetMatch[1] === '14') {
            // Current temperature objective set
            node.setTemp = parseInt (packetMatch[2]) / 10;
          }
        }
        // Checks 2 : Zone operation mode frames (OpenWebNet doc) : *4*what*where##
        // where being : 0 = Conditioning / 1 = Heating / 102 = Antifreeze / 202 = Thermal Protection / 303 = Generic OFF
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*4\\*(\\d+)\\*' + config.zoneid + '##');
          if (packetMatch !== null) {
            node.operationMode_ownValue = packetMatch[1];
            let operationMode_List = [];
            operationMode_List[0] = ['0' , 'Conditioning'];
            operationMode_List[1] = ['1' , 'Heating'];
            operationMode_List[2] = ['102' , 'Antifreeze'];
            operationMode_List[3] = ['202' , 'Thermal Protection'];
            operationMode_List[4] = ['303' , 'Generic OFF'];

            for (let i = 0; i < operationMode_List.length; i++) {
              if (operationMode_List[i][0] == node.operationMode_ownValue) {
                node.operationMode = operationMode_List[i][1];
                break;
              }
            }
          }
        }
        // Checks 3 : Actuator status for current zone frames (OpenWebNet doc) : *#4*where*20*Val##
        // where : Actuators N of zone Z [Z#N] -> [0-99#1-9] / All the actuators of zone Z [Z#0] / All the actuators [0#0]
        // val : 0 = OFF / 1 = ON / 2 = Opened / 3 = Closed / 4 = Stop / 5 = Off Fan Coil / 6 = ON Vel 1 / 7 = ON Vel 2 / 8 = ON Vel 3 / 9 = ON Fan Coil
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\#(\\d)\\*20\\*(\\d)##');
          if (packetMatch !== null) {
            let curActuatorid = packetMatch[1];
            let curActuatorState = node.actuatorStates['actuator_' + curActuatorid] = {};
            curActuatorState.state_ownValue = packetMatch[2];
            let actuatorStates_List = [];
            actuatorStates_List[0] = ['0' , false , 'OFF'];
            actuatorStates_List[1] = ['1' , true , 'ON'];
            actuatorStates_List[2] = ['2' , true , 'Opened'];
            actuatorStates_List[3] = ['3' , false , 'Closed'];
            actuatorStates_List[4] = ['4' , false , 'Stop'];
            actuatorStates_List[5] = ['5' , false , 'Off Fan Coil'];
            actuatorStates_List[6] = ['6' , true , 'ON Vel 1'];
            actuatorStates_List[7] = ['7' , true , 'ON Vel 2'];
            actuatorStates_List[8] = ['8' , true , 'ON Vel 3'];
            actuatorStates_List[9] = ['9' , true , 'ON Fan Coil'];

            for (let i = 0; i < actuatorStates_List.length; i++) {
              if (actuatorStates_List[i][0] == curActuatorState.state_ownValue) {
                curActuatorState.On = actuatorStates_List[i][1];
                curActuatorState.state = actuatorStates_List[i][2];
                node.actuatorStates.On = curActuatorState.On; // Easy way (but not 100% correct : the global state in taken from the last read actuator)
                break;
              }
            }
          }
        }
        // Checks 4 : Local offset acquire frames (OpenWebNet doc) : *#4*where*13*OL## with OL = Local Offset (knob status):
        // 00 = 0 / 01 = +1° / 02 = +2° / 03 = +3° / 11 = -1° / 12 = -2° / 13 = -3° / 4 = Local OFF / 5 = Local protection
        if (packetMatch === null) {
          packetMatch = curPacket.match ('^\\*\\#4\\*' + config.zoneid + '\\*13\\*(\\d\\d)##');
          if (packetMatch !== null) {
            node.localOffset_ownValue = packetMatch[1];
            let localOffset_List = [];
            localOffset_List[0] = ['00' , 0];  // +0°C
            localOffset_List[1] = ['01' , 1];  // +1°C
            localOffset_List[2] = ['02' , 2];  // +2°C
            localOffset_List[3] = ['03' , 3];  // +3°C
            localOffset_List[4] = ['11' , -1]; // -1°C
            localOffset_List[5] = ['12' , -2]; // -2°C
            localOffset_List[6] = ['13' , -3]; // -3°C
            localOffset_List[7] = ['4' , 'Local OFF'];
            localOffset_List[8] = ['5' , 'Local protection'];

            for (let i = 0; i < localOffset_List.length; i++) {
              if (localOffset_List[i][0] == node.localOffset_ownValue) {
                node.localOffset = localOffset_List[i][1];
                break;
              }
            }
          }
        }
        if (packetMatch !== null) {
          processedPackets++;
        }
      }
      // Checks : all done, if nothing was processed, abord (no node / flow update detected)
      if (processedPackets === 0) {
        return;
      }
      node.status ({fill: (node.actuatorStates.On && node.operationMode !== '?') ? ((node.operationMode === 'Heating') ? 'yellow' : 'blue') : 'grey', shape: 'dot', text: (node.curTemp + '°C (Goal: ' + node.setTemp + '°C / Offset: ' + node.localOffset + ')' )});

      // Build secondary payload
//      let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'OPEN', 'CLOSE');

      // Additional info : include initial SCS/BUS message which was read in payload
      payload.command_received = packet;
      // Add all current node stored values to payload
      payload.state = node.curTemp;
      payload.state_setTemperature = node.setTemp;
      payload.state_operationMode = node.operationMode;
      payload.state_operationMode_ownValue = node.operationMode_ownValue;
      payload.state_localOffset = node.localOffset;
      payload.state_localOffset_ownValue = node.localOffset_ownValue;
      payload.actuatorStates = node.actuatorStates;
      msg.topic = 'state/' + config.topic;
      node.send (msg);
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a message (payload) is received from the node-RED flow ///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processInput = function (msg) {
      if (typeof (msg) === 'string') {
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
        /*
        // TODO (or not based on possible input allowed)
        if (msg.payload.state === undefined && msg.payload.On !== undefined) {
          msg.payload.state = (msg.payload.On) ? 'ON' : 'OFF';
        }
        */
      } else if (typeof(msg.payload) === 'string') {
        msg.payload = {'state': msg.payload};
      }
      let payload = msg.payload;

      // Build the OpenWebNet command to be sent
      let commands = [];
      if (config.isstatusrequest) {
        // Working in read-only mode: build a status enquiry request (no status update sent)
        // In theory (based on OpenWebNet doc), only 2 calls are required
        // Command #1 : *#4*where## which returns (where = Zone)
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
        // Command #2 : *#4*where#0*20## which returns (where = Zone)
        //    1: *#4*where#[1-9]*20*Val##  : Actuator #[1-9] status for current zone
        // Test phase : fails on F455 & MH202 (NACK), or return other results (?). Commands are NOT seen on the BUS at all...
        commands.push ('*#4*' + config.zoneid + '#0*20##');   // no alternative found to ask for these :-(
        commands.push ('*#4*' + config.zoneid + '#1*20##');   // since most systems have the first actuator enabled, force refreshing it...
      } else {
        // Read+Write mode
        // // // TODO // // //
        // to set temp manually
        // *#4*where*#14*T*M## (M=3 ? for generic ?)
      }
      if (commands.length === 0) {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, commands, gateway, true,
        function (sdata, commands, cmd_responses) {
          // Return values to both outputs
          // Build main payload
          payload.command_sent = commands; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          msg.topic = 'state/' + config.topic;
          // When running in status refresh mode, if we received an update, we process it as it was received by the bus
          // This also means process stops here and msg will be output by the called function itself
          if (cmd_responses.length) {
            node.processReceivedBUSCommand (msg, cmd_responses);
            return;
          }
//          if (config.skipevents) {
//            node.status ({fill: (payload.state === 'ON') ? 'yellow' : 'grey', shape: 'ring', text: nodestatusinfo});
//          }
          // Send both outputs
          node.send (msg);
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
    RED.nodes.registerType ('myhome-temperature', MyHomeTemperatureNode);
  };
