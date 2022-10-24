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

    function dateTxtMerge (dateToFormat , textFormat) {
      // Function to convert a provided date to a fixed 'readable' date+time format
      //  - dateToFormat : any content which can be converted to a valid date-time
      //  - textFormat : the output 'template' as text were replacement by date-time parts
      //      (only YY, YYYY, MM, M, DD, D, hh, nn, ss are supported for now)
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

    function numberToAbbreviated (numberToFormat , suffix) {
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
	            packetInfo.metered_From = curDateTime.toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'instant' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'ring' , dateTxtMerge(packetInfo.metered_From , 'hh:nn:ss') + ': ' + numberToAbbreviated(packetInfo.metered_Power , 'W')];
            }
            break;
          case 'day_uptonow':
            // Check 2 [WHAT=54] : Current daily consumption (today, in Wh) [*#18*where*54*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*54\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_From = new Date(curDateTime.getFullYear() , curDateTime.getMonth() , curDateTime.getDate() , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateTxtMerge(packetInfo.metered_From , 'DD-MM-YYYY') + ': ' + numberToAbbreviated(packetInfo.metered_Power , 'Wh')];
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
              packetInfo.metered_From = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , 23 , 59 , 59).toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[3]);
              // Manage the cached content : Build ID, for monthly mode is 'hour_YYYY-MM-DD'
              packetInfo.metered_CacheID = config.meterscope + "_" + dateTxtMerge (packetInfo.metered_From , 'YYYY-MM-DD');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateTxtMerge(packetInfo.metered_From , 'DD-MM-YYYY') + ': ' + numberToAbbreviated(packetInfo.metered_Power , 'Wh')];
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
              packetInfo.metered_From = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , packetMatch[3]-1 , 0 , 0).toLocaleString();
              packetInfo.metered_To = new Date(curDateTime.getFullYear()+yearCorrection , +packetMatch[1]-1 , packetMatch[2] , packetMatch[3]-1 , 59 , 59).toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[4]);
              // Manage the cached content : Build ID, for monthly mode is 'hour_YYYY-MM-DD_hh'
              packetInfo.metered_CacheID = config.meterscope + "_" + dateTxtMerge (packetInfo.metered_From , 'YYYY-MM-DD_hh');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateTxtMerge(packetInfo.metered_From , 'DD-MM-YYYY hh') + 'h: ' + numberToAbbreviated(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'month_uptonow':
            // Check 4 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*53\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_From = new Date(curDateTime.getFullYear() , curDateTime.getMonth(), 1 , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateTxtMerge(packetInfo.metered_From , 'MM-YYYY') + ': ' + numberToAbbreviated(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'month':
            // Checks 5 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>*<Val>##] with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*52#(\\d{2})#(\\d{1,2})\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_From = new Date('20'+packetMatch[1] , +packetMatch[2]-1 , 1 , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = new Date('20'+packetMatch[1] , +packetMatch[2] , 0 , 23 , 59 , 59).toLocaleString();
              if (parseInt(packetMatch[3]) === (2**32-1)) {
                // When meter returns '4294967295' (=full 32bits with first =0, 2^32-1), it means no data exists
                packetInfo.metered_Power = 0;
              } else {
                packetInfo.metered_Power = parseInt(packetMatch[3]);
              }
              // Manage the cached content : Build ID, for monthly mode is 'month_YYYY-MM'
              packetInfo.metered_CacheID = config.meterscope + "_" + dateTxtMerge (packetInfo.metered_From , 'YYYY-MM');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , dateTxtMerge(packetInfo.metered_From , 'MM-YYYY') + ': ' + numberToAbbreviated(packetInfo.metered_Power , 'Wh')];
            }
            break;
          case 'sincebegin':
            // Checks 6 [WHAT=51] : Full consumption since begin (up to today, in Wh) [*#18*where*51*<Val>##]	with <Val> = WATT)
            packetMatch = curPacket.match ('^\\*#18\\*' + node.meterid + '\\*51\\*(\\d+)##');
            if (packetMatch !== null) {
              packetInfo.metered_From = new Date(2000 , 0 , 1 , 0 , 0 , 0).toLocaleString();
              packetInfo.metered_To = curDateTime.toLocaleString();
              packetInfo.metered_Power = parseInt(packetMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , 'From begin: ' + numberToAbbreviated(packetInfo.metered_Power , 'Wh')];
            }
            break;
        }

        // If we reached here with a non null match, it means command was useful for node
        if (packetMatch !== null) {
          processedPackets++;
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
          // Update Node displayed status
          node.status ({fill: nodeStatusInfo[0], shape: nodeStatusInfo[1], text: nodeStatusInfo[2]});
        }
      }

      // Checks : all done, if nothing was processed, abord (no node / flow update detected), excepted when refresh is 'forced' from cache
      if (processedPackets === 0 && !forceFromCacheAndMsg) {
        return;
      }

      // All commands have been processed, add others from cache for those which were not retrieved and are left in ID list
      finalRequiredCachedIDs.forEach(function(requiredCachedID) {
        if (node.cachedInfo[requiredCachedID]) {
          // Required ID exists, add it to final list now
          payloadInfo.metered_Info.push (node.cachedInfo[requiredCachedID]);
        }
      });

      // Build summarized values & clean content
      payloadInfo.metered_Power = 0;
      payloadInfo.metered_Scope = config.meterscope;
      payloadInfo.metered_Info.forEach(function(metered_Info) {
        // Compute total power
        payloadInfo.metered_Power = payloadInfo.metered_Power + metered_Info.metered_Power;
        // Compute oldest Date for From
        if (payloadInfo.metered_From == null || new Date(payloadInfo.metered_From) > new Date(metered_Info.metered_From)) {
        	payloadInfo.metered_From = new Date(metered_Info.metered_From).toLocaleString();
        }
        // Compute newest Date for To
        if (payloadInfo.metered_To == null || new Date(payloadInfo.metered_To) < new Date(metered_Info.metered_To)) {
        	payloadInfo.metered_To = new Date(metered_Info.metered_To).toLocaleString();
        }
      });

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
      // Only process input received from flow when the topic matches with configuration of nodes. For energy, 'cmd/' or 'state/' are both OK & similar
      if ((msg.topic !== 'state/' + config.topic) && (msg.topic !== 'cmd/' + config.topic)) {
        return;
      }

      // Get payload and apply conversions (Convert to object if not already so and Validate From/To date-times
      if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) !== 'object') {
        msg.payload = {'init': msg.payload}; // DEBUG TO BE REMOVED, SHOULD BE {}
      }
      let payload = msg.payload;
      // Validate From & To dates provided. If invalid, simplify to current date-time
      payload.metered_From = new Date(payload.metered_From);
      if (!(payload.metered_From instanceof Date && !isNaN(payload.metered_From.valueOf()))) {
        payload.metered_From = new Date();
      }
      payload.metered_To = new Date(payload.metered_To);
      if (!(payload.metered_To instanceof Date && !isNaN(payload.metered_To.valueOf()))) {
        payload.metered_To = payload.metered_From;
      }

            node.warn(JSON.stringify(payload)); // DEBUG

      // Start processing node-RED inpout itself
      let curDateTime = new Date();
      let processed_From;
      let processed_To;
      let requiredCachedIDs = ['']; // init array with a first empty string to force refresh when sent to 'processReceivedBUSCommand' with commands
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

          // If the month received in the command returned is after current month, it means we are reading data from previous year
//          let yearCorrection = (payload.metered_From.getMonth() > curDateTime.getMonth()+1) ? -1 : 0 ;
          processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , payload.metered_From.getDate());
          processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth() , payload.metered_To.getDate());
          do {
              // process : build required 'cached IDs' keys required to provide info
              let requiredCachedID = config.meterscope + '_' + dateTxtMerge (processed_From , 'YYYY-MM-DD');

              /// TO DO : find a way to only emit command for supported date range : only 12 months coverage : cur month = last one, all others = 11 in the past only

              if (!node.cachedInfo[requiredCachedID]) {
                // There is no cache content for this date reference, add the BUS command which will retrieve info
                commands.push (dateTxtMerge(processed_From , '*#18*' + node.meterid + '*511#M#D##'));
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next day
              processed_From.setDate (processed_From.getDate()+1);
          } while (processed_From <= processed_To);
          break;
        case 'hour':
          // Check 3b [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>##])
          // Note: is the same command for day & hour. Full day hourly details are returned (hour tag 1 -> 24 = hourly, hour tag 25 = daily total)
          processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , payload.metered_From.getDate() , payload.metered_From.getHours());
          processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth() , payload.metered_To.getDate() , payload.metered_To.getHours());
          do {
              // process : build required 'cached IDs' keys required to provide info
              let requiredCachedID = config.meterscope + '_' + dateTxtMerge (processed_From , 'YYYY-MM-DD_hh');
              if (!node.cachedInfo[requiredCachedID]) {
                // There is no cache content for this date reference, add the BUS command which will retrieve info, but since 1 command covers multiple (24) hours, we need to ensure it was not already added
                let addCommand = dateTxtMerge(processed_From , '*#18*' + node.meterid + '*511#M#D##');
                if (commands.indexOf(addCommand) < 0) {
                  commands.push (addCommand);
                }
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next hour
              processed_From.setHours (processed_From.getHours()+1);
          } while (processed_From <= processed_To);
          break;
        case 'month_uptonow':
          // Check 4 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*53##');
          break;
        case 'month':
          // Checks 5 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>##])
          // Provided date are rounded to 1st day of month (for From) and last day of month (for To)
          processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , 1);
          processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth()+1 , 0);
          do {
              // process : build required 'cached IDs' keys required to provide info
              let requiredCachedID = config.meterscope + '_' + dateTxtMerge (processed_From , 'YYYY-MM');
              if (!node.cachedInfo[requiredCachedID]) {
                // There is no cache content for this date reference, add the BUS command which will retrieve info
                commands.push (dateTxtMerge(processed_From , '*#18*' + node.meterid + '*52#YY#M##'));
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next month
              processed_From.setMonth (processed_From.getMonth()+1);
          } while (processed_From <= processed_To);
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

      if (commands.length === 0 && requiredCachedIDs.length === 1) {
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
          // Once commands were sent, call internal function to force node info refresh
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
