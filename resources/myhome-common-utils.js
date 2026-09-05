// Shared utility functions usable both server-side (require()'d from a node's runtime .js) and
// client-side (loaded via <script src="resources/node-red-contrib-myhome-bticino-v2/myhome-
// common-utils.js"> in a node's editor .html) - one file, no build step. Exports via
// module.exports when running under Node.js; otherwise (plain <script src> in the browser) the
// functions below are just top-level declarations, which a classic (non-module) script attaches
// to the page as globals on its own - no extra assignment needed for that side.
/* global $, RED */

// Converts the internally stored A/PL code (e.g. '11', '1005') to the official 'A.PL' notation
// (e.g. '1.1', '10.5') for display only - storage format is unchanged, see README. A falsy/empty
// pointid (not configured yet) returns '?.?' rather than the nonsensical '0.NaN' that parsing an
// empty string would otherwise produce.
//
// A group has no A/PL structure at all - it's just a plain 1-99 group number on the BUS, not a
// point address - so 'isGroup' skips the A.PL split entirely and returns the raw number as-is.
function buildAPL_Dotted(pointid, isGroup) {
  if (!pointid) { return isGroup ? '?' : '?.?'; }
  if (isGroup) { return pointid.toString(); }
  let digits = pointid.toString();
  if (digits.length < 2) { digits = '0' + digits; }
  let a, pl;
  if (digits.length <= 2) {
    a = digits.slice(0, 1);
    pl = digits.slice(1);
  } else {
    a = digits.slice(0, 2);
    pl = digits.slice(2, 4);
  }
  return parseInt(a, 10) + '.' + parseInt(pl, 10);
}

// Builds the friendly, user-facing text for a registered BUS point: '<room> : <description>
// (<A.PL>)', or '(<prefix> <n>)' for a group - empty parts are skipped.
// 'translator' (optional): resolves the group prefix via 'common.points-group-prefix' (must exist
// in the CALLING node's own locale file); falls back to the literal 'Gr.' without one.
// 'forceRaw' (optional): for a flat-ID category with no A/PL structure (e.g. energy's meter ID)
// that also isn't a group - skips the A.PL split like isGroup does, but without the group prefix.
// Ignored when isGroup is set; omit for an A.PL category (light/shutter) - default is falsy.
function buildAPL_FullDescrUI(description, room, apl, isGroup, translator, forceRaw) {
  let title = [room, description].filter(Boolean).join(' : ');
  let addressBody = isGroup
    ? ((translator ? translator._('common.points-group-prefix') : 'Gr.') + ' ' + buildAPL_Dotted(apl, true))
    : buildAPL_Dotted(apl, !!forceRaw);
  let address = '(' + addressBody + ')';
  return title ? (title + ' ' + address) : address;
}

// Finds the registered BUS point (as stored in myhome-gateway's persisted 'points' array) matching
// a given category + buslevel + pointid + isgroup combination, or undefined if none matches.
// 'buslevel' is normalized to 'private_riser' when falsy on either side, matching how the field
// defaults when unset.
function findRegisteredPoint(points, category, buslevel, pointid, isgroup) {
  if (!Array.isArray(points) || !pointid) { return undefined; }
  let normBuslevel = buslevel || 'private_riser';
  let normIsGroup = !!isgroup;
  return points.find(function(p) {
    return p.category === category
        && (p.buslevel || 'private_riser') === normBuslevel
        && p.pointid === pointid.toString()
        && !!p.isgroup === normIsGroup;
  });
}

// Builds the '<svg><use.../></svg>' markup for one MDI icon from the shared sprite (see
// ensureMdiSpriteLoaded below) - built as one HTML string, not via jQuery's $('<svg/>')/$('<use/>')
// factory, which creates elements in the wrong (HTML, not SVG) namespace. Falls back to
// 'defaultIcon' (itself falling back to a generic lightbulb) for a missing/invalid/legacy
// (non-'mdi-') icon id. 'fill:currentColor;vertical-align:middle' is inlined directly (rather than
// left to a '.mh-mdi-icon' CSS rule some node's own dialog would need to inject) so the icon renders
// correctly the same way in every node's editor dialog, regardless of which dialogs happened to be
// opened first in the current editor page session.
function iconSvgHtml(iconId, size, defaultIcon) {
  size = size || 18;
  defaultIcon = defaultIcon || 'mdi-lightbulb-outline';
  iconId = (iconId && iconId.indexOf('mdi-') === 0) ? iconId : defaultIcon;
  return '<svg class="mh-mdi-icon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" style="fill:currentColor;vertical-align:middle;"><use href="#' + iconId + '" xlink:href="#' + iconId + '"></use></svg>';
}

// Fetches the shared MDI icon sprite (resources/mdi-icons-sprite.svg) into the page, once per
// editor session - a '<use href="#mdi-xxx">' needs its target '<symbol>' already present in the
// DOM, so every icon-rendering call site (in any node's editor, across dialog opens) needs to wait
// on this before rendering. Idempotent and always resolves (even on fetch failure, in which case
// icons just render blank) - client-side (jQuery) only, not usable from server-side runtime code.
function ensureMdiSpriteLoaded() {
  if (typeof $ === 'undefined') { return; }
  if ($('#mh-mdi-sprite-container').length > 0) {
    return $.Deferred().resolve().promise();
  }
  let deferred = $.Deferred();
  // dataType forced to 'text': jQuery would otherwise auto-parse the image/svg+xml response as XML.
  $.ajax({url: 'resources/node-red-contrib-myhome-bticino-v2/mdi-icons-sprite.svg', dataType: 'text'}).always(function(svgText) {
    if (typeof svgText === 'string' && svgText.indexOf('<svg') >= 0) {
      $('<div id="mh-mdi-sprite-container" style="display:none"></div>').html(svgText).appendTo(document.body);
    } else {
      // If icons stay blank, check this warning + try opening the sprite URL directly in a browser
      // tab - a 404/empty response usually means resources/ is missing the file.
      console.warn('[myhome-common-utils] MDI icon sprite failed to load or was invalid - icons will render blank.');
    }
    deferred.resolve();
  });
  return deferred.promise();
}

// Wires the AP-browse popover (button + floating panel + treeList) and the recap box for one
// device node's address field - called once from that node's own oneditprepare. 'scope' is the
// node's own oneditprepare 'this'; 'config' is:
//   category:     'light' | 'shutter' | ... - matches gateway points[].category and the
//                 '/discovered-points/<category>' URL segment
//   addressField: 'lightid' | 'shutterid' | ... - bare id suffix (no 'node-input-' prefix); every
//                 other id ('-browse-btn', '-browse-panel', '-browse-search', '-browse-loading',
//                 '-browse-empty', '-browse-tree', '-recap-icon', '-recap-text') is derived from
//                 it, so the node's own template markup must follow that same naming convention
//   i18nPrefix:   'mh-light' | 'mh-shutter' | ... - this node's own locale namespace
//   defaultIcon:  passed through to iconSvgHtml's fallback arg (e.g. 'mdi-window-shutter')
//   plainId:      true for a category whose address is a flat ID with no A/PL structure (e.g.
//                 energy's 1-255 meter ID) - passed through to buildAPL_Dotted/buildAPL_FullDescrUI
//                 as 'forceRaw'. Omit for an A.PL-addressed category (light/shutter).
//   buslevelField: bare id suffix of the field this node uses in the bus-level slot - defaults to
//                 'buslevel'. A category with no bus-level concept of its own can repurpose this
//                 slot for another per-point identity dimension (e.g. energy's 'metertype') by
//                 pointing this at that field's id instead.
// '-isgroup'/'-gateway' are NOT derived from config - every device node template has exactly one
// of each (or, for a category with no group concept, none at all - every read/write below is a
// plain jQuery call on an id selector, which no-ops safely when the element doesn't exist).
function setupApPointPicker(scope, config) {
  let addrSel = '#node-input-' + config.addressField;
  let buslevelSel = '#node-input-' + (config.buslevelField || 'buslevel');
  let panelSel = addrSel + '-browse-panel';
  function t(key) { return scope._(config.i18nPrefix + '.config.' + key); }

  // '[id$="-browse-panel"]' covers every node's own panel with one injection, guarded once for the
  // whole editor page - not per node type - zeroing the browser's own default 40px 'ol'
  // padding-left on the tree, left uncleared by Node-RED's core CSS.
  if ($('#mh-ap-browse-injected-styles').length === 0) {
    $('<style id="mh-ap-browse-injected-styles">[id$="-browse-panel"] .red-ui-treeList-list {padding-left: 0;}</style>').appendTo('head');
  }

  // Groups a flat points array by room into treeList data, one collapsed-by-default section per
  // room (no room icon - the room name is the header). Each point's row reuses buildAPL_FullDescrUI
  // with an empty room, and its icon must be passed to treeList as a jQuery object (not a plain
  // string), or it's misread as a CSS icon class name.
  function buildTreeDataFromPoints(points) {
    if (points.length === 0) {
      return null;
    }
    let byRoom = {};
    points.forEach(function(p) {
      let room = p.room || t('ap-browse-noroom');
      byRoom[room] = byRoom[room] || [];
      byRoom[room].push(p);
    });
    return Object.keys(byRoom).sort().map(function(room) {
      // Same sort as the gateway's own points list (myhome-gateway.html): alphabetical on the
      // full display string, not on insertion order (which used to leak through here unsorted).
      let sortedPoints = byRoom[room].slice().sort(function(a, b) {
        return buildAPL_FullDescrUI(a.description, '', a.pointid, a.isgroup, undefined, config.plainId).localeCompare(buildAPL_FullDescrUI(b.description, '', b.pointid, b.isgroup, undefined, config.plainId), undefined, {sensitivity: 'base'});
      });
      return {
        label: room + ' (' + byRoom[room].length + ')',
        children: sortedPoints.map(function(p) {
          return {
            label: buildAPL_FullDescrUI(p.description, '', p.pointid, p.isgroup, scope, config.plainId),
            icon: $(iconSvgHtml(p.icon, 18, config.defaultIcon)),
            point: p,
            roomLabel: room
          };
        })
      };
    });
  }

  // A previous dialog session's click handler (see below) reparents this panel to document.body to
  // escape the dialog's own CSS clipping - but the dialog closing never removes it again, and
  // Node-RED re-renders the SAME template ids on every fresh open. Left alone, this leaves an
  // orphaned, hidden, stale-data copy sitting directly under <body> with a duplicate id. Since
  // getElementById/jQuery's '#id' lookup returns the first match in DOM order, and that orphan sits
  // earlier under <body> than the fresh in-dialog panel below, every subsequent '$(panelSel)' /
  // '$(addrSel + "-browse-tree")' lookup in THIS session would silently resolve to that invisible
  // leftover instead of the panel actually on screen - the freshly fetched points get written into
  // it while the visible panel stays empty. Removing any such orphan here, before capturing this
  // session's own reference below, guarantees only one copy of this id ever exists at a time.
  $('body > ' + panelSel).remove();

  // Filters on room/description/address via treeList's own recursive filter - a room with no
  // matching point stays hidden, one with at least one match auto-expands.
  let browsePanel = $(panelSel);
  let browseTree = null;
  function pointMatchesSearch(item, term) {
    if (!item.point) { return false; }
    let p = item.point;
    let officialAddress = p.pointid ? buildAPL_Dotted(p.pointid, p.isgroup || !!config.plainId) : '';
    return (item.roomLabel || '').toLowerCase().indexOf(term) >= 0
        || (p.description || '').toLowerCase().indexOf(term) >= 0
        || (p.pointid || '').toLowerCase().indexOf(term) >= 0
        || officialAddress.toLowerCase().indexOf(term) >= 0;
  }
  $(addrSel + '-browse-search').searchBox({delay: 200, change: function() {
    let term = $(this).searchBox('value').toLowerCase();
    if (browseTree) {
      browseTree.treeList('filter', term ? function(item) { return pointMatchesSearch(item, term); } : null);
    }
  }}).parent().css('flex-shrink', '0');

  // Body-appended + position:fixed (not a row-relative popup) so it can't be clipped by the
  // address row's own narrow column.
  $(document).on('click', function(e) {
    if (browsePanel.is(':visible') && !$(e.target).closest(panelSel + ', ' + addrSel + '-browse-btn').length) {
      browsePanel.hide();
    }
  });
  $(addrSel + '-browse-btn').on('click', function(e) {
    e.preventDefault();
    if (browsePanel.is(':visible')) {
      browsePanel.hide();
      return;
    }
    browsePanel.appendTo(document.body);
    // Spans bus-level's left edge to the browse button's right edge (or, with no bus-level element at all, the address field's own left edge instead)
    let btnRect = this.getBoundingClientRect();
    let leftAnchorEl = $(buslevelSel).get(0) || $(addrSel).get(0);
    let buslevelRect = leftAnchorEl.getBoundingClientRect();
    let top = btnRect.bottom + 4;
    // Explicit height (not max-height): flex:1 1 auto on the tree only grows into a fixed-size
    // flex parent, not one left to shrink-to-fit its (still-loading, so short) content.
    let desiredHeight = 360; // room for a search box + ~7-8 point rows before scrolling
    browsePanel.css({
      top: top,
      left: buslevelRect.left,
      width: btnRect.right - buslevelRect.left,
      height: Math.min(desiredHeight, Math.max(200, window.innerHeight - top - 10)),
      display: 'flex' // not .show(), which falls back to 'block' - needs flex for the column layout
    });
    $(addrSel + '-browse-search').searchBox('value', ''); // reset any leftover search term from a previous open
    $(addrSel + '-browse-search').trigger('focus');
    $(addrSel + '-browse-empty').hide();
    $(addrSel + '-browse-tree').hide();
    $(addrSel + '-browse-loading').show();

    let gatewayId = $('#node-input-gateway').val();
    let gatewayNode = RED.nodes.node(gatewayId);
    let persistedPoints = (gatewayNode && Array.isArray(gatewayNode.points)) ? gatewayNode.points.filter(function(p) { return p.category === config.category; }) : [];

    function showPoints(discoveredList) {
      let known = {};
      // Keyed on bus level too - same AP number, different bus level, is a different device.
      persistedPoints.forEach(function(p) { known[(p.isgroup ? '#' : '') + p.pointid + '@' + (p.buslevel || 'private_riser')] = true; });
      let unregistered = (discoveredList || []).filter(function(d) {
        return !known[(d.isgroup ? '#' : '') + d.pointid + '@' + (d.buslevel || 'private_riser')];
      }).map(function(d) {
        return {category: config.category, room: t('ap-browse-unregistered'), description: scope._('common.points-unnamed-description'), icon: null, pointid: d.pointid, buslevel: d.buslevel, isgroup: d.isgroup};
      });
      let points = persistedPoints.concat(unregistered);

      $(addrSel + '-browse-loading').hide();
      let treeData = buildTreeDataFromPoints(points);
      $(addrSel + '-browse-empty').toggle(treeData === null);
      $(addrSel + '-browse-tree').toggle(treeData !== null);
      if (treeData === null) {
        return;
      }
      if (!browseTree) {
        browseTree = $(addrSel + '-browse-tree').treeList({}).on('treelistselect', function(evt, item) {
          if (item.point) {
            // Bus level must be applied too - the same AP number can exist on both the private
            // riser and a local bus (or, for a category repurposing this slot, be a different
            // identity dimension entirely - e.g. energy's meter vs actuator).
            $(buslevelSel).val(item.point.buslevel || 'private_riser').change();
            $(addrSel).val(item.point.pointid).change();
            $('#node-input-isgroup').prop('checked', !!item.point.isgroup).change();
            // Name/Topic are only filled in when still empty - never overwrite something the user
            // already typed.
            if (!$('#node-input-name').val()) {
              $('#node-input-name').val(buildAPL_FullDescrUI(item.point.description, item.point.room, item.point.pointid, item.point.isgroup, scope, config.plainId)).change();
            }
            if (!$('#node-input-topic').val()) {
              $('#node-input-topic').val(config.category).change();
            }
            browsePanel.hide();
          }
        });
      }
      browseTree.treeList('data', treeData);
    }

    $.get('myhome-bticino/gateway/' + gatewayId + '/discovered-points/' + config.category)
      .done(function(resp) { showPoints(resp.points || []); })
      .fail(function() { showPoints([]); }); // still show whatever was already persisted
  });

  // Recap box: shows the registered point (icon/room/description/AP/group) matching the current
  // buslevel/address/group, via findRegisteredPoint - refreshes on any of those changing.
  function refreshRecap() {
    let buslevel = $(buslevelSel).val();
    let pointid = $(addrSel).val();
    let isgroup = $('#node-input-isgroup').prop('checked');
    let gatewayNode = RED.nodes.node($('#node-input-gateway').val());
    let points = (gatewayNode && Array.isArray(gatewayNode.points)) ? gatewayNode.points : [];
    let match = findRegisteredPoint(points, config.category, buslevel, pointid, isgroup);
    $(addrSel + '-recap-icon').html(iconSvgHtml(match && match.icon, 18, config.defaultIcon));
    let text = match
      ? buildAPL_FullDescrUI(match.description, match.room, pointid, isgroup, scope, config.plainId)
      : buildAPL_FullDescrUI('', '', pointid, isgroup, scope, config.plainId) + ' - ' + t('ap-browse-unregistered');
    $(addrSel + '-recap-text').text(text);
  }
  $(buslevelSel + ', ' + addrSel + ', #node-input-isgroup, #node-input-gateway').on('change', refreshRecap);
  ensureMdiSpriteLoaded().done(refreshRecap);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildAPL_Dotted, buildAPL_FullDescrUI, findRegisteredPoint, iconSvgHtml, ensureMdiSpriteLoaded, setupApPointPicker };
}
