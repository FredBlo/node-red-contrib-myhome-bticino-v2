/*jshint esversion: 7, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeEventSessionNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Add listener on node linked to a dedicated function call to be able to remove it on close
    const listenerFunction = function (ownFamilyName , frame) {
      // MSG1 : add frame received from BUS
      let msg = {payload: frame};
      // MSG1 : add major node configuration info
      msg.mh_nodeConfigInfo = {
        'name' : config.name ,
        'ownFamilyName' : ownFamilyName ,
        'gateway' : {
          'name' : gateway.name ,
          'host' : gateway.host ,
          'port' : gateway.port
        }
      };
      // MSG2 : build secondary output (detailled in 'universal mode')
      let msg2 = node.processReceivedBUSFrames (msg, ownFamilyName, frame);
      // Send both outputs
      node.send ([msg, msg2]);
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Add all listerners on gateway based on types we have to monitor
    // Define the function which is to be called on any triggered command received from the gateway

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
    // SCENARIO MANAGEMENT
    if (config.own_scenario) {
      runningMonitor.addMonitoredEvent ('OWN_SCENARIO', listenerFunction);
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
    // Function called when a MyHome BUS frame is received ///////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processReceivedBUSFrames = function (mainMsg, ownFamilyName, frame) {
      // Init new msg (cloned from main) & add basinc info on payload (common to all family types)
      let msg = RED.util.cloneMessage (mainMsg);
      let payload = msg.payload = {};
      payload.ownFamilyName = ownFamilyName;
      payload.command_received = frame;

      // Append content specifc per type
      let frameMatch;
      switch (ownFamilyName) {
        case 'OWN_LIGHTS':
          // Checks 1 : Light point/group update [*1*<status>|<dimmerLevel10>*where##]
          //    - <status> [0-1] : 0 = OFF / 1 = ON
          //    - <dimmerLevel10> [2-10] : 2 = 20% / 3 = 30% / ... / 9 = 90% / 10 = 100%
          // Note : the RegEx must only keep 2 characters when <status> begins with 1 to skip 30 or 31 since these are dimming UP / DOWN
          frameMatch = frame.match (/^\*1\*(\d|1\d)\*(#{0,1}\d{1,4})(?:#4#(\d\d)){0,1}##/);
          // frameMatch[1] = state (0 = off, 1 = on, 2 for 20%, 3 for 30%... 10 for 100%)
          // frameMatch[2] = lightgroupid (begins with # if is a group)
          // frameMatch[3] = bus level (01 to 15)
          if (frameMatch !== null) {
            payload.buslevel = (frameMatch[3] === undefined) ? 'private_riser' : frameMatch[3];
            payload.state = (frameMatch[1] === '0') ? 'OFF' : 'ON';
            payload.brightness = (frameMatch[1] === '1') ? 100 : (parseInt(frameMatch[1]) * 10);
            payload.lightid = frameMatch[2].replace('#' , '');
            payload.isgroup = (frameMatch[2][0] === '#');
          }
          // Checks 2 : Light point/group dimmer info update [*#1*<where>*1*<dimmerLevel100>*<dimmerSpeed>##]
          //    - <dimmerLevel100> [100-200] : 100 = off / 200 = Max
          if (frameMatch === null) {
            frameMatch = frame.match (/^\*#1\*(#{0,1}\d{1,4})(?:#4#(\d\d)){0,1}\*1\*(\d+)\*\d+##/);
            // frameMatch[1] = lightgroupid (begins with # if is a group)
            // frameMatch[2] = bus level (01 to 15)
            // frameMatch[3] = dimmer level (100 = OFF to 200 = 100%)
            if (frameMatch !== null) {
              payload.buslevel = (frameMatch[2] === undefined) ? 'private_riser' : frameMatch[2];
              payload.state = (frameMatch[3] === '100') ? 'OFF' : 'ON';
              payload.brightness = (parseInt(frameMatch[3]) - 100);
              payload.lightid = frameMatch[1].replace('#' , '');
              payload.isgroup = (frameMatch[1][0] === '#');
            }
          }
          break;

        case 'OWN_SHUTTERS':
            // Checks 1 : Shutter point/group update [*2*<status>*where##]
            //    - <status> [0-2] : 0 = Stop / 1 = Up / 2 = Down
          frameMatch = frame.match (/^\*2\*(\d+)\*(#{0,1}\d{1,4})(?:#4#(\d\d)){0,1}##/);
          // frameMatch[1] = <status> [0-2] : 0 = Stop / 1 = Up / 2 = Down
          // frameMatch[2] = shuttergroupid (begins with # if is a group)
          // frameMatch[3] = bus level (01 to 15)
          if (frameMatch !== null) {
            payload.buslevel = (frameMatch[3] === undefined) ? 'private_riser' : frameMatch[3];
            let actionDescr_Shutter = {'0':'STOP', '1':'OPEN', '2':'CLOSE'}[frameMatch[1]];
            payload.state = (actionDescr_Shutter === undefined) ? '?' : actionDescr_Shutter;
            payload.shutterid = frameMatch[2].replace('#' , '');
            payload.isgroup = (frameMatch[2][0] === '#');
          }
        	break;

        case 'OWN_TEMPERATURE':
        	// Nothing managed in 'universal mode' yet
        	break;

        case 'OWN_SCENARIO':
        	// Nothing managed in 'universal mode' yet
          // Checks 1 : Basic scenario (CEN) [*15*WHAT(#<ACTION_TYPE>)*WHERE##]
          //    - WHAT = push button N value [00-31]
          //    - <ACTION_TYPE> = 1: Release after short pressure (<0.5s) / 2: Release after an extended pressure (>= 0.5s) / 3: Extended pressure (sent every 0.5s as long as button is pressed)
          //    - WHERE = push button virtual address (A/PL)
          frameMatch = frame.match (/^\*15\*(\d+)#{0,1}(\d|)\*(\d{2,4})(?:#4#(\d\d)){0,1}##/);
          // frameMatch[1] = push button N value [00-31]
          // frameMatch[2] = <ACTION_TYPE>
          // frameMatch[3] = WHERE = push button virtual address (A/PL)
          // frameMatch[4] = bus level (01 to 15)
          if (frameMatch !== null) {
            payload.buslevel = (frameMatch[4] === undefined) ? 'private_riser' : frameMatch[4];
            payload.scenariotype = 'CEN';
            payload.scenarioid = frameMatch[3];
            payload.buttonID = frameMatch[1];
            let actionDescr_CEN = {'1':'SHORT', '2':'LONG', '3':'LONG_ONGOING'}[frameMatch[2]];
            payload.actionType = (actionDescr_CEN === undefined) ? 'PRESS_START' : actionDescr_CEN;
          }
          // Checks 2 : Advanced scenario (CEN+) [*25*<ACTION_TYPE>#WHAT*WHERE##]
          //    - <ACTION_TYPE> = 21: Short pressure (<0.5s) / 22: Start of extended pressure (>= 0.5s) / 23: Extended pressure (sent every 500ms) / 24: Release after an extended pressure
          //    - WHAT = push button N value [0-31]
          //    - WHERE = 2+[0-2047] Virtual Address
          if (frameMatch === null) {
            frameMatch = frame.match (/^\*25\*(\d{2})#(\d+)\*2(\d{1,4})(?:#4#(\d\d)){0,1}##/);
            // frameMatch[1] = <ACTION_TYPE>
            // frameMatch[2] = WHAT : push button N value [0-31]
            // frameMatch[3] = WHERE : [0-2047] Virtual Address
            // frameMatch[4] = bus level (01 to 15)
            if (frameMatch !== null) {
              payload.buslevel = (frameMatch[4] === undefined) ? 'private_riser' : frameMatch[4];
              payload.scenariotype = 'CEN+';
              payload.scenarioid = frameMatch[3];
              payload.buttonID = frameMatch[2];
              let actionDescr_CEN = {'21':'SHORT', '22':'LONG_START', '23':'LONG_ONGOING', '24':'LONG'}[frameMatch[1]];
              payload.actionType = (actionDescr_CEN === undefined) ? '?' : actionDescr_CEN;
            }
          }
        	break;

        case 'OWN_ENERGY':
        	// Nothing managed in 'universal mode' yet
        	break;
        case 'OWN_OTHERS':
        	// Nothing managed in 'universal mode' yet
        	break;
      }
        // Checks : all done, if one match was successful, it means a 'universal mode' msg was build, return it
        if (frameMatch !== null) {
          return msg;
        }
    };

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    node.on ('close', function(done)	{
      runningMonitor.clearAllMonitoredEvents ();
      done();
    });
  }
  RED.nodes.registerType ("myhome-eventsession", MyHomeEventSessionNode);
};
