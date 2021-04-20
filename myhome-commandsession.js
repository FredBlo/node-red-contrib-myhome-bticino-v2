/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeCommandSessionNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let interCommandsDelay = parseInt(config.intercommandsdelay) || 0;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a message (payload) is received from the node-RED flow ///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.on ('input', function (msg) {
      let commands = msg.payload;
      let payload = {};

      mhutils.executeCommand (node, commands, gateway, interCommandsDelay, true,
        function (commands, cmd_responses, cmd_failed) {
          // update payload with sent command & results received
          payload.command_sent = commands; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          if (cmd_failed.length) {
            // Also add failed requests, but only if some failed
            payload.command_failed = cmd_failed;
          }
          msg.payload = payload;
          node.send (msg);
          // updating node state
          node.status ({fill: 'green', shape: 'dot', text: 'command executed: ' + commands});
        }, function (sdata, commands, errorMsg) {
          node.error ('command [' + commands + '] failed : ' + errorMsg);
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: 'command failed: ' + commands});
        });
      });
    }
    RED.nodes.registerType ("myhome-commandsession", MyHomeCommandSessionNode);
  };
