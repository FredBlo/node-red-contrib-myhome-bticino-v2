---
name: check-label-wrapping
description: Detect config-dialog labels that wrap onto 2+ lines in a given editor locale (fr, nl, ...) and safely apply a shorter wording once agreed. Use when translated/edited labels in myhome-*.html might be too long for their column and need auditing, or when actually changing a label's wording in any locales/<lang>/myhome-*.json file.
---

Grew out of a real FR-labels-too-long audit (English labels translated to
French/Dutch sometimes come out longer and wrap in the narrow columns this
project's dialogs use). Depends on the sibling
`run-node-red-contrib-myhome-bticino-v2` skill for actually running the test
Node-RED instance - read that skill first if you haven't; this one only adds
the wrap-detection scan and the safe locale-value-editing helpers on top of
it.

## Setup (once)

```bash
npm install --no-audit --no-fund --no-save playwright-core
```

Run **inside this skill's own folder**
(`.claude/skills/check-label-wrapping/`). This duplicates the sibling
skill's own `playwright-core` install rather than trying to reuse it across
skill folders - deliberately: `playwright-core`'s own `package.json` uses an
`exports` map, which isn't reliably reachable via a hand-built relative
path from a sibling directory, and Node's plain upward `node_modules`
resolution won't cross into a sibling folder either. The sibling skill's own
SKILL.md documents the identical constraint for why it installs
`playwright-core` "next to driver.mjs" rather than only in its scratch dir -
same root cause, same fix, applied here too. It has no browser binaries of
its own (drives the *system* Edge via `channel:'msedge'`), so this second
install is small and fast.

## 1. Scan (read-only - never edits a file)

```bash
node .claude/skills/check-label-wrapping/scan-wraps.mjs fr
node .claude/skills/check-label-wrapping/scan-wraps.mjs nl
node .claude/skills/check-label-wrapping/scan-wraps.mjs en-US   # sanity baseline - should print nothing
```

This restarts the test Node-RED instance (via the sibling skill's
`driver.mjs restart`, which now also kills whatever is *actually* listening
on the port even if the pid file is stale - see that skill's Gotchas),
deploys `all-nodes-seed-flow.json` (one instance of every device/session
node type, wired to one `myhome-gateway` with a couple of registered points
in every category), forces the editor's UI language via the browser
context's `locale`/`Accept-Language` (confirmed reliable - no need for a
`?lang=` query string or the user-settings language picker), then opens
every node's dialog plus the gateway dialog with all its collapsible
sections + one point row per category expanded, and measures every label in
whichever tray is currently on top.

Prints a table (and the same data as JSON) of every wrapped label found,
deduplicated across dialogs that share the same key (the `"common"` block
documented in `CLAUDE.md` is copy-pasted identically into all 9 node types'
own locale files, so the same key legitimately shows up several times) -
columns are the `data-i18n` key (or `(none - dynamically built)` for a
handful of jQuery-`.text()`-built labels, e.g. the gateway's per-point-row
field labels or the scenario rules table's header - see `CLAUDE.md`'s
"Gateway BUS points registry" section for exactly which labels those are),
the current text in the scanned language, and the `en-US` text for the same
key for reference.

**Present this table to the user before changing anything** and let them
pick/adjust the wording - don't auto-apply a "shorter" rewrite on your own
judgment for a language you don't have strong native confidence in (this
was explicitly the workflow the first time this skill's approach was used:
propose candidates, wait for the human's sign-off / arbitration, THEN
apply).

### The detector, and why it needs two passes

A label that's just too-long TEXT is not the only way a row ends up on 2
lines - the leaf-text-only Range measurement below will completely miss a
label whose OWN text fits on one line but whose trailing sibling (the ⓘ
info icon, or a `<button>` like `myhome-energy`'s "debug: cache output")
gets pushed onto a second line. This was found the hard way, live, in this
project: several checkboxes' visible descriptions "passed" the first
version of this detector cleanly, then still visibly wrapped once a human
actually looked at the rendered dialog. `scan-wraps.mjs` therefore runs
BOTH:

1. **Leaf-level** - `Range.selectNodeContents(el)` +
   `getClientRects()` on a pure-text leaf element (a `<span>`/`<div>`/etc.
   with no element children); more than one distinct rounded `top` value
   among the rects means that text itself wraps. Robust regardless of the
   parent container's size - this is the standard, most direct way to ask
   "does the text inside this exact element span multiple lines".
2. **Container-level** - every `<label>` (the whole checkbox row: input +
   text + trailing icon/button), comparing its rendered `height` against
   one computed line-height. Catches the "text fits, but the row still
   wraps because of what comes after it" case that (1) can't see.

Run both, always - dropping either one reintroduces a real blind spot,
confirmed by that blind spot actually firing in production use of this
skill's first version.

**A container-only hit (`confidence: needs-visual-check` in the printed
report - no leaf-text match backs it up) still needs a look before you
propose wording for it, but default to treating it as REAL, not as a
probable false positive.** A label pairing a leading FontAwesome icon with
regular text (`<i class="fa fa-tags"></i> <span>Eigenschapsnaam</span>`,
in `myhome-light`'s secondary-output-name field) measured as genuinely "2
lines tall" by both the height heuristic and a `Range.getClientRects()`
check on the whole label (the icon's and the text's own sub-rects came back
with different `top` values, a full line-height apart). A same-session
headless screenshot of that exact measured bounding box then appeared to
show one clean visual line, which this file used to document as proof the
DOM measurement was a font-metric false positive - **that conclusion was
wrong.** The user went on to see the very same label actually wrapped in
their own real editor session and corrected it back: the wrap was real, the
shortened NL wording ("Eigenschap" instead of "Eigenschapsnaam") was needed
after all. Root cause never fully pinned down (a headless-Chromium screenshot
apparently is not reliable ground truth here either, for reasons not yet
understood - maybe DPI/zoom, maybe font-loading timing at screenshot time,
maybe something else) - but the practical lesson is: **don't trust a
headless screenshot's "it looks fine" over the DOM measurement's "it
doesn't fit", and don't trust either of those over a human directly
reporting what they see in their own browser.** When you can't get a
same-session live human check, the safe default for a `needs-visual-check`
row is to treat it as real and shorten it anyway - a label that's a couple
characters shorter than strictly necessary costs nothing, while shipping a
row that visibly wraps for real users does not. If you still want a second
opinion beyond the raw numbers, outline the element and screenshot it (the
pattern below) as one extra data point, but weigh it as circumstantial, not
decisive, and always defer to what a human actually reports seeing:

```js
await page.evaluate(() => {
  const el = [...document.querySelectorAll('.red-ui-tray-body label')]
    .find(l => l.textContent.trim().startsWith('theFlaggedText'));
  el.style.outline = '3px solid red';
});
const rect = await page.evaluate(() => { /* re-fetch el, return getBoundingClientRect() */ });
await page.screenshot({ path: 'out.png', clip: { x: rect.x - 60, y: rect.y - 20, width: 400, height: 80 } });
```

### Locale-forcing that's confirmed to work

`browser.newPage({ locale: 'fr-FR', extraHTTPHeaders: { 'Accept-Language':
'fr' } })` (i.e. pass these as page-creation options, NOT the sibling
skill's plain `withBrowser()` helper, which hardcodes no locale) reliably
makes Node-RED's editor render in French - verified by checking that the
"Name" field's own label reads exactly "Nom". No need for a `?lang=`
query-string fallback or the editor's own language picker in this project's
Node-RED version; `scan-wraps.mjs` already does this for whatever language
code you pass it.

## 2. Apply a fix (only after the wording is agreed)

Write a short throwaway script that imports `locale-edit-helpers.mjs` -
don't hand-edit the JSON with a plain string-replace `Edit` call on the old
text. Live experience editing French wording directly this way silently
failed most of the time: the `old_string`/`new_string` text contained
accented characters (é, è, à, ô, ...), and most of those replacements
reported "string not found" even though the text displayed identically -
almost certainly a Unicode-representation mismatch between how the edit
text got generated and the actual file bytes, not anything wrong with the
file. Matching by KEY NAME instead (always plain ASCII) sidesteps the
problem entirely, which is exactly what these helpers do:

```js
import { setLocaleValue, setCommonValueAcrossNodeTypes, bumpVersionCommon, checkVersionCommonConsistency }
  from './.claude/skills/check-label-wrapping/locale-edit-helpers.mjs';

// A key inside the shared "common" block - CLAUDE.md documents this block as a
// deliberate copy-paste duplication across all 9 node types WITHIN one language,
// so it needs setting in all 9, not just the file you happened to find it in:
setCommonValueAcrossNodeTypes('fr', 'option-skipevents', 'Ignorer');

// A key that only lives in one node's own file:
setLocaleValue('locales/fr/myhome-energy.json', 'enablecache', 'Cache');

// Whenever you've touched ANY key inside a "common" block (even just its
// VALUE, not its structure) in this session's batch of edits, bump the
// version marker once at the end, across ALL 27 files (not just the
// language you actually edited) - CLAUDE.md's own spot-check assumes this
// marker is always in sync across every locale file regardless of which
// language last changed, so leaving en-US/nl's stamp on an old date would
// make that check falsely report "propagation missed" later:
bumpVersionCommon();
console.log(checkVersionCommonConsistency()); // { consistent: true, values: ["2026.09.01"] }
```

After applying, re-run `scan-wraps.mjs <lang>` (it restarts+reseeds itself)
to confirm the fix actually lands as 1 line in the real rendered dialog -
a wording that "should" fit by character count is not reliable enough on
its own (see Gotchas) - and also grep-check `_version_common`:

```bash
grep -rh '"_version_common"' locales/ | sort -u   # must print exactly one line
```

## Gotchas

- **Char count is not a reliable predictor of wrap-fit - measure the real
  rendered width instead.** Two strings of the same length can render at
  visibly different pixel widths depending on which letters they use (wide
  letters like m/w vs narrow ones, accented characters, ...). Confirmed
  live: a 50-character French candidate wrapped while a 49-character
  sibling with different words didn't, and a rewrite validated as fitting
  by temporarily overwriting an element's `textContent` in one browser
  session came out wrapping for real once the actual locale file was
  changed and the dialog reopened fresh - close enough to the wrap
  threshold that don't trust anything without a live re-check after the
  real file is actually in place.
- **A `.json` locale value change needs a real server restart to show up,
  same as a `.html` change** (see the sibling skill's own gotcha about
  server-side caching of editor HTML) - a plain browser reload after
  editing a `locales/*.json` file will keep showing the old text.
  `scan-wraps.mjs` always restarts for you; don't skip that with
  `--no-seed` unless you're deliberately re-scanning the exact same
  already-running state.
- **The `Range.selectNodeContents` + container-height checks in this file
  only look at the topmost open Node-RED tray** (`.red-ui-tray-body`,
  last one in the DOM) - opening the gateway's nested config dialog from a
  device node stacks a second tray on top of the first; scanning only the
  last one avoids re-reporting the device node's own labels a second time
  and avoids picking up Node-RED's own (also localized) core editor chrome
  elsewhere on the page.
- **Not every wrapped label has a `data-i18n` attribute to key off.** A
  handful of labels in this project are built at runtime via jQuery
  `.text(scope._('...'))` rather than a static `data-i18n="..."` template
  attribute (the gateway's per-point-row Description/Room/AP/group-checkbox
  labels, its icon-picker category headers, and the scenario rules table's
  column header) - `CLAUDE.md`'s "Gateway BUS points registry" section
  documents exactly which ones and why. `scan-wraps.mjs` still catches
  these (the container/leaf checks don't require the attribute to detect a
  wrap), but reports `dataI18n: null` for them - resolve the actual i18n
  key yourself by grepping the visible text across `locales/<lang>/*.json`,
  or check the `.html` source directly, before writing a fix for one of
  these.
