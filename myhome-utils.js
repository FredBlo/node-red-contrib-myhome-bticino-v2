/*jshint esversion: 6, strict: implied, node: true */

var exports = module.exports = {};

const ACK  = '*#*1##';
const NACK = '*#*0##';
const START_COMMAND = '*99*0##';
const START_MONITOR = '*99*1##';
const SERVER_REQUIRES_HMAC1 = '*98*1##';
const SERVER_REQUIRES_HMAC2 = '*98*2##';
let net = require('net');

function processInitialConnection (startCommand, packet, netSocket, callingNode, gateway, persistentObj, error) {
  // Build (or get) default values from persistent object (which is kept by calling node and provided back at each received packet to be able to fill-in info)
  persistentObj.state = persistentObj.state || 'disconnected';
  persistentObj.HMAC_Auth = persistentObj.HMAC_Auth || [];
  let logEnabled = persistentObj.logEnabled || false;

  // When we have a non acknowledged return, always abord
  if (packet === NACK) {
    if (logEnabled) {callingNode.log ('gateway connection : NACK command received, abording.');}
    let errorMsg = "Gateway connection/authentication failed (NACK). Last reached state was '" + persistentObj.state + "'";
    persistentObj.state = 'disconnected';
    error (packet, errorMsg); // error callback to stop function
  }

  // The connection procedure differs based on how authentication is defined
  // - Open password check is not aske because we are connecting from an authorized IP range (=returns ACK directly)
  // - Open password check must be made in basic mode (password is numeric, client receives a hash and 'merges' it with password to return a kind of a hash
  // - Open password check must be made in HMAC mode (password is alphanumeric, server first responds with the HMAC mode being used, when acknowledged by client,
  //    returns a server random hash (Ra) which the client must use to generate its own random part (Rb), and a full hash result using the password (Ra,Rb,A,B,Kab),
  //    the server finally returns another hash the client was able to compute itself too when sending (Ra,Rb,Kab)
  if (persistentObj.state === 'connected') {
    // This function should never be called in connected mode, abord
    return;
  }
  if (persistentObj.state === 'disconnected') {
    if (packet == ACK) {
      if (logEnabled) {callingNode.log ('gateway connection : handshake acknowledged, asking for authentication if required...');}
      persistentObj.state = 'handshake';
      netSocket.write (startCommand);
    }
    return;
  }
  if (persistentObj.state === 'handshake') {
    // responded to an authentication request
    if (packet === ACK) {
      // No password to provide : working in local reserved network addresses
      if (logEnabled) {callingNode.log ('gateway connection : request to authenticate acknowledged, no password check required (working in local IP address allowed range)...');}
      persistentObj.state = 'authenticating';
    } else if (packet === SERVER_REQUIRES_HMAC1 || packet === SERVER_REQUIRES_HMAC2) {
      // The gateway sent back a HMAC authentication request in HMAC format, we acknowledge it to receive a Hash key
      let hmacType = (packet === SERVER_REQUIRES_HMAC1) ? 'SHA-1' : 'SHA-2 [256]';
      if (logEnabled) {callingNode.log ('gateway connection : request to authenticate acknowledged, authenticating using HMAC (' + hmacType + ') password check required...');}
      persistentObj.state = 'authenticating_HMAC';
      netSocket.write (ACK);
      return;
    } else {
      // The gateway requires a basic password authentication, retrieve the key to generate a hashed password
      let hashKey = packet.match(/^\*\#(\d+)\#\#/);
      if (hashKey === null) {
        if (logEnabled) {callingNode.warn ('gateway connection : request to authenticate acknowledged, no valid key received for basic password check.');}
      } else {
        // Use it to build hashed password
        if (logEnabled) {callingNode.log ('gateway connection : request to authenticate acknowledged, authenticating using basic password check...');}
        let hashedPwdCommand = '*#' + calcPass (gateway.pass, hashKey[1].toString()) + '##';
        persistentObj.state = 'authenticating';
        netSocket.write (hashedPwdCommand);
      }
      return;
    }
  }
  if (persistentObj.state === 'authenticating_HMAC') {
    // The gateway sent a random hashed key (Ra) needed to build a hash with password for connection request (Ra,Rb,A,B,Kab)
    let Ra = packet.match(/^\*\#(\d+)\#\#/);
    if (Ra === null) {
      if (logEnabled) {callingNode.warn ('gateway connection : HMAC authentication step 1 : invalid random hash (Ra) received from server [' + packet + ']');}
    } else {
      if (logEnabled) {callingNode.log ('gateway connection : HMAC authentication step 1 : random hash (Ra) received from server, sending response (Ra,Rb,A,B,Kab)...');}
      persistentObj.HMAC_Auth = calcHMAC (Ra[1], gateway.pass);
      persistentObj.state = 'authenticating_HMAC_HashSent';
      netSocket.write (persistentObj.HMAC_Auth[0]);
    }
    return;
  }
  if (persistentObj.state === 'authenticating_HMAC_HashSent') {
    // The gateway accepted the hash we send, which means password was OK, and it matches which what we expected (Ra,Rb,Kab)
    if (packet === persistentObj.HMAC_Auth[1]) {
      if (logEnabled) {callingNode.log ('gateway connection : HMAC authentication step 2 : hashed response received from server (Ra,Rb,Kab) matched expectation, password was accepted...');}
      persistentObj.state = 'authenticating';
      netSocket.write (ACK);
    } else {
      if (logEnabled) {callingNode.warn ('gateway connection : HMAC authentication step 2 : hashed response received from server (Ra,Rb,Kab) but did not match expectation, abording...');}
      netSocket.write (NACK);
      error (packet, 'HMAC authetication step 2 : hashed response received from server (Ra,Rb,Kab) but did not match expectation.'); // error callback to stop function
    }
  }
  if (persistentObj.state === 'authenticating') {
    if (logEnabled) {callingNode.warn ('gateway connection : Connection successful !');}
    persistentObj.state = 'connected';
    return true;
  }
}
exports.processInitialConnection = processInitialConnection;

function executeCommand (callingNode, command, gateway, success, error) {
  let net = require('net');

  let client = new net.Socket();
  let cmd_responses = [];
  let commandSent = false;
  let persistentObj = {};
  persistentObj.logEnabled = gateway.log_out_cmd;

  function internalError (packet, errorMsg) {
    persistentObj.state = 'disconnected';
    client.destroy();
    error (packet, command, errorMsg);
  }

  client.on ('error', function() {
    internalError ('', 'Command socket error');
  });

  client.connect (gateway.port, gateway.host, function() {
    // opening command session
  });

  client.on ('data', function (data) {
    let sdata = data.toString();

    while (sdata.length > 0) {
      let m = sdata.match (/(\*.+?##)(.*)/) || [];
      let packet = m[1] || '';
      sdata = m[2] || '';
      callingNode.debug ("mhutils.executeCommand('" + command + "'), collecting response(s) [#" + cmd_responses.length + "] (current: '" + packet + "' / buffered:'" + sdata + "' / full raw data : '" + data.toString() + "')");

      if (persistentObj.state !== 'connected') {
        // As long as initial connection is not OK, all packets are transmitted to a central function managing this
        processInitialConnection (START_COMMAND, packet, client, callingNode, gateway, persistentObj, internalError);
      }
      if (persistentObj.state !== 'connected') {
        // Still not connected
        return;
      } else if (packet === NACK) {
        // When we have a non acknowledged return, always generate error by calling error callback
        internalError (packet, 'Command not acknowledged (NACK) when already connected');
      } else if (!commandSent) {
        // We are connected, send the command now
        commandSent = true;
        if (persistentObj.logEnabled) {callingNode.log ("Command '" + command + "' sent using gateway...");}
        client.write (command);
        return;
      } else {
        if (packet !== ACK) {
          // Command was sent, but we still did not receive an acknowledged receipt, it means the socket is still emitting results of command sent
          cmd_responses.push (packet);
        } else {
          // Command was sent, ACK received, calling callback in success mode with all results
          client.destroy();
          success (packet, command, cmd_responses);
        }
      }
    }
  });

  client.on ('close', function() {
    // to verify that no connections are left open
    if (client !== undefined) {
      client.destroy();
    }
    return;
  });
}
exports.executeCommand = executeCommand;

class eventsMonitor {
  // This class is intended to manage listeners linked to a specifc objectf in a centralized object
  // to be able to easily clear them off when entity unloads
  constructor (monitoredEntity) {
    this.monitoredEntity = monitoredEntity;
    this.runningListeners = [];
  }

  addMonitoredEvent (eventName, eventFunction) {
    // Store the registered event to be able to de-actvate it when necessary
    let newListener = {};
    newListener.eventName = eventName;
    newListener.listenerFunction = eventFunction;
    this.runningListeners.push (newListener);
    // Register the listener
    this.monitoredEntity.addListener (newListener.eventName, newListener.listenerFunction);
  }

  clearAllMonitoredEvents () {
    // Disable all listeners which were activated
    for (let listenerCount = this.runningListeners.length-1 ; listenerCount >= 0  ; listenerCount--) {
      let runningListener = this.runningListeners[listenerCount];
      // Disable listener on monitored entity
      this.monitoredEntity.removeListener (runningListener.eventName, runningListener.listenerFunction);
      // Remove the listener from stored ones since no further call possible on it
      this.runningListeners.splice (listenerCount, 1);
    }
  }
}
exports.eventsMonitor = eventsMonitor;

// Secondary output generator (based on load ON/OFF state)
function buildSecondaryOutput (state, config, outputDefaultName, trueTextValue, falseTextValue) {
  // Build state content based on configured type (text or boolean)
  let msg2_value;
  if (config.output2_type === 'text_state') {
    // Working in text mode, the ouput is the state itself
    msg2_value = state;
  } else if (state === trueTextValue) {
    msg2_value = true;
  } else if (state === falseTextValue) {
    msg2_value = false;
  } else {
    msg2_value = -1;
  }

  // Build & return a new msg object
  let msg2 = {};
  msg2.topic = 'state/' + config.topic;
  let msg2_name = (config.output2_name === undefined) ? outputDefaultName : config.output2_name;
  if (msg2_name === '') {
    // Output property is empty, which means we have to return a non-object payload
    msg2.payload = msg2_value;
  } else {
    // Build a payload object using the defined property name
    msg2.payload = {};
    msg2.payload[msg2_name] = msg2_value;
  }
  return msg2;
}
exports.buildSecondaryOutput = buildSecondaryOutput;

// Function used to build HAC hashed value to connect to gateway secured in SHA1 or SHA256 mode
function calcHMAC (Ra, password) {
  const HMAC_COPEN = '736F70653E';
  const HMAC_SOPEN = '636F70653E';

  let crypto = require ('crypto');

  // Define which algorithm is being used based on received Ra length
  let shaAlgo = '';
  if (Ra.length === 80) {
    shaAlgo = 'sha1';
  } else if (Ra.length === 128) {
    shaAlgo = 'sha256';
  } else {
    return;
  }

  // Use a SHA enryptor to build hashed contents
  let Rb = crypto.createHmac(shaAlgo, Math.random().toString(36)).digest('hex');
  let pwd = crypto.createHash(shaAlgo).update(password).digest('hex');
  // Build the connection request to be sent (which is *#Rb*HMAC(Ra+Rb+A+B+Kab)##)
  let contentToHash = digitToHex(Ra) + Rb + HMAC_COPEN + HMAC_SOPEN + pwd;
  let connectionRequest = '*#' + hexToDigit(Rb) + '*' + hexToDigit(crypto.createHash(shaAlgo).update(contentToHash).digest('hex')) + '##'; // *Rb#HMAC(Ra+Rb+A+B+Kab)##
  // Build the expected response if connexion is OK (which is *#HMAC(Ra+Rb+Kab)##)
  contentToHash = digitToHex(Ra) + Rb + pwd;
  let expectedResponse = '*#' + hexToDigit(crypto.createHash(shaAlgo).update(contentToHash).digest('hex')) + '##' ;
  // Return connection request & expected response
  return [connectionRequest, expectedResponse];
}

// Function required for HMAC connection to convert BUS received values (numbers) to Hexa values
function digitToHex (toConvertVal){
    let convertedVal = "";
    for (let i = 0; i < toConvertVal.length; i=i+2) {
        let hexVal = parseInt(toConvertVal.slice(i, i+2)).toString(16);
        convertedVal = convertedVal + hexVal;
    }
    return convertedVal;
}

// Function required for HMAC connection to convert Hexa values to BUS acceptable values (numbers)
function hexToDigit (toConvertVal){
    let convertedVal = "";
    for (let i = 0; i < toConvertVal.length; i++) {
        let hexVal = parseInt(toConvertVal[i], 16);
        convertedVal = convertedVal + ('0' + hexVal).slice(-2);
    }
    return convertedVal;
}

// Function used in basic authentication mode to 'hash' the Open password
function calcPass (pass, nonce) {
  let flag = true;
  let num1 = 0x0;
  let num2 = 0x0;
  let password = parseInt(pass, 10);

  for (var c in nonce) {
    c = nonce[c];
    if (c!='0') {
      if (flag) num2 = password;
      flag = false;
    }
    switch (c) {
      case '1':
        num1 = num2 & 0xFFFFFF80;
        num1 = num1 >>> 7;
        num2 = num2 << 25;
        num1 = num1 + num2;
        break;
      case '2':
        num1 = num2 & 0xFFFFFFF0;
        num1 = num1 >>> 4;
        num2 = num2 << 28;
        num1 = num1 + num2;
        break;
      case '3':
        num1 = num2 & 0xFFFFFFF8;
        num1 = num1 >>> 3;
        num2 = num2 << 29;
        num1 = num1 + num2;
        break;
      case '4':
        num1 = num2 << 1;
        num2 = num2 >>> 31;
        num1 = num1 + num2;
        break;
      case '5':
        num1 = num2 << 5;
        num2 = num2 >>> 27;
        num1 = num1 + num2;
        break;
      case '6':
        num1 = num2 << 12;
        num2 = num2 >>> 20;
        num1 = num1 + num2;
        break;
      case '7':
        num1 = num2 & 0x0000FF00;
        num1 = num1 + (( num2 & 0x000000FF ) << 24 );
        num1 = num1 + (( num2 & 0x00FF0000 ) >>> 16 );
        num2 = ( num2 & 0xFF000000 ) >>> 8;
        num1 = num1 + num2;
        break;
      case '8':
        num1 = num2 & 0x0000FFFF;
        num1 = num1 << 16;
        num1 = num1 + ( num2 >>> 24 );
        num2 = num2 & 0x00FF0000;
        num2 = num2 >>> 8;
        num1 = num1 + num2;
        break;
      case '9':
        num1 = ~num2;
        break;
      case '0':
        num1 = num2;
        break;
    }
    num2 = num1;
  }
  return (num1 >>> 0).toString();
}
exports.calcPass = calcPass;
