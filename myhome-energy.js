/*jshint esversion: 7, strict: implied, node: true */

module.exports = function (RED) {
  let mhutils = require ('./myhome-utils');

  function MyHomeEnergyNode (config) {
    RED.nodes.createNode (this, config);
    var node = this;
    let gateway = RED.nodes.getNode (config.gateway);
    let runningMonitor = new mhutils.eventsMonitor (gateway);

    // Build the meter used 'WHERE'. If node is configured as being an actuator, is '7N#0' , and '5N' for power meters,
    // where N is the ID number [1-255].
    node.meterid = ((config.metertype === 'actuator') ? ('7' + config.meterid + '#0') : ('5'+ config.meterid));
    // Caching mechanism init : only for types which return complete data from the past
    node.enableCache = (config.enablecache && (config.meterscope === 'hour' || config.meterscope === 'day' || config.meterscope === 'month'));
    node.cachedInfo = {};

    // All current zone received values stored in memory from the moment node is loaded
    let payloadInfo = node.payloadInfo = {};
    node.lastPayloadInfo = JSON.stringify (payloadInfo); // SmartFilter : kept in memory to be able to compare whether an update occurred while processing msg

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Register node for updates
    node.on ('input', function (msg) {
      node.processInput (msg);
    });

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Add listener on node linked to a dedicated function call to be able to remove it on close
    const listenerFunction = function (packet) {
      let msg = {};
      node.processReceivedBUSCommand (msg, packet, []);
    };
    runningMonitor.addMonitoredEvent ('OWN_ENERGY', listenerFunction);

    function dateFormat (dateToFormat , textFormat) {
      // Function to convert a provided date to a fixed 'readable' date+time format
      //  - dateToFormat : any content which can be converted to a valid date-time
      //  - textFormat : the output wanted as text (such as YYYMMDD, YY-MM-DD, MMDD-hh:nn:ss)
      //              (only YY, YYYY, MM, DD, hh, nn, ss are supported for now, multiple )
      let dateInit = new Date(dateToFormat);
      let formattedDate = textFormat
        .replace('YYYY' , dateInit.getFullYear())
        .replace('YY' , dateInit.getFullYear().toString().slice(-2))
        .replace('MM' , ('0' + (dateInit.getMonth()+1)).slice(-2))
        .replace('M' , (dateInit.getMonth()+1))
        .replace('DD' , ('0' + dateInit.getDate()).slice(-2))
        .replace('D' , dateInit.getDate())
        .replace('hh' , ('0' + dateInit.getHours()).slice(-2))
        .replace('nn' , ('0' + dateInit.getMinutes()).slice(-2))
        .replace('ss' , ('0' + dateInit.getSeconds()).slice(-2));

      return formattedDate;
    }

    function numberHumanReadadble (numberToFormat , suffix) {
      // Function to convert a provided date number to a 'human readable' (980 remains 980, 1980 becomes 1,98k, 1980654 becomes 1,98M)
      //  - numberToFormat : the number to process
      //  - suffix : optional suffix to append at the end of string returned

      // When provided number is very large, first bring it back to 'Mega' or 'kilo' corresponding value
      if (numberToFormat > 10**6) {
        numberToFormat = numberToFormat / 10**6;
        suffix = 'M' + suffix;
      } else if (numberToFormat > 10**3) {
        numberToFormat = numberToFormat / 10**3;
        suffix = 'k' + suffix;
      }
      // Return string values only keeping 2 decimals + built (and provided) suffix(es)
      return (Math.round(numberToFormat*100)/100).toLocaleString() + suffix;
    }

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a MyHome BUS command is received /////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processReceivedBUSCommand = function (msg, packet, finalRequiredCachedIDs) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;
      // When the function is called with a specified list of required entries from the cache, it means function was called internally (from 'processInput')
      // to return content (for which maybe no command was required because all are already in cache)
      let forceFromCacheAndMsg = (finalRequiredCachedIDs.length > 0);

      // Check whether received command is linked to current configured light point
      payloadInfo.metered_Info = [];
      let processedPackets = 0;
      let curDateTime = new Date();
      let nodeStatusInfo = []; // [fill , shape , text]

      for (let curPacket of (typeof(packet) === 'string') ? [packet] : packet) {
        let packetMatch = null;
        let packetInfo = {};

        switch (config.meterscope) {
          case 'instant':
            // Check 1 [WHAT=113] : Current power consumption (Instant, in Watts) [*#18*<Where>*113*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*113\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_Scope = 'instant';
	            packetInfo.metered_From = curDateTime.toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'instant' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'ring' , dateFormat(packetInfo.metered_From , 'hh:nn:ss') + ': ' + numberHumanReadadble(packetInfo.metered_Power , 'W')];
            }
            break;
          case 'day_uptonow':
            // Check 2 [WHAT=54] : Current daily consumption (today, in Wh) [*#18*where*54*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*54\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_Scope = 'day_uptonow';
              packetInfo.metered_From = new Date(curDateTime.getFullYear() , curDateTime.getMonth() , curDateTime.getDate() , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateFormat(packetInfo.metered_From , 'DD-MM-YYYY') + ': ' + numberHumanReadadble(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'day':
            // Check 3a [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>*<Tag>*<Val>##]
            //           with <Tag> is the hour [1-24], '25' being day total <Val> =WATT)
            //           ==> '25' is thus the only analyzed for daily
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*511#(\\d{1,2})#(\\d{1,2})\\*25\\*(\\d+)##');
            if (packetMatch !== null) {
              // If the month received in the command returned is after current month, it means we are reading data from previous year
              let yearCorrection = (packetMatch[1] > curDateTime.getMonth()+1) ? -1 : 0 ;
              // Specified <Tag> is 25, it means this is the day total
              packetInfo.metered_Scope = 'day';
              packetInfo.metered_From = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , 23 , 59 , 59).toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[3]);
              // Manage the cached content : Build ID, for monthly mode is 'hour_YYYY-MM-DD'
              packetInfo.metered_CacheID = packetInfo.metered_Scope + "_" + dateFormat (packetInfo.metered_From , 'YYYY-MM-DD');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateFormat(packetInfo.metered_From , 'DD-MM-YYYY') + ': ' + numberHumanReadadble(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'hour':
            // Check 3b [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>*<Tag>*<Val>##]
            //           with <Tag> is the hour [1-24], '25' being day total <Val> =WATT)
            //           ==> '25' is thus skipped for hourly analysis
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*511#(\\d{1,2})#(\\d{1,2})\\*(?!25)(\\d{1,2})\\*(\\d+)##');
            if (packetMatch !== null) {
              // If the month received in the command returned is after current month, it means we are reading data from previous year
              let yearCorrection = (packetMatch[1] > curDateTime.getMonth()+1) ? -1 : 0 ;
              // Specified <Tag> is 1-24, it means this is the hour total
              packetInfo.metered_Scope = 'hour';
              packetInfo.metered_From = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , packetMatch[3]-1 , 0 , 0).toLocaleString();
              packetInfo.metered_To = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , packetMatch[3]-1 , 59 , 59).toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[4]);
              // Manage the cached content : Build ID, for monthly mode is 'hour_YYYY-MM-DD_hh'
              packetInfo.metered_CacheID = packetInfo.metered_Scope + "_" + dateFormat (packetInfo.metered_From , 'YYYY-MM-DD_hh');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateFormat(packetInfo.metered_From , 'DD-MM-YYYY hh') + 'h: ' + numberHumanReadadble(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'month_uptonow':
            // Check 4 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*53\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_Scope = 'month_uptonow';
              packetInfo.metered_From = new Date(curDateTime.getFullYear() , curDateTime.getMonth(), 1 , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateFormat(packetInfo.metered_From , 'MM-YYYY') + ': ' + numberHumanReadadble(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'month':
            // Checks 5 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*52#(\\d{2})#(\\d{1,2})\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_Scope = 'month';
              packetInfo.metered_From = new Date('20'+packetMatch[1] , +packetMatch[2]-1 , 1 , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = new Date('20'+packetMatch[1] , +packetMatch[2] , 0 , 23 , 59 , 59).toLocaleString();
              if (parseInt(packetMatch[3]) === (2**32-1)) {
                // When meter returns '4294967295' (=full 32bits with first =0, 2^32-1), it means no data exists
                packetInfo.metered_Power = 0;
              } else {
                packetInfo.metered_Power = parseInt(packetMatch[3]);
              }
              // Manage the cached content : Build ID, for monthly mode is 'month_YYYY-MM'
              packetInfo.metered_CacheID = packetInfo.metered_Scope + "_" + dateFormat (packetInfo.metered_From , 'YYYY-MM');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateFormat(packetInfo.metered_From , 'MM-YYYY') + ': ' + numberHumanReadadble(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'sincebegin':
            // Checks 6 [WHAT=51] : Full consumption since begin (up to today, in Wh) [*#18*where*51*<Val>##]	with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*51\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_Scope = 'sincebegin';
              packetInfo.metered_From = new Date(2000 , 0 , 1 , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , 'From begin: ' + numberHumanReadadble(packetInfo.metered_Power , 'Wh')];
            }
            break;
        }

        // If we reached here with a non null match, it means command was useful for node
        if (packetMatch !== null) {
          processedPackets++;
          // Update Node displayed status
          node.status ({fill: nodeStatusInfo[0], shape: nodeStatusInfo[1], text: nodeStatusInfo[2]});
          // Add info common to any call
          packetInfo.metered_Command = curPacket;
          // Cache management : if the generated content has to be kept in memory, add it to cached content now
          // Note : we only keep in cache content which is fully in the past, since meters which range is (partially) in the future are still not 100% OK
          if (node.enableCache) {
            if (packetInfo.metered_CacheID && (new Date(packetInfo.metered_To) < curDateTime)) {
                node.cachedInfo[packetInfo.metered_CacheID] = packetInfo;
            }
          }
          // Add generated packet object to the global packet info store
          payloadInfo.metered_Info.push (packetInfo);
          // If this entry was one of the required based on cached ID, remove it from those which have to be added after having processed all commands
          let wasRequiredCacheID = finalRequiredCachedIDs.indexOf(packetInfo.metered_CacheID);
          if (wasRequiredCacheID >= 0) {
            finalRequiredCachedIDs.splice(wasRequiredCacheID , 1);
          }
        }
      }
      // All commands have been processed, add others from cache for those which were not retrieved and are left in ID list
      finalRequiredCachedIDs.forEach(function(requiredCachedID) {
        if (node.cachedInfo[requiredCachedID]) {
          // Required ID exists, add it to final list now
          payloadInfo.metered_Info.push (node.cachedInfo[requiredCachedID]);
        } else {
          // Nothing found in cache for this ID, add an empty item
          payloadInfo.metered_Info.push ({'metered_CacheID' : requiredCachedID});
        }
      });

      // Checks : all done, if nothing was processed, abord (no node / flow update detected), excepted when refresh is 'forced' from cache
      if (processedPackets === 0 && !forceFromCacheAndMsg) {
        return;
      }

      // Send msg back as new flow : only send update as new flow when something changed after having received this new BUS info
      // (but always send it when SmartFilter is disabled or when running in 'state/' mode, i.e. read-only mode)
      if (!config.skipevents || forceFromCacheAndMsg) {
        let newPayloadinfo = JSON.stringify (payloadInfo);
        if (!config.smartfilter || newPayloadinfo !== node.lastPayloadInfo || forceFromCacheAndMsg) {
          // MSG1 : Build primary msg
          // MSG1 : Received command info : only include source command when was provided as string (when is an array, it comes from .processInput redirected here)
          if (!Array.isArray(packet)) {
            payload.command_received = packet;
          }
          // MSG1 : Add all current node stored values to payload

          // TODO : current raw transfer of all data is made for debug / analysis
          Object.getOwnPropertyNames(payloadInfo).forEach (function(objectName , i) {
            payload[objectName] = payloadInfo[objectName];
          });
          // END // TODO:

          // MSG1 : Add misc info
          msg.topic = 'state/' + config.topic;

          // MSG2 : Build secondary payload
          let msg2 = mhutils.buildSecondaryOutput (payloadInfo, config, 'On', 'ON', 'OFF');

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
      if (typeof(msg) === 'string') {
        try {msg = JSON.parse(msg);} catch(error){}
      }
      // Only process input received from flow when the topic matches with configuration of nodes
      if (msg.topic === 'state/' + config.topic) {
        // Running in 'state/' mode, force read-only regardless of node config mode

      } else if (msg.topic !== 'cmd/' + config.topic) {
// return;
      }

      // Get payload and apply conversions (asked state can be set in 'msg.payload',
      // 'msg.payload.state' or 'msg.payload.On', value being either true/false or ON/OFF
      // Final result is always kept in 'msg.payload.state' = 'ON' or 'OFF'
      if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) !== 'object') {
        msg.payload = {'init': msg.payload}; // DEBUG TO BE REMOVED
      }
      // Validate From & To dates provided. If invalid, simplify to current date-time
      msg.payload.metered_From = new Date(msg.payload.metered_From);
      if (!(msg.payload.metered_From instanceof Date && !isNaN(msg.payload.metered_From.valueOf()))) {
        msg.payload.metered_From = new Date();
      }
      msg.payload.metered_To = new Date(msg.payload.metered_To);
      if (!(msg.payload.metered_To instanceof Date && !isNaN(msg.payload.metered_To.valueOf()))) {
        msg.payload.metered_To = new Date();
      }
      let curDateTime = new Date();

  // if (typeof(msg.payload) === 'object') {
  //   if (msg.payload.state === undefined && msg.payload.On !== undefined) {
  //     msg.payload.state = (msg.payload.On) ? 'ON' : 'OFF';
  //   }
  // } else if (typeof(msg.payload) === 'boolean') {
  //   msg.payload = {'state': (msg.payload) ? 'ON' : 'OFF'};
  // } else if (!isNaN(msg.payload)) {
  //   if (msg.payload == 0) {
  //     msg.payload = {'state': 'OFF','brightness': 0};
  //   } else {
  //     msg.payload = {'state': 'ON','brightness': parseInt(msg.payload)};
  //   }
  // } else if (typeof(msg.payload) === 'string') {
  //   msg.payload = {'state': msg.payload};
  // }
      let payload = msg.payload;
      let requiredCachedIDs = [];
      let commands = [];

      switch (config.meterscope) {
        case 'instant':
          // Check 1 [WHAT=113] : Current power consumption (Instant, in Watts) [*#18*<Where>*113##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*113##');
          break;
        case 'day_uptonow':
          // Check 2 [WHAT=54] : Current daily consumption (today, in Wh) [*#18*where*54##])
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*54##');
          break;
        case 'day':
          // Check 3a [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>##]
          // Note: is the same command for day & hour. Full day hourly details are returned (hour tag 1 -> 24 = hourly, hour tag 25 = daily total)
            ///////////////////////////
            // TODO ///////////////////
            ///////////////////////////
          break;
        case 'hour':
          // Check 3b [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>##])
          // Note: is the same command for day & hour. Full day hourly details are returned (hour tag 1 -> 24 = hourly, hour tag 25 = daily total)
            ///////////////////////////
            // TODO ///////////////////
            ///////////////////////////
          break;
        case 'month_uptonow':
          // Check 4 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*53##');
          break;
        case 'month':
          // Checks 5 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>##])
          let processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , 1);
          let processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth()+1 , 0);
          do {
              // process : build required 'cached IDs' keys required to provide info
              let requiredCachedID = config.meterscope + '_' + dateFormat (processed_From , 'YYYY-MM');
              if (!node.cachedInfo[requiredCachedID]) {
                // There is no cache content for this date reference, add the BUS command which will retrieve info
                commands.push (dateFormat(processed_From , '*#18*' + node.meterid + '*52#YY#M##'));
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next month
              processed_From.setMonth (processed_From.getMonth()+1);
          } while (processed_From < processed_To);
          break;
        case 'sincebegin':
          // Checks 6 [WHAT=51] : Full consumption since begin (up to today, in Wh) [*#18*where*51##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*51##');
          break;
      }

      /// TEMP : When dev on going, if command received is a valid SCS BUS for current meter, send it is as
      if (commands.length === 0 && payload.init) {
        if (payload.init.match('^\\*#18\\*' + node.meterid + '\\*[#\\*\\d]+##$')) {
          commands.push (payload.init);
          }
      }
      payload.tmp_cachedInfo = node.cachedInfo; // include full content of cache to allow easy debug
      payload.tmp_cachedIDs = requiredCachedIDs;
      /// END TEMP DEV PHASE

      if (commands.length === 0 && requiredCachedIDs.length === 0) {
        return;
      }

      // Send the command on the BUS through the MyHome gateway
      mhutils.executeCommand (node, commands, gateway, 0, false,
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
          node.processReceivedBUSCommand (msg, cmd_responses, requiredCachedIDs);
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
    RED.nodes.registerType ('myhome-energy', MyHomeEnergyNode);
  };
