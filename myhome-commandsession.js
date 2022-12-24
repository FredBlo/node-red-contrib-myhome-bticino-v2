/*jshint esversion: 7, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeCommandSessionNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let interCommandsDelay_Cfg = parseInt(config.intercommandsdelay) || 0;
    let interCommandsDelay_AllowOverride = config.intercommandsdelay_frommsg || false;

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a message (payload) is received from the node-RED flow ///////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.on ('input', function (msg) {
      let commands = msg.payload;
      let payload = {};

      // Define delay to be applied between 2 commands (defaults to node config but can be overriden by msg.rate)
      let interCommandsDelay = interCommandsDelay_Cfg;
      if (interCommandsDelay_AllowOverride && !isNaN(msg.rate)) {
        interCommandsDelay = parseInt(msg.rate);
      }
      
      // Execute received commands
      mhutils.executeCommand (node, commands, gateway, interCommandsDelay, true,
        function (commands, cmd_responses, cmd_failed) {
          let nodeStatusShape = 'dot';
          let nodeStatusTextErr = '';
          // update payload with sent command & results received
          payload.command_sent = commands; // Include initial SCS/BUS message which was sent in main payload
          payload.command_responses = cmd_responses; // include the BUS responses when emitted command provides a result (can hold multiple values)
          if (cmd_failed.length) {
            // Also add failed requests, but only if some failed
            payload.command_failed = cmd_failed;
            nodeStatusTextErr = ' Errors: ' + cmd_failed.length;
            nodeStatusShape = 'ring';
          }
          msg.payload = payload;
          node.send (msg);
          // updating node state
          let nodeStatusText = '';
          if (payload.command_sent.length === 1) {
            nodeStatusText = RED._('mh-cmdsession.node.cmdsent_mono' , {'command':payload.command_sent[0], 'responsesCount':cmd_responses.length});
          } else if (payload.command_sent.length > 1) {
            nodeStatusText = RED._('mh-cmdsession.node.cmdsent_multi' , {'commandsCount':payload.command_sent.length, 'responsesCount':cmd_responses.length});
          }
          node.status ({fill: 'green', shape: nodeStatusShape, text: nodeStatusText});
        }, function (cmd_failed, nodeStatusErrorMsg) {
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: nodeStatusErrorMsg});
        });
      });
    }
    RED.nodes.registerType ("myhome-commandsession", MyHomeCommandSessionNode);
  };
