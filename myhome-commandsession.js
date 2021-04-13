/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeCommandSessionNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);

    node.on ('input', function(msg) {
      let command = msg.payload;
      let payload = {};

      mhutils.executeCommand (node, command, gateway, true,
        function (sdata, command, cmd_responses) {
          // update payload with sent command & results received
          payload.command_sent = command; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          msg.payload = payload;
          node.send (msg);
          // updating node state
          node.status ({fill: 'green', shape: 'dot', text: 'command executed: ' + command});
        }, function (sdata, command, errorMsg) {
          node.error ('command [' + command + '] failed : ' + errorMsg);
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: 'command failed: ' + command});
        });
      });
    }
    RED.nodes.registerType ("myhome-commandsession", MyHomeCommandSessionNode);
  };
