/*jshint esversion: 6, strict: implied, node: true */

module.exports = function (RED) {
  let net = require ('net');
  let mhutils = require ('./myhome-utils');

  const ACK  = '*#*1##';
  const NACK = '*#*0##';
  const START_MONITOR = '*99*1##';
  const RESTART_CONNECT_TIMEOUT = 500; // ms
  const RESTART_CONNECT_TIMEOUT_MAX = 30000; // ms

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
    node.log_out_cmd = config.log_out_cmd || false;
    node.timeout = (Number(config.timeout) || 0)*1000; // ms
    node.setMaxListeners (100);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.client = new net.Socket();

      node.client.on ('data', function (data) {
        let allframes = data.toString();
        let bufferedFrames = allframes;
        while (bufferedFrames.length > 0) {
          let packetMatch = bufferedFrames.match (/(\*.+?##)(.*)/) || [];
          let packet = packetMatch[1] || '';
          bufferedFrames = packetMatch[2] || '';
          if (packet) {
            node.debug ("Parsing socket data (current: '" + packet + "' / buffered:'" + bufferedFrames + "' / full raw data : '" + allframes + "')");
            // As long as initial connection is not OK, all packets are transmitted to a central function managing this
            if (mhutils.processInitialConnection (START_MONITOR, packet, node.client, node, node, persistentObj, internalError)) {
              // We are connected OK, pass the packet to the commands & responses management part
              failedConnectionAttempts = 0;
              parsePacket (packet);
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
      // Keep track of attempted connexions count and status (o avoid multiple tries at a same time)
      isTryingToConnect = true;
      failedConnectionAttempts++;
      node.log ('gateway connection : instanciating client... (attempt #' + failedConnectionAttempts + ')');
      // if no more clien available, re-init one
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
          // request monitoring session (first connect returns a 'ACK' which is managed parsing packets)
          node.log ('gateway connection : connected to host (' + node.host + ':' + node.port + '), initiating TCP monitoring...');
        });
      }
    }

    function parsePacket (packet) {
      if (packet === NACK) {
        // When we have a non acknowledged return, always generate an internal error
        internalError (START_MONITOR, 'Command not acknowledged (NACK) when already connected');
        return;
      }

      // Get the OpenWebNet WHO family linked to this command (structure is '*WHO*WHAT*WHERE##', and can be '*#WHO*WHAT*WHERE' for some kind of calls)
      let ownFamily = packet.match (/^\*#{0,1}(\d+)\*.+?##/);
      if (ownFamily !== null) {
        let loggingEnabled = false;
        let emitterTrigger = "";
        if (ownFamily !== null) {
          switch (ownFamily[1]) {
            case '1':
              // WHO = 1 : Lighting
              loggingEnabled = config.log_in_lights;
              emitterTrigger = 'OWN_LIGHTS';
              break;
            case '2':
              // WHO = 2 : Automation (Shutters management)
              loggingEnabled = config.log_in_shutters;
              emitterTrigger = 'OWN_SHUTTERS';
              break;
            case '4':
              // WHO = 4 : Temperature Control/Heating
              loggingEnabled = config.log_in_temperature;
              emitterTrigger = 'OWN_TEMPERATURE';
              break;
            case '15' : case '25' :
              // WHO = 15 (CEN) / 25 (CEN+) : Scenario Management
              loggingEnabled = config.log_in_scenario;
              emitterTrigger = 'OWN_SCENARIO';
              break;
            case '18':
              // WHO = 18 : Energy Management
              loggingEnabled = config.log_in_energy;
              emitterTrigger = 'OWN_ENERGY';
              break;
            default:
              loggingEnabled = config.log_in_others;
              emitterTrigger = 'OWN_OTHERS';
          }
        }
        if (loggingEnabled) {
          node.log ("Received OpenWebNet command (" + emitterTrigger + ") : '" + packet + "'");
        }
        if (emitterTrigger !== '') {
          node.emit (emitterTrigger, packet);
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
    // Once client is started, init a repeater which will keep connection alive (ony if configured so in gateway)
    // TechNote : sending a START_MONITOR command here cause some gateways (myHOMEServer1) to close connection, forcing a re-instatition, ACK is enough
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
};
