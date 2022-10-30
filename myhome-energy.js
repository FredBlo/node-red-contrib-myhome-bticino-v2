/*jshint esversion: 8, strict: implied, node: true */

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
    node.processingIncomingFrame = 0;

    // All current meter received values stored in memory from the moment node is loaded
    let payloadInfo = node.payloadInfo = {};
    payloadInfo.metered_Scope = config.meterscope;
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
      node.processReceivedBUSFrames (msg, frame, []);
    };
    runningMonitor.addMonitoredEvent ('OWN_ENERGY', listenerFunction);

    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // Function called when a MyHome BUS frame is received ///////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    this.processReceivedBUSFrames = function (msg, frame, finalRequiredCachedIDs) {
      if (typeof (msg.payload) === 'undefined') {
        msg.payload = {};
      }
      let payload = msg.payload;
      // When the function is called with a specified list of required entries from the cache, it means function was called internally (from 'processInput')
      // to return content (for which maybe no command was required because all are already in cache)
      let forceFromCacheAndMsg = finalRequiredCachedIDs.length; // when has only 1 element, is the 'FORCED' mode. When >1, these are ID to be filtered/taken from cache

      payloadInfo.metered_Info = [];
      let processedFrames = 0;
      let curDateTime = new Date();
      let nodeStatusInfo = []; // [fill , shape , text]

      for (let curFrame of (typeof(frame) === 'string') ? [frame] : frame) {
        let frameMatch = null;
        let frameInfo = {};

        switch (config.meterscope) {
          case 'instant':
            // Check 1 [WHAT=113] : Current power consumption (Instant, in Watts) [*#18*<Where>*113*<Val>##] with <Val> = WATT)
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*113\\*(\\d+)##');
            if (frameMatch !== null) {
	            frameInfo.metered_From = curDateTime.toLocaleString();
              frameInfo.metered_To = curDateTime.toLocaleString();
              frameInfo.metered_Power = parseInt(frameMatch[1]);
              // Manage the cached content : none for 'instant' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'ring' , mhutils.dateTxtMerge(frameInfo.metered_From , 'hh:nn:ss') + ': ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'W')];
            }
            break;
          case 'day_uptonow':
            // Check 2 [WHAT=54] : Current daily consumption (today, in Wh) [*#18*where*54*<Val>##] with <Val> = WATT)
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*54\\*(\\d+)##');
            if (frameMatch !== null) {
              frameInfo.metered_From = new Date(curDateTime.getFullYear() , curDateTime.getMonth() , curDateTime.getDate() , 0 , 0 , 0).toLocaleString();
              frameInfo.metered_To = curDateTime.toLocaleString();
              frameInfo.metered_Power = parseInt(frameMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , mhutils.dateTxtMerge(frameInfo.metered_From , 'DD-MM-YYYY') + ': ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'Wh')];
            }
            break;
          case 'day':
            // There are 2 possible BUS messages which are sending daily totals, either basically M+D or as a part of hourly totalizers (M+D+h)
            //  Check 3a [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>*<Tag>*<Val>##]
            //           with <Tag> is the hour [1-24], '25' being day total <Val> = WATT)
            //           ==> '25' is thus the only analyzed for daily
            //  Check 3b [WHAT=513] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*513#<M>*<D>*<Val>##] with <Val> = WATT)
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*511#(\\d{1,2})#(\\d{1,2})\\*25\\*(\\d+)##');
            frameMatch = frameMatch || curFrame.match ('^\\*#18\\*' + node.meterid + '\\*513#(\\d{1,2})\\*(\\d{1,2})\\*(\\d+)##');
            if (frameMatch !== null) {
              node.processingIncomingFrame = new Date(); // caching : store date-time to know, when processing a command (from node-RED, see 'executeCommand'), responses are being processed
              // If the month received in the frame returned is after current month, it means we are reading data from previous year
              let yearCorrection = (frameMatch[1] > curDateTime.getMonth()+1) ? -1 : 0 ;
              // Specified <Tag> is 25, it means this is the day total
              frameInfo.metered_From = new Date(curDateTime.getFullYear()+yearCorrection , +frameMatch[1]-1 , frameMatch[2] , 0 , 0 , 0).toLocaleString();
              frameInfo.metered_To = new Date(curDateTime.getFullYear()+yearCorrection , +frameMatch[1]-1 , frameMatch[2] , 23 , 59 , 59).toLocaleString();
              frameInfo.metered_Power = parseInt(frameMatch[3]);
              // Manage the cached content : Build ID, for monthly mode is 'hour_YYYY-MM-DD'
              frameInfo.metered_CacheID = config.meterscope + "_" + mhutils.dateTxtMerge (frameInfo.metered_From , 'YYYY-MM-DD');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , mhutils.dateTxtMerge(frameInfo.metered_From , 'DD-MM-YYYY') + ': ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'Wh')];
            }
            break;
          case 'hour':
            // Check 4 [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>*<Tag>*<Val>##]
            //           with <Tag> is the hour [1-24], '25' being day total <Val> =WATT)
            //           ==> '25' is thus skipped for hourly analysis
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*511#(\\d{1,2})#(\\d{1,2})\\*(?!25)(\\d{1,2})\\*(\\d+)##');
            if (frameMatch !== null) {
              node.processingIncomingFrame = new Date(); // caching : store date-time to know, when processing a command (from node-RED, see 'executeCommand'), responses are being processed
              // If the month received in the frame returned is after current month, it means we are reading data from previous year
              let yearCorrection = (frameMatch[1] > curDateTime.getMonth()+1) ? -1 : 0 ;
              // Specified <Tag> is 1-24, it means this is the hour total
              frameInfo.metered_From = new Date(curDateTime.getFullYear()+yearCorrection , +frameMatch[1]-1 , frameMatch[2] , frameMatch[3]-1 , 0 , 0).toLocaleString();
              frameInfo.metered_To = new Date(curDateTime.getFullYear()+yearCorrection , +frameMatch[1]-1 , frameMatch[2] , frameMatch[3]-1 , 59 , 59).toLocaleString();
              frameInfo.metered_Power = parseInt(frameMatch[4]);
              // Manage the cached content : Build ID, for monthly mode is 'hour_YYYY-MM-DD_hh'
              frameInfo.metered_CacheID = config.meterscope + "_" + mhutils.dateTxtMerge (frameInfo.metered_From , 'YYYY-MM-DD_hh');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , mhutils.dateTxtMerge(frameInfo.metered_From , 'DD-MM-YYYY hh') + 'h: ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'Wh')];
            }
            break;
          case 'month_uptonow':
            // Check 5 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53*<Val>##] with <Val> = WATT)
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*53\\*(\\d+)##');
            if (frameMatch !== null) {
              frameInfo.metered_From = new Date(curDateTime.getFullYear() , curDateTime.getMonth(), 1 , 0 , 0 , 0).toLocaleString();
              frameInfo.metered_To = curDateTime.toLocaleString();
              frameInfo.metered_Power = parseInt(frameMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , mhutils.dateTxtMerge(frameInfo.metered_From , 'MM-YYYY') + ': ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'Wh')];
            }
            break;
          case 'month':
            // Checks 6 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>*<Val>##] with <Val> = WATT)
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*52#(\\d{2})#(\\d{1,2})\\*(\\d+)##');
            if (frameMatch !== null) {
              node.processingIncomingFrame = new Date(); // caching : store date-time to know, when processing a command (from node-RED, see 'executeCommand'), responses are being processed
              frameInfo.metered_From = new Date('20'+frameMatch[1] , +frameMatch[2]-1 , 1 , 0 , 0 , 0).toLocaleString();
              frameInfo.metered_To = new Date('20'+frameMatch[1] , +frameMatch[2] , 0 , 23 , 59 , 59).toLocaleString();
              if (parseInt(frameMatch[3]) === (2**32-1)) {
                // When meter returns '4294967295' (=full 32bits with first =0, 2^32-1), it means no data exists
                frameInfo.metered_Power = 0;
              } else {
                frameInfo.metered_Power = parseInt(frameMatch[3]);
              }
              // Manage the cached content : Build ID, for monthly mode is 'month_YYYY-MM'
              frameInfo.metered_CacheID = config.meterscope + "_" + mhutils.dateTxtMerge (frameInfo.metered_From , 'YYYY-MM');
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , mhutils.dateTxtMerge(frameInfo.metered_From , 'MM-YYYY') + ': ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'Wh')];
            }
            break;
          case 'sincebegin':
            // Checks 7 [WHAT=51] : Full consumption since begin (up to today, in Wh) [*#18*where*51*<Val>##]	with <Val> = WATT)
            frameMatch = curFrame.match ('^\\*#18\\*' + node.meterid + '\\*51\\*(\\d+)##');
            if (frameMatch !== null) {
              frameInfo.metered_From = new Date(2000 , 0 , 1 , 0 , 0 , 0).toLocaleString();
              frameInfo.metered_To = curDateTime.toLocaleString();
              frameInfo.metered_Power = parseInt(frameMatch[1]);
              // Manage the cached content : none for 'uptonow' mode
              // Build node status message
              nodeStatusInfo = ['grey' , 'dot' , 'From begin: ' + mhutils.numberToAbbr(frameInfo.metered_Power , 'Wh')];
            }
            break;
        }

        // If we reached here with a non null match, it means frame was useful for node
        if (frameMatch !== null) {
          processedFrames++;
          // Add info common to any call
          frameInfo.metered_Frame = curFrame;
          // Cache management : if the generated content has to be kept in memory, add it to cached content now
          if (node.enableCache) {
              // Note : we keep info when cached content is not fully in the past (meters which range is (partially) in the future are still not 100% OK and will evolve call after call)
              frameInfo.metered_CacheIsStatic = (frameInfo.metered_CacheID && (new Date(frameInfo.metered_To) < curDateTime));
              node.cachedInfo[frameInfo.metered_CacheID] = frameInfo;
          }
          // Add generated frame object to the global frames info store if required (only when we had ID to search for / filter on start)
          if (forceFromCacheAndMsg > 1) {
            // Working in 'internal' mode (after command was sent); only include returned frame if is in list of those asked & remove ID from those to take afterwards from cache
            let wasRequiredCacheID = finalRequiredCachedIDs.indexOf(frameInfo.metered_CacheID);
            if (wasRequiredCacheID >= 0) {
              finalRequiredCachedIDs.splice(wasRequiredCacheID , 1);
              payloadInfo.metered_Info.push (frameInfo);
            }
          } else {
            // Working in BUS monitoring mode, all received frames are sent
            payloadInfo.metered_Info.push (frameInfo);
          }
          // Update Node displayed status
          node.status ({fill: nodeStatusInfo[0], shape: nodeStatusInfo[1], text: nodeStatusInfo[2]});
        }
      }

      // Checks : all done, if nothing was processed, abord (no node / flow update detected), excepted when refresh is 'forced' from cache
      if (processedFrames === 0 && !forceFromCacheAndMsg) {
        return;
      }

      // All commands have been processed, add others from cache for those which were not retrieved and are left in ID list
      finalRequiredCachedIDs.forEach(function(requiredCachedID) {
        let requiredCachedInfo = node.cachedInfo[requiredCachedID];
        if (requiredCachedInfo) {
          payloadInfo.metered_Info.push (requiredCachedInfo);
        }
      });

      // Build summarized values & clean content
      payloadInfo.metered_From = null;
      payloadInfo.metered_To = null;
      payloadInfo.metered_Power = 0;
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
      payloadInfo.metered_Power_asText = mhutils.numberToAbbr(payloadInfo.metered_Power , (payloadInfo.metered_Scope === 'instant') ? 'W' : 'Wh');

      // Send msg back as new flow : only send update as new flow when something changed after having received this new BUS info
      // (but always send it when SmartFilter is disabled or when running in 'forced' mode)
      if (!config.skipevents || forceFromCacheAndMsg) {
        let newPayloadinfo = JSON.stringify (payloadInfo);
        if (!config.smartfilter || newPayloadinfo !== node.lastPayloadInfo || forceFromCacheAndMsg) {
          // MSG1 : Build primary msg
          // MSG1 : Received command info : only include source command when was provided as string (when is an array, it comes from .processInput redirected here)
          if (!Array.isArray(frame)) {
            payload.command_received = frame;
          }
          // MSG1 : Add all current node stored values to payload
          Object.getOwnPropertyNames(payloadInfo).forEach (function(objectName) {
            payload[objectName] = payloadInfo[objectName];
          });
          // MSG1 : Add misc info
          msg.topic = 'state/' + config.topic;

          // MSG2 : Build secondary payload
          let msg2 = mhutils.buildSecondaryOutput (payloadInfo, config, '', '', '');

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
      // DEBUG MODE : ouput cache
      if (msg.__user_inject_props__ === 'DEBUG_SENDCACHE' || msg.payload === 'DEBUG_SENDCACHE') {
        msg.payload = {'cachedInfo' : node.cachedInfo};
        node.send(msg);
        return;
      }
      // Only process input received from flow when the topic matches with configuration of nodes. For energy, 'cmd/' or 'state/' are both OK & similar
      if ((msg.topic !== 'state/' + config.topic) && (msg.topic !== 'cmd/' + config.topic)) {
        node.warn('invalid state/cmd provided : ' + JSON.stringify(msg));
        return;
      }

      // Get payload and apply conversions (Convert to object if not already so and Validate From/To date-times
      if (typeof(msg.payload) === 'string') {
        try {msg.payload = JSON.parse(msg.payload);} catch(error){}
      }
      if (typeof(msg.payload) !== 'object') {
        msg.payload = {'metered_From':msg.payload};
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

      // Start processing node-RED inpout itself
      let curDateTime = new Date();
      let processed_From;
      let processed_To;
      let requiredCachedIDs = [];
      let commands = [];
      switch (config.meterscope) {
        case 'instant':
          // Command 1 [WHAT=113] : Current power consumption (Instant, in Watts) [*#18*<Where>*113##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*113##');
          break;
        case 'day_uptonow':
          // Command 2 [WHAT=54] : Current daily consumption (today, in Wh) [*#18*where*54##])
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*54##');
          break;
        case 'day':
          // 2 options exist for daily totals
          //  Command 3a [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>##]
          //    Note: is the same command for day & hour. Full day hourly details are returned (hour tag 1 -> 24 = hourly, hour tag 25 = daily total)
          //  Command 3b [WHAT=513] : Daily consumption for a full month (specified month, in Wh) [*18*59#<M>*<Where>##]
          //    Note : is more efficient to use a single call for multiple days BUT this command does not receive responses (frames are send on the BUS only)
          // The gateway is only able to provide daily/hourly details for a range of 12 months : 11 before + current one. Define max date range
          let dailyMeter_FromMin = new Date(curDateTime.getFullYear() , curDateTime.getMonth()-11 , 1);
          let dailyMeter_ToMax = new Date(curDateTime.getFullYear() , curDateTime.getMonth()+1 , 0 , 23 , 59 , 59);
          processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , payload.metered_From.getDate());
          processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth() , payload.metered_To.getDate());
          do {
              // process : build required 'cached IDs' keys required to provide info and add BUS commands to collect not-cached-yet info
              let requiredCachedID = config.meterscope + '_' + mhutils.dateTxtMerge (processed_From , 'YYYY-MM-DD');
              if (!node.cachedInfo[requiredCachedID] || !node.cachedInfo[requiredCachedID].metered_CacheIsStatic) {
                // There is no 'finalized' (static) cache content for this date reference, add the BUS command which will retrieve info (if possible in range gateway can provide)
                if (processed_From >= dailyMeter_FromMin && processed_From <= dailyMeter_ToMax) {
                  let addCommand;
                  if (node.enableCache) {
                    // The month command sends 1 frame per day, but is only sent on the BUS, not as response. Therefore cache is required to use this mode
                    addCommand = mhutils.dateTxtMerge(processed_From , '*18*59#M*' + node.meterid + '##');
                  } else {
                    // Cache disabled, we must use the 'slower/longer' command which receives responses as a frame per hour + 1 for day total
                    addCommand = mhutils.dateTxtMerge(processed_From , '*#18*' + node.meterid + '*511#M#D##');
                  }
                  if (commands.indexOf(addCommand) < 0) {
                    commands.push (addCommand);
                  }
                }
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next day
              processed_From.setDate (processed_From.getDate()+1);
          } while (processed_From <= processed_To);
          break;
        case 'hour':
          // Command 4 [WHAT=511] : Daily consumption (specified month+day, in Wh) [*#18*<Where>*511#<M>#<D>##])
          // Note: is the same command for day & hour. Full day hourly details are returned (hour tag 1 -> 24 = hourly, hour tag 25 = daily total)
          // The gateway is only able to provide daily/hourly details for a range of 12 months : 11 before + current one. Define max date range
          let hourlyMeter_FromMin = new Date(curDateTime.getFullYear() , curDateTime.getMonth()-11 , 1);
          let hourlyMeter_ToMax = new Date(curDateTime.getFullYear() , curDateTime.getMonth()+1 , 0 , 23 , 59 , 59);
          processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , payload.metered_From.getDate() , payload.metered_From.getHours());
          processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth() , payload.metered_To.getDate() , payload.metered_To.getHours());
          do {
              // process : build required 'cached IDs' keys required to provide info and add BUS commands to collect not-cached-yet info
              let requiredCachedID = config.meterscope + '_' + mhutils.dateTxtMerge (processed_From , 'YYYY-MM-DD_hh');
              if (!node.cachedInfo[requiredCachedID] || !node.cachedInfo[requiredCachedID].metered_CacheIsStatic) {
                // There is no 'finalized' (static) cache content for this date reference, add the BUS command which will retrieve info (if possible in range gateway can provide)
                if (processed_From >= hourlyMeter_FromMin && processed_From <= hourlyMeter_ToMax) {
                  let addCommand = mhutils.dateTxtMerge(processed_From , '*#18*' + node.meterid + '*511#M#D##');
                  if (commands.indexOf(addCommand) < 0) {
                    commands.push (addCommand);
                  }
                }
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next hour
              processed_From.setHours (processed_From.getHours()+1);
          } while (processed_From <= processed_To);
          break;
        case 'month_uptonow':
          // Command 5 [WHAT=53] : Current monthly consumption (up to today, in Wh) [*#18*where*53##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*53##');
          break;
        case 'month':
          // Command 6 [WHAT=52] : Current monthly consumption (specified month, in Wh) [*#18*where*52#<Y>#<M>##])
          // Provided date are rounded to 1st day of month (for From) and last day of month (for To)
          processed_From = new Date(payload.metered_From.getFullYear() , payload.metered_From.getMonth() , 1);
          processed_To = new Date(payload.metered_To.getFullYear() , payload.metered_To.getMonth()+1 , 0);
          do {
              // process : build required 'cached IDs' keys required to provide info and add BUS commands to collect not-cached-yet info
              let requiredCachedID = config.meterscope + '_' + mhutils.dateTxtMerge (processed_From , 'YYYY-MM');
              if (!node.cachedInfo[requiredCachedID] || !node.cachedInfo[requiredCachedID].metered_CacheIsStatic) {
                // There is no 'finalized' (static) cache content for this date reference, add the BUS command which will retrieve info
                commands.push (mhutils.dateTxtMerge(processed_From , '*#18*' + node.meterid + '*52#YY#M##'));
              }
              requiredCachedIDs.push (requiredCachedID);
              // Increment to next month
              processed_From.setMonth (processed_From.getMonth()+1);
          } while (processed_From <= processed_To);
          break;
        case 'sincebegin':
          // Command 7 [WHAT=51] : Full consumption since begin (up to today, in Wh) [*#18*where*51##]
          // Simple case : no cache, no date-time range to manage
          commands.push ('*#18*' + node.meterid + '*51##');
          break;
      }
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
          // Once commands were sent, call internal function to force node info refresh
          // TechNote : if command was sent without any response received, it can be that responses are only sent on the BUS (not as responses)
          // and/or some gateway are not compliant with OpenWebNet doc (i.e. sending on the BUS only but not to command-caller)
          // In this case, we will wait a bit + keep waiting as long as this node receives responses directly form the BUS during last xx ms.
          // This is only available when cache is enabled (otherwise info processed are not kept in memory outside of caller flow anyway)
          let waitBUSDelay = (node.enableCache && commands.length > 0 && (cmd_responses.length + cmd_failed.length) === 0) ? 200 : 0;
          async function processReceivedBUSFrames_delayed (initialDelay , interDelay , maxTotalDelay) {
            // If a delay is set, first wait once, then check every xxx ms (delay defined) whether node is still processing incoming messages.
            // Once no more processing occurred during last xxx ms (same as delay asked), or total waiting time is too long, shoot the BUS refresh function
            function sleep(ms) {
              return new Promise(resolve => setTimeout(resolve, ms));
            }
            await sleep(initialDelay);
            while (maxTotalDelay - initialDelay > 0) {
              maxTotalDelay = maxTotalDelay - interDelay;
              if ((new Date() - node.processingIncomingFrame) > interDelay*2) {
                break;
              }
              await sleep(interDelay);
            }
            // Launch processing of responses by the node BUS receiver function (either node has finished or we waited too long)
            // TechNote : 'FORCED' mode is inserted on Cached ID list so that function always finalizes by outputting a msg with content
            node.processReceivedBUSFrames (msg, cmd_responses, ['FORCED'].concat(requiredCachedIDs));
          }
          processReceivedBUSFrames_delayed(waitBUSDelay*5 , waitBUSDelay , waitBUSDelay*20*commands.length);
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
