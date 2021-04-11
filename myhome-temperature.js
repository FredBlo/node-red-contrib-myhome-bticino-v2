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
    node.localOffset = '?';
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

      // Check whether received command is linked to current configured node shutter group/id
      // From OpenWebNetDoc :
      //  - current temperature (master probe) : *#4*where*0*T##
      //  - current temperature goal set : *#4*where*14*T*3##
      //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
      //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].

      //node.localOffset = '?'; // TODO
          // *#4*where*13*OL##
          // Local offset acquire frame:
          // where = [1-99]
          // OL = Local Offset (knob status):
          // 00  knob on 0
          // 01  knob on +1 (degree)
          // 11  knob on -1 (degree)
          // 02  knob on +2 (degree)
          // 12  knob on -2 (degree)
          // 03  knob on +3 (degree)
          // 13  knob on -3 (degree)
          // 4  knob on Local OFF
          // 5  knob on Local protection
      let m = packet.match ('^\\*\\#4\\*' + config.zoneid + '\\*(0|14)\\*\\d(\\d\\d\\d)(\\*3|)##');
      if (m === null) {
        return;
      }

      if (m[1] === '0') {
        // Current temperature from master probe
        node.curTemp = parseInt (m[2]) / 10;
      } else if (m[1] === '14') {
        // Current temperature objective set
        node.setTemp = parseInt (m[2]) / 10;
      } else {
        // Unmanaged information
        return;
      }

      node.status ({fill: 'grey', shape: 'ring', text: (node.curTemp + '°C (Goal: ' + node.setTemp + '°C)' )});

      // Additional info : include initial SCS/BUS message which was read in payload
      payload.command_received = packet;
      // Build secondary payload
//      let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'OPEN', 'CLOSE');

      payload.state = node.curTemp;
      payload.state_setTemperature = node.setTemp;

      payload.state_operationMode = node.operationMode; // TODO
          //*4*what*where##
          // Zone operation mode acquire frame:
          // where = [1-99]
          // what =
          // 0  Conditioning
          // 1  Heating
          // 102  Antifreeze
          // 202  Thermal Protection
          // 303  Generic OFF

      payload.state_localOffset = node.localOffset;
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