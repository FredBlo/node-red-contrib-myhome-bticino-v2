module.exports = function (RED) {
  let net = require ('net');
  let mhutils = require ('./myhome-utils');

  const ACK  = '*#*1##';
  const NACK = '*#*0##';
  const START_MONITOR = '*99*1##';
  const RESTART_CONNECT_TIMEOUT = 500; // ms
  const RESTART_CONNECT_TIMEOUT_MAX = 30000; // ms

  // WHO=4 passive discovery, one regex per frame shape myhome-thermo-zone.js itself reads
  const ZONE_DISCOVERY_REGEXES = [
    /^\*#4\*([1-9]\d?)\*(?:0|14)\*\d{4}(?:\*3)?##/, // master probe temperature / set-point temperature
    /^\*4\*\d+\*([1-9]\d?)##/,                       // zone operation mode (master-probe WHERE)
    /^\*#4\*([1-9]\d?)#\d\*20\*\d##/,                // actuator status for zone
    /^\*#4\*([1-9]\d?)\*13\*\d{2}##/,                // local offset status
    /^\*4\*\d{3}\*#([1-9]\d?)##/                     // zone operation mode via Central Unit
  ];

  function MyHomeGatewayNode (config) {
    RED.nodes.createNode (this, config);

    var node = this;
    let persistentObj = {logEnabled:true}; // Log is always enabled when gateway connects
    let failedConnectionAttempts = 0;
    let isTryingToConnect = false;

    node.client = undefined;
    node.host = config.host;
    node.port = config.port;
    node.pass = config.pass || '';
    node.lights_onconnect_refreshloads = config.lights_onconnect_refreshloads;
    node.shutters_onconnect_refreshstate = config.shutters_onconnect_refreshstate;
    node.points = Array.isArray (config.points) ? config.points : []; // BUS points registry (room/description/icon/... per category) - read by device nodes for msg.mh_nodeConfigInfo
    node.log_out_cmd = config.log_out_cmd || false;
    node.discoveredPoints = { light: {}, shutter: {}, energy: {}, thermozone: {} }; // all points for which something was seen on the BUS. Used by the gateway config editor for auto-discovered points
    node.log_config = {
      "log_out_cmd": config.log_out_cmd || false,
      "log_in_lights": config.log_in_lights || false,
      "log_in_shutters": config.log_in_shutters || false,
      "log_in_temperature": config.log_in_temperature || false,
      "log_in_scenario": config.log_in_scenario || false,
      "log_in_energy": config.log_in_energy || false,
      "log_in_others": config.log_in_others || false
    };
    node.timeout = (Number(config.timeout) || 0)*1000; // ms
    node.setMaxListeners (100);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.client = new net.Socket();

      node.client.on ('data', function (data) {
        let allframes = data.toString();
        let bufferedFrames = allframes;
        while (bufferedFrames.length > 0) {
          let frameMatch = bufferedFrames.match (/(\*.+?##)(.*)/) || [];
          let frame = frameMatch[1] || '';
          bufferedFrames = frameMatch[2] || '';
          if (frame) {
            node.debug ("Parsing socket data (current: '" + frame + "' / buffered:'" + bufferedFrames + "' / full raw data : '" + allframes + "')");
            // As long as initial connection is not OK, all frames are transmitted to a central function managing this
            if (mhutils.processInitialConnection (START_MONITOR, frame, node.client, node, node, persistentObj, internalError)) {
              // We are connected OK, pass the frame to the commands & responses management part
              failedConnectionAttempts = 0;
              parseFrame (frame);
            }
          }
        }
      });

      node.client.on ('error', function () {
        internalError ('', 'socket error connecting to ' + node.host + ':' + node.port);
      });

      node.client.on ('close', function() {
        internalError ('', 'socket connection closed');
      });

    function internalError (cmd_failed, errorMsg) {
      // In case of error / disconnection / close, try automated restart
      node.warn ("gateway connection issue (" + errorMsg + "): last known state was '" + persistentObj.state + "', trying to re-connect...");
      node.disconnect (RESTART_CONNECT_TIMEOUT);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    function instanciateClient (delayBeforeRestart) {
      // Try to connect (but do not allow 2 parallel calls)
      if (isTryingToConnect) {
        return;
      }
      // Keep track of attempted connections count and status (to avoid multiple attempts at the same time)
      isTryingToConnect = true;
      failedConnectionAttempts++;
      node.log ('gateway connection : instantiating client... (attempt #' + failedConnectionAttempts + ')');
      // if no more client available, re-init one
      if (node.client === undefined) {
        node.client = new net.Socket();
      }
      // Try to connect (if failed attempts occurred before, wait a bit more after each attempt to avoid overloading
      // the socket, to a max time between tries being the time-out time defined)
      let restartTimeout = (typeof(delayBeforeRestart) === 'undefined') ? RESTART_CONNECT_TIMEOUT : delayBeforeRestart;
      restartTimeout = Math.min (restartTimeout * failedConnectionAttempts, RESTART_CONNECT_TIMEOUT_MAX);
      if (restartTimeout > 0) {
        node.log ('gateway connection : trying to reconnect to host in ' + restartTimeout/1000 + 's');
      }
      setTimeout (function() {
        instanciateClient_Connect ();
        isTryingToConnect = false;
      }, restartTimeout);

      function instanciateClient_Connect() {
        node.log ('gateway connection : trying to connect to host...(' + node.host + ':' + node.port + ')');
        node.client.connect (node.port, node.host, function() {
          // request monitoring session (first connect returns a 'ACK' which is managed parsing frames)
          node.log ('gateway connection : connected to host (' + node.host + ':' + node.port + '), initiating TCP monitoring...');
        });
      }
    }

    function parseFrame (frame) {
      if (frame === NACK) {
        // When we have a non acknowledged return while connected, we ignore the error
        // The MH201 returns a NACK on the keep alive process (which sends an ACK), and since MONITORING never sends commands, NACK can be ignored
        // internalError (START_MONITOR, 'Command not acknowledged (NACK) when already connected');
        return;
      }

      // Get the OpenWebNet WHO family linked to this command (structure is '*WHO*WHAT*WHERE##', and can be '*#WHO*WHAT*WHERE' for some kind of calls)
      let ownFamily = frame.match (/^\*#{0,1}(\d+)\*.+?##/);
      if (ownFamily !== null) {
        let loggingEnabled = false;
        let ownFamilyName = "";
        if (ownFamily !== null) {
          switch (ownFamily[1]) {
            case '1': {
              // WHO = 1 : Lighting
              loggingEnabled = node.log_config.log_in_lights;
              ownFamilyName = 'OWN_LIGHTS';
              // Passively note down which AP this frame came from (WHERE), whatever its state (WHAT) is
              let whereMatch = frame.match (/^\*1\*\d+\*(#?\d{1,4})(#4#(\d\d))?##/);
              if (whereMatch) {
                let buslevel = whereMatch[3] || '';
                let pointid = whereMatch[1].replace ('#', '');
                let isgroup = whereMatch[1].charAt(0) === '#';
                let pointbusid = whereMatch[1] + (whereMatch[2] || '');
                node.discoveredPoints.light[pointbusid] = {buslevel: buslevel, pointid: pointid, isgroup: isgroup};
              }
              break;
            }
            case '2': {
              // WHO = 2 : Automation (Shutters management)
              loggingEnabled = node.log_config.log_in_shutters;
              ownFamilyName = 'OWN_SHUTTERS';
              // Passively note down which AP this frame came from (WHERE), whatever its state (WHAT) is
              let whereMatch = frame.match (/^\*2\*\d+\*(#?\d{1,4})(#4#(\d\d))?##/);
              if (whereMatch) {
                let buslevel = whereMatch[3] || '';
                let pointid = whereMatch[1].replace ('#', '');
                let isgroup = whereMatch[1].charAt(0) === '#';
                let pointbusid = whereMatch[1] + (whereMatch[2] || '');
                node.discoveredPoints.shutter[pointbusid] = {buslevel: buslevel, pointid: pointid, isgroup: isgroup};
              }
              break;
            }
            case '4': {
              // WHO = 4 : Temperature Control/Heating
              loggingEnabled = node.log_config.log_in_temperature;
              ownFamilyName = 'OWN_TEMPERATURE';
              // Passively note down which zone this frame came from (WHERE) - see ZONE_DISCOVERY_REGEXES above.
              for (let re of ZONE_DISCOVERY_REGEXES) {
                let whereMatch = frame.match (re);
                if (whereMatch) {
                  node.discoveredPoints.thermozone[whereMatch[1]] = {buslevel: 'private_riser', pointid: whereMatch[1], isgroup: false};
                  break;
                }
              }
              break;
            }
            case '15' : case '25' : {
              // WHO = 15 (CEN) / 25 (CEN+) : Scenario Management
              loggingEnabled = node.log_config.log_in_scenario;
              ownFamilyName = 'OWN_SCENARIO';
              break;
            }
            case '18': {
              // WHO = 18 : Energy Management
              loggingEnabled = node.log_config.log_in_energy;
              ownFamilyName = 'OWN_ENERGY';
              // Passively note down which meter/actuator this frame came from (WHERE), only forsponse, not a bare request
              let whereMatch = frame.match (/^\*#18\*(5\d{1,3}|7\d{1,3}#0)\*[\d#]+\*(\d+\*)?\d+##/);
              if (whereMatch) {
                let isActuator = whereMatch[1].indexOf ('#0') >= 0;
                let pointid = whereMatch[1].replace (/^[57]/, '').replace ('#0', '');
                node.discoveredPoints.energy[whereMatch[1]] = {buslevel: (isActuator ? 'actuator' : 'meter'), pointid: pointid, isgroup: false};
              }
              break;
            }
            default: {
              loggingEnabled = node.log_config.log_in_others;
              ownFamilyName = 'OWN_OTHERS';
            }
          }
        }
        if (loggingEnabled) {
          node.log ("Received OpenWebNet command (" + ownFamilyName + ") : '" + frame + "'");
        }
        if (ownFamilyName !== '') {
          node.emit (ownFamilyName, ownFamilyName , frame);
        }
      }
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.disconnect = function (restartTimeout) {
      // Only warn / update status when status is not already 'disconnected'
      if (persistentObj.state !== 'disconnected') {
        node.warn ("gateway connection : disconnected from host, last known state was '" + persistentObj.state + "'." + ((restartTimeout) ? ' Auto retry activated.' : ''));
        persistentObj.state = 'disconnected';
      }
      // if client is still running, stop it
      if (node.client !== undefined) {
        node.client.removeAllListeners ('connect'); // Ensure no more 'connect' listeners are left (which would be called back multiple times on re-connect)
        node.client.destroy();
      }
      // Restart the client if asked (but only after the specified number of ms)
      if (restartTimeout > 0) {
        instanciateClient (restartTimeout);
      }
    };

    instanciateClient (0);
    // Once client is started, init a repeater which will keep connection alive (only if configured so in gateway)
    // TechNote :
    //  - sending a START_MONITOR command here causes some gateways (myHOMEServer1) to close connection, forcing a re-instantiation, ACK is enough...
    //  - but when sending a simple ACK, some (MH201) returned a NACK, which is now no longer forcing a disconnection in the gateway.
    function checkConnection() {
      if (failedConnectionAttempts === 0) {
        node.debug ('gateway connection : keeping connection alive every ' + node.timeout/1000 + 's ...');
        node.client.write (ACK);
      }
    }
    let autoCheckConnection;
    if (node.timeout) {
      autoCheckConnection = setInterval (checkConnection, node.timeout);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.on ('close', function (done)	{
      // Disable auto-refresh of connection & close connection properly
      if (autoCheckConnection !== undefined) {
        clearInterval(autoCheckConnection);
      }
      node.disconnect (0);
      node.client.removeAllListeners ('connect');
      node.client.removeAllListeners ('close');
      node.client.removeAllListeners ('error');
      node.client.removeAllListeners ('data');
      node.client.close();
      done();
    });
  }
  RED.nodes.registerType ('myhome-gateway', MyHomeGatewayNode);

  //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Admin endpoint used by the gateway config editor's points-registry sections to read AP passively
  // observed so far on the bus (see node.discoveredPoints above) - a plain read of already-known state,
  // triggers nothing on the bus itself, so it is safe to call every time the editor dialog opens.
  // A category not (yet) tracked in node.discoveredPoints simply returns no points, not an error.
  RED.httpAdmin.get ('/myhome-bticino/gateway/:id/discovered-points/:category', RED.auth.needsPermission ('myhome-gateway.read'), function (req, res) {
    let gatewayNode = RED.nodes.getNode (req.params.id);
    let categoryPoints = gatewayNode ? gatewayNode.discoveredPoints[req.params.category] : undefined;
    res.json ({points: categoryPoints ? Object.values (categoryPoints) : []});
  });
};
