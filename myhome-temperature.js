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

      let msg2 = {};
      node.send ([msg, msg2]);
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
    RED.nodes.registerType ('myhome-light', MyHomeTemperatureNode);
  };
