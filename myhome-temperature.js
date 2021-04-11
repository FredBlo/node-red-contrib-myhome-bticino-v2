/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeTemperatureNode (config) {
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
      runningMonitor.addMonitoredEvent ('OWN_TEMPERATURE', listenerFunction);
    }

    // Function called when a MyHome BUS command is received
    this.processReceivedBUSCommand = function (msg, packet) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;

      // Check whether received command is linked to current configured node shutter group/id
      // From OpenWebNetDoc : *#4*where*12*T*3##
      //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
      //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
      let m = packet.match ('^\\*\\#4\\*' + config.zoneid + '\\*0\\*\\d(\\d\\d\\d)##');
      if (m === null) {
        return;
      }


      let curTemp = parseInt (m[1]) / 10;
      node.status ({fill: 'grey', shape: 'ring', text: curTemp & '°C'});

      // Additional info : include initial SCS/BUS message which was read in payload
      payload.command_received = packet;
      // Build secondary payload
//      let msg2 = mhutils.buildSecondaryOutput (payload.state, config, 'On', 'OPEN', 'CLOSE');

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
