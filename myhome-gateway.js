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
        parsePacket (data);
      });

      node.client.on ('error', function () {
        internalError ('', '', 'socket error connecting to ' + node.host + ':' + node.port);
      });

      node.client.on ('close', function() {
        internalError ('', '', 'socket connection closed');
      });

    function internalError (command, packet, errorMsg) {
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

var wouldHaveCrashed = 0; //DEBUG
var lastReadPacketInfo = ''; // DEBUG
    function parsePacket (data) {
      let sdata = data.toString();
      let bufferedReadCount = 0;

let packet = '';  // DEBUG
while (sdata.length > 0) {
  bufferedReadCount++;

  if (wouldHaveCrashed) {    // DEBUG
    console.warn ("Would have crashed " + wouldHaveCrashed + " packets ago. Now received '" + sdata + "', buffered index=" + bufferedReadCount);    // DEBUG
    wouldHaveCrashed++;    // DEBUG

    if (wouldHaveCrashed >> 5) {    // DEBUG
      //Reset
      wouldHaveCrashed = 0;    // DEBUG
    }    // DEBUG
  }    // DEBUG
  let m = sdata.match (/(\*.+?##)(.*)/) ;// || []; DEBUG
  if (m === null) { // DEBUG
    wouldHaveCrashed = 1; // DEBUG
    console.warn ("Would have crashed on packet : '" + sdata + "', previous packet '" + lastReadPacketInfo + "' buffered index=" + bufferedReadCount);    // DEBUG
    return;
  } else {   // DEBUG
    // let packet = m[1] || ''; // CORRRECT LINE
    packet = m[1] || ''; // DEBUG
    lastReadPacketInfo = packet + '(Buffer=' + bufferedReadCount + ')'; // DEBUG
    sdata = m[2] || '';
    // node.debug ("Parsing socket data (current: '" + packet + "' / buffered:'" + sdata + "' / full raw data : '" + data.toString() + "')"); // To include in final version but to test
  }

        if (persistentObj.state !== 'connected') {
          // As long as initial connection is not OK, all packets are transmitted to a central function managing this
          mhutils.processInitialConnection (START_MONITOR, packet, node.client, node, node, persistentObj, internalError);
        }
        if (persistentObj.state !== 'connected') {
          // Still not connected
          return;
        } else if (packet === NACK) {
          // When we have a non acknowledged return, always generate an internal error
          internalError (START_MONITOR, packet, 'Command not acknowledged (NACK) when already connected');
        } else {
          // Connexion is OK, running in MONITORING mode
          failedConnectionAttempts = 0;
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
              node.log ('Received OpenWebNet command [' + packet.toString() + ']; buffered index is ' + (bufferedReadCount-1).toString());
            }
            if (emitterTrigger !== '') {
              node.emit (emitterTrigger, packet);
            }
          }
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
        // node.client.write (); // TEST DEBUG
        node.client.write (ACK);
      }
    }
    let autoCheckConnection;
    if (node.timeout) {
      autoCheckConnection = setInterval (checkConnection, node.timeout);
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.on('close', function (done)	{
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
