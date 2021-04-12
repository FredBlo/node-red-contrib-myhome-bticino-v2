/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeTemperatureNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // All current zone stored received values
    node.curTemp = '?';
    node.setTemp = '?';
    node.localOffset_TechValue = '?';
    node.localOffset = '?';
    node.operationMode_TechValue = '?';
    node.operationMode = '?';

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

    // Function called when a MyHome BUS command is received
    this.processReceivedBUSCommand = function (msg, packet) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;

      // Check whether received command is linked to current configured Zone
      let packetMatch;
      // Checks 1 : current temp and set objective (OpenWebNet doc) :
      //  - current temperature (master probe) : *#4*where*0*T##
      //  - current temperature goal set (included adjust by local offset) : *#4*where*14*T*3##
      //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
      //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
      packetMatch = packet.match ('^\\*\\#4\\*' + config.zoneid + '\\*(0|14)\\*\\d(\\d\\d\\d)(\\*3|)##');
      if (packetMatch !== null) {
        if (packetMatch[1] === '0') {
          // Current temperature from master probe
          node.curTemp = parseInt (packetMatch[2]) / 10;
        } else if (packetMatch[1] === '14') {
          // Current temperature objective set
          node.setTemp = parseInt (packetMatch[2]) / 10;
        }
      }
      // Checks 2 : Zone operation mode frame (OpenWebNet doc) : *4*what*where##
      // where being : 0 = Conditioning / 1 = Heating / 102 = Antifreeze / 202 = Thermal Protection / 303 = Generic OFF
      if (packetMatch === null) {
        packetMatch = packet.match ('^\\*4\\*(\\d+)\\*' + config.zoneid + '##');
        if (packetMatch !== null) {
          node.operationMode_TechValue = packetMatch[1];
          let operationMode_List = [];
          operationMode_List[0] = ['0' , 'Conditioning'];
          operationMode_List[1] = ['1' , 'Heating'];
          operationMode_List[2] = ['102' , 'Antifreeze'];
          operationMode_List[3] = ['202' , 'Thermal Protection'];
          operationMode_List[4] = ['303' , 'Generic OFF'];
          for (let i = 0; i < operationMode_List.length; i++) {
            if (operationMode_List[i][0] == node.operationMode_TechValue) {
              node.operationMode = operationMode_List[i][1];
              break;
            }
          }
        }
      }
      // Checks 3 : Local offset acquire frame (OpenWebNet doc) : *#4*where*13*OL## with OL = Local Offset (knob status):
      // 00 = 0 / 01 = +1° / 02 = +2° / 03 = +3° / 11 = -1° / 12 = -2° / 13 = -3° / 4 = Local OFF / 5 = Local protection
      if (packetMatch === null) {
        packetMatch = packet.match ('^\\*\\#4\\*' + config.zoneid + '\\*(13)\\*(\\d\\d)##');
        if (packetMatch !== null) {
          node.localOffset_TechValue = packetMatch[2];
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
            if (localOffset_List[i][0] == node.localOffset_TechValue) {
              node.localOffset = localOffset_List[i][1];
              break;
            }
          }
        }
      }
      // Checks : all done, if nothing was processed, abord (no node / flow update detected)
      if (packetMatch === null) {
        return;
      }
      node.status ({fill: 'grey', shape: 'ring', text: (node.curTemp + '°C (Goal: ' + node.setTemp + '°C / Offset: ' + node.localOffset + ')' )});

      // Additional info : include initial SCS/BUS message which was read in payload
      payload.command_received = packet;
      // Build secondary payload
//      let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'OPEN', 'CLOSE');

      payload.state = node.curTemp;
      payload.state_setTemperature = node.setTemp;
      payload.state_operationMode = node.operationMode;
      payload.state_operationMode_TechValue = node.operationMode_TechValue;
      payload.state_localOffset = node.localOffset;
      payload.state_localOffset_TechValue = node.localOffset_TechValue;
      msg.topic = 'state/' + config.topic;
      node.send(msg);
    };

    // Function called when a message (payload) is received from the node-RED flow
    this.processInput = function (msg) {

    };

      node.on('close', function(done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType ('myhome-temperature', MyHomeTemperatureNode);
  };
