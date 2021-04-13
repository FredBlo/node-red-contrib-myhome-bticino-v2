/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeEventSessionNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // Add all listerners on gateway based on types we have to monitor
    // Define the function which is to be called on any triggered command received from the gateway
    const listenerFunction = function (packet) {
      node.send ({payload: packet});
    };

    // LIGHTS
    if (config.own_lights) {
      runningMonitor.addMonitoredEvent ('OWN_LIGHTS', listenerFunction);
    }
    // SHUTTERS
    if (config.own_shutters) {
      runningMonitor.addMonitoredEvent ('OWN_SHUTTERS', listenerFunction);
    }
    // TEMPERATURE MANAGEMENT
    if (config.own_temperature) {
      runningMonitor.addMonitoredEvent ('OWN_TEMPERATURE', listenerFunction);
    }
    // ENERGY MANAGEMENT
    if (config.own_energy) {
      runningMonitor.addMonitoredEvent ('OWN_ENERGY', listenerFunction);
    }
    // OTHERS
    if (config.own_others) {
      runningMonitor.addMonitoredEvent ('OWN_OTHERS', listenerFunction);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.on('close', function(done)	{
      runningMonitor.clearAllMonitoredEvents ();
      done();
    });
  }
  RED.nodes.registerType ("myhome-eventsession", MyHomeEventSessionNode);
};
