/*jshint esversion: 7, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeThermoCentralNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // All current zone received values stored in memory from the moment node is loaded
    let payloadInfo = node.payloadInfo = {};
    payloadInfo.state = '?';
    payloadInfo.remoteControl = '?';
    payloadInfo.operationMode = '?';
    node.status_icon = ['grey','ring'];
    node.lastPayloadInfo = JSON.stringify (payloadInfo); // SmartFilter : kept in memory to be able to compare whether an update occurred while processing msg

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Register node for updates
    node.on ('input', function (msg) {
      node.processInput (msg);
    });

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Add listener on node linked to a dedicated function call to be able to remove it on close
    const listenerFunction = function (frame) {
      let msg = {};
      node.processReceivedBUSFrames (msg, frame);
    };
    runningMonitor.addMonitoredEvent ('OWN_TEMPERATURE', listenerFunction);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function which returns all operation modes params / key info (used in both 'processReceivedBUSFrames' and 'processInput' functions)
    function operationModesParams () {
      let operationMode_Params = [];
      operationMode_Params.push ({state:'ANTIFREEZE',                 own:'102',    mode:RED._('mh-thcentral.node.status-opmode-antifreeze'),           icon:['yellow','ring']});
      operationMode_Params.push ({state:'OFF_HEATING',                own:'103',    mode:RED._('mh-thcentral.node.status-opmode-off-heating'),          icon:['grey','dot']});
      operationMode_Params.push ({state:'MANUAL_HEATING:(....)',      own:'110',    mode:RED._('mh-thcentral.node.status-opmode-manual-heating'),       icon:['yellow','dot'], addField:'setTemperature'});
      operationMode_Params.push ({state:'PROGRAM_HEATING:(.)',        own:'110(.)', mode:RED._('mh-thcentral.node.status-opmode-prog-heating'),         icon:['yellow','dot'], addField:'curProgram'});
      operationMode_Params.push ({state:'SCENARIO_HEATING:(..)',      own:'12(..)', mode:RED._('mh-thcentral.node.status-opmode-scen-heating'),         icon:['yellow','dot'], addField:'curScenario'});
      operationMode_Params.push ({state:'THERMAL_PROTECT',            own:'202',    mode:RED._('mh-thcentral.node.status-opmode-thermal-protect'),      icon:['blue','ring']});
      operationMode_Params.push ({state:'OFF_CONDITIONING',           own:'203',    mode:RED._('mh-thcentral.node.status-opmode-off-conditioning'),     icon:['grey','dot']});
      operationMode_Params.push ({state:'MANUAL_CONDITIONING:(....)', own:'210',    mode:RED._('mh-thcentral.node.status-opmode-manual_conditioning'),  icon:['blue','dot'],   addField:'setTemperature'});
      operationMode_Params.push ({state:'PROGRAM_CONDITIONING:(.)',   own:'210(.)', mode:RED._('mh-thcentral.node.status-opmode-prog_conditioning'),    icon:['blue','dot'],   addField:'curProgram'});
      operationMode_Params.push ({state:'SCENARIO_CONDITIONING:(..)', own:'22(..)', mode:RED._('mh-thcentral.node.status-opmode-scen_conditioning'),    icon:['blue','dot'],   addField:'curScenario'});
      operationMode_Params.push ({state:'OFF',                        own:'303',    mode:RED._('mh-thcentral.node.status-opmode-off-generic'),          icon:['grey','dot']});
      operationMode_Params.push ({state:'MANUAL:(....)',              own:'310',    mode:RED._('mh-thcentral.node.status-opmode-manual-generic'),       icon:['yellow','dot'], addField:'setTemperature'});
      operationMode_Params.push ({state:'PROGRAM:(.)',                own:'310(.)', mode:RED._('mh-thcentral.node.status-opmode-prog-generic'),         icon:['yellow','dot'], addField:'curProgram'});
      operationMode_Params.push ({state:'SCENARIO:(..)',              own:'32(..)', mode:RED._('mh-thcentral.node.status-opmode-scen-generic'),         icon:['yellow','dot'], addField:'curScenario'});
      return operationMode_Params;
    }
    let operationModes_Params = operationModesParams ();

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a MyHome BUS frame is received ///////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processReceivedBUSFrames = function (msg, frame) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;
      // When the msg contains a topic with specified 'state/', it means function was called internally (from 'processInput') to refresh values.
      // In this case, even if no frame is found to update something, node is refreshed and msg are sent
      let forceRefreshAndMsg = (msg.topic === 'state/' + config.topic);

      // Check whether received command is linked to current configured Zone
      let processedFrames = 0;
      for (let curFrame of (typeof(frame) === 'string') ? [frame] : frame) {
        let frameMatch;
        // Checks 1 : current central unit status info frames (OpenWebNet doc) : reading '*4*what*#0##' with what in 2 digits mode
        // what: 20 = Remote control disabled / 21 = Remote control enabled / 22 = At least one probe OFF /
        //       23 = At least one probe in protection / 24 = At least one probe in manual / 30 = Failure discovered / 31 = Central Unit battery KO
        // TechNote : we only manage the remote control status
        frameMatch = curFrame.match ('^\\*4\\*(20|21)\\*#0##');
        if (frameMatch !== null) {
          if (frameMatch[1] === '20') {
            payloadInfo.remoteControl = false;
          } else if (frameMatch[1] === '21') {
            payloadInfo.remoteControl = true;
          }
        }
        // Checks 2 : Central Unit’s operation mode : '*4*what*#0##' with what in 3-4 digits (and sub info)
        // what: 110#T = Manual Heating / 210#T = Manual Conditioning
        //       103 = Off Heating / 203 = Off Conditioning / 102 = Antifreeze / 202 = Thermal Protection
        //       [1101-1103] = Memo program in Heating mode / [2101-2103] = Memo program in Conditioning mode
        //       [1201-1216] = Memo scenario in Heating mode / [2201-2216] = Memo scenario in Conditioning mode
        //       115#[1101-1103] = Holiday Heating [program on return] / 215#[2101-2103] = Holiday Conditioning  [program on return]
        //       [13001-13255] = Holiday days in Heating mode / [23001-23255] = Holiday days in Conditioning mode
        //    The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
        //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
        if (frameMatch === null) {
          frameMatch = curFrame.match ('^\\*4\\*(\\d{3,5})((#(\\d+))|)\\*#0##');
          // RegEx results using groups -> array :
          // [1] = what : first 3 to max 5 digits (before a possible #)
          // [2] = -not used-
          // [3] = -not used-, only there if there was a #
          // [4] = what : all digits after the #, if there was a #
          if (frameMatch !== null) {
            payloadInfo.operationMode_ownValue = frameMatch[1];

            // First remove all associated 'sub info'
            delete payloadInfo.operationMode_setTemperature;
            delete payloadInfo.operationMode_curProgram;
            delete payloadInfo.operationMode_curScenario;
            // Add main & associated sub info if any
            for (let i = 0; i < operationModes_Params.length; i++) {
              // Use a regex to see if the current 'what' matches with this mode definition ('^' and '$' added to ensure it encloses start & end of string, partial match is nok)
              let ownMatch = payloadInfo.operationMode_ownValue.match('^' + operationModes_Params[i].own + '$');
              if (ownMatch !== null) {
                payloadInfo.operationMode = operationModes_Params[i].mode;
                node.status_icon = operationModes_Params[i].icon;
                let addFieldInfo = '';
                if (operationModes_Params[i].addField !== undefined) {
                  // A sub value is defined for this mode, add it to payload
                  if (ownMatch[1] !== undefined) {
                    // Additional field info is a part of the WHAT command
                    addFieldInfo = ownMatch[1];
                  } else {
                    // The value is not to be found in OWN WHAT command itself. In this case, it means it is TEMPERATURE info from after the WHAT#
                    addFieldInfo = parseInt((frameMatch[4] || '').slice(-3))/10;
                  }
                  payloadInfo['operationMode_' + operationModes_Params[i].addField] = addFieldInfo;
                }
                // Build the summary state part of payload
                payloadInfo.state = operationModes_Params[i].state;
                let countPoints = payloadInfo.state.split('.').length-1;
                if (countPoints) {
                  let whatSource = '(' + '.'.repeat(countPoints) + ')';
                  payloadInfo.state = payloadInfo.state.replace (whatSource , addFieldInfo);
                }
                break;
              }
            }
          }
        }
        // If we reached here with a non null match, it means command was useful for node
        if (frameMatch !== null) {
          processedFrames++;
        }
      }
      // Checks : all done, if nothing was processed, abord (no node / flow update detected), excepted when refresh is 'forced'
      if (processedFrames === 0 && !forceRefreshAndMsg) {
        return;
      }

      // Update node status payloadInfo
      let nodeStatusText = payloadInfo.operationMode;
      if (payloadInfo.operationMode_curProgram !== undefined) {
        nodeStatusText = nodeStatusText + ' #' + payloadInfo.operationMode_curProgram;
      } else if (payloadInfo.operationMode_curScenario !== undefined) {
        nodeStatusText = nodeStatusText + ' #' + payloadInfo.operationMode_curScenario;
      } else if (payloadInfo.operationMode_setTemperature !== undefined) {
        nodeStatusText = nodeStatusText + ' @' + payloadInfo.operationMode_setTemperature + '°C';
      }
      node.status ({fill: node.status_icon[0], shape: node.status_icon[1], text: nodeStatusText});

      // Send msg back as new flow : only send update as new flow when something changed after having received this new BUS info
      // (but always send it when SmartFilter is disabled or when running in 'state/' mode, i.e. read-only mode)
      if (!config.skipevents || forceRefreshAndMsg) {
        let newPayloadinfo = JSON.stringify (payloadInfo);
        if (!config.smartfilter || newPayloadinfo !== node.lastPayloadInfo || forceRefreshAndMsg) {
          // MSG1 : Build primary msg
          // MSG1 : Received command info : only include source command when was provided as string (when is an array, it comes from .processInput redirected here)
          if (!Array.isArray(frame)) {
            payload.command_received = frame;
          }
          // MSG1 : Add all current node stored values to payload
          payload.state = payloadInfo.state;
          payload.remoteControl = payloadInfo.remoteControl;
          payload.operationMode = payloadInfo.operationMode;
          payload.operationMode_ownValue = payloadInfo.operationMode_ownValue;
          // MSG1 : Add all current node stored values to payload (but only if these were defined)
          if (payloadInfo.operationMode_setTemperature !== undefined) {
            payload.operationMode_setTemperature = payloadInfo.operationMode_setTemperature;
          }
          if (payloadInfo.operationMode_curProgram !== undefined) {
            payload.operationMode_curProgram = payloadInfo.operationMode_curProgram;
          }
          if (payloadInfo.operationMode_curScenario !== undefined) {
            payload.operationMode_curScenario = payloadInfo.operationMode_curScenario;
          }
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
        msg.payload = {'state': msg.payload.toString()};
      }
      let payload = msg.payload;

      // Build the OpenWebNet command(s) to be sent
      let commands = [];
      if (!isReadOnly) {
        // Running in Write mode
        let cmd_what = '';
        let isManualTemp = 0;
        // Add main & associated sub info if any
        for (let i = 0; i < operationModes_Params.length; i++) {
          // Use a regex to see if the current 'state' matches with this mode definition ('^' and '$' added to ensure it encloses start & end of string, partial match is nok)
          let stateMatch = payload.state.match('^' + operationModes_Params[i].state + '$');
          if (stateMatch !== null || payload.operationMode === operationModes_Params[i].mode) {
            cmd_what = operationModes_Params[i].own;
            // If this command as a dynamic part in it (i.e. '(.)' or '(..)'), process this
            let cmd_whatParam = '';
            if (stateMatch === null) {
              cmd_whatParam = payload['operationMode_' + operationModes_Params[i].addField];
            } else {
              cmd_whatParam = stateMatch[1];
            }
            let countPoints = cmd_what.split('.').length-1;
            if (cmd_whatParam && countPoints) {
              let whatSource = '(' + '.'.repeat(countPoints) + ')';
              let whatReplacer = ('0' + cmd_whatParam).slice(-countPoints);
              cmd_what = cmd_what.replace(whatSource , whatReplacer);
            }
            isManualTemp = (operationModes_Params[i].state.includes('MANUAL')) ? cmd_whatParam : 0;
            break;
          }
        }
        // After having parsed commands, apply final command : MANUAL mode a different one, while other ar 'simply' a WHAT command
        if (isManualTemp || parseFloat(payload.state)) {
          // Temperature to be set in MANUAL mode, command is *#4*where*#14*T*M##
          //  - where = [#1 - #99] Setup zone by Central Unit
          //  - The T field is composed from 4 digits c1c2c3c4, included between “0020” (2°temperature) and “0430” (43°temperature).
          //    c1 is always equal to 0, it indicates a positive temperature. The c2c3 couple indicates the temperature values between [02° - 43°].
          //  - M = operation mode : 1 = heating mode / 2 = conditional mode / 3 = generic mode
          let tempSet = parseInt((isManualTemp || payload.state)*10);
          if (tempSet < 20 || isNaN(tempSet)) {
            tempSet = 20;
          } else if (tempSet > 430) {
            tempSet = 430;
          }
          tempSet = ('0000' + tempSet.toString()).slice(-4);
          commands.push ('*#4*#0*#14*' + tempSet + '*' + (cmd_what + '3').slice(0,1) + '##');
        } else if (cmd_what) {
          commands.push ('*4*' + cmd_what + '*#0##');
        }
      }

      if (isReadOnly || commands.length) {
      // Working in read-only mode: build a status enquiry request (no status update sent)
        // In theory (based on OpenWebNet doc), only 1 call is required
        // Command #1 : *#4*#0## (where = #0 here) which returns multiple '*4*what*#0##' with different 'what' based on curtrent state
        // BUT, during test phase, it appears not all gateways react the same, as for zone
        //  - F455 : does provide the listed ones but also much more (2 on F459 -> 17 (!!) on F455. Also quite long delay before responses are all sent...). But OK, they are there
        //  - MH202 : does provide the listed ones but always returned 3 frame (what=22, 23 and 24) even if not probe OFF / Protection / manual at all...
        //  - F459 & MyHOMEServer1 : works as it should
        commands.push ('*#4*#0##');
      }
      if (commands.length === 0) {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, commands, gateway, 0, true,
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
          node.processReceivedBUSFrames (msg, cmd_responses);
        }, function (cmd_failed, nodeStatusErrorMsg) {
          // Error, only update node state
          node.status ({fill: 'red', shape: 'dot', text: nodeStatusErrorMsg});
        });
      };

      //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
      node.on ('close', function (done)	{
        // If any listener was defined, removed it now otherwise node will remain active in memory and keep responding to Gateway incoming calls
        runningMonitor.clearAllMonitoredEvents ();
        done();
      });
    }
    RED.nodes.registerType ('myhome-thermo-central', MyHomeThermoCentralNode);
  };
