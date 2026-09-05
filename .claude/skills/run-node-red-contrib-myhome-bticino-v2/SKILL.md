---
name: run-node-red-contrib-myhome-bticino-v2
description: Build, run, and visually drive node-red-contrib-myhome-bticino-v2's Node-RED editor UI (config dialogs, editableList rows, icon pickers) with a real browser. Use when asked to run this project, start it, screenshot a node's editor UI, or verify a .js/.html UI change actually renders correctly.
---

This is a Node-RED node package, not a standalone app - "running" it
means launching a scratch Node-RED instance with this repo linked in,
then driving its browser-based editor with Playwright (headless Edge)
to open a node's config dialog and screenshot it. Drive it via
`.claude/skills/run-node-red-contrib-myhome-bticino-v2/driver.mjs` - all
commands below can be run from anywhere, paths resolve relative to the
driver file itself.

All paths below are relative to the repo root.

**Security / lifecycle**: this instance has no admin authentication and
is meant to be short-lived. `settings.js` pins it to `uiHost:
"127.0.0.1"` (loopback only) so it's never reachable from the network
regardless of whether anyone remembers to stop it - confirmed via
`netstat` both before that fix (`0.0.0.0:1890`, reachable from the
whole LAN) and after (`127.0.0.1:1890`). On top of that: start it only
when you're about to use it, and run `stop` as the last step once
you're done verifying for that round, rather than leaving it running
"just in case" - `start`/`demo` are cheap (a few seconds) precisely so
there's no reason to keep it up between rounds.

## Prerequisites

Verified on **Windows** with Node.js 24 and Microsoft Edge already
installed system-wide (`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`).
No OS packages to install beyond that - `npm install` pulls in
`node-red` and `playwright-core` (the latter drives the *system*
browser via `channel: 'msedge'`, no ~300MB Chromium download).

Not verified on Linux/macOS in this project - see Gotchas before
assuming `channel: 'msedge'` works unchanged there.

## Setup

```bash
node .claude/skills/run-node-red-contrib-myhome-bticino-v2/driver.mjs setup
```

This installs `node-red` and this repo itself (as an npm `file:`
dependency) into a scratch directory (`<os tmpdir>/mh-bticino-nodered-test`,
outside the repo), and installs `playwright-core` next to the driver
script. npm **symlinks** a `file:` dependency, so editing this repo's
`.js`/`.html` is picked up by the linked copy with no reinstall step -
confirmed via `node_modules/node-red-contrib-myhome-bticino-v2 ->
<repo>` in the scratch dir.

No separate build step - this package has none.

## Run (agent path)

```bash
node .claude/skills/run-node-red-contrib-myhome-bticino-v2/driver.mjs demo
```

Starts Node-RED if it isn't already running, deploys the bundled demo
flow (a `myhome-gateway` config node with 6 seeded "Lights" points,
plus a `myhome-light` node referencing it), opens the light node's
edit dialog, follows the pencil icon into the gateway's nested config
dialog, expands the "Lights" section and one point row, and writes 4
screenshots to `.claude/skills/run-node-red-contrib-myhome-bticino-v2/screenshots/`.

For anything beyond that canned path, write a short throwaway `.mjs`
script that imports the driver's exported helpers instead of
re-deriving them:

```js
import { withBrowser, gotoEditorAndDismissOnboarding, PORT } from './.claude/skills/run-node-red-contrib-myhome-bticino-v2/driver.mjs';

await withBrowser(async (page) => {
  await gotoEditorAndDismissOnboarding(page);
  // ... your own dblclick/click/fill/screenshot calls (see Gotchas for the
  // {force:true} and pencil-icon patterns this project needs) ...
});
```

| driver.mjs command | what it does |
|---|---|
| `setup` | npm install node-red + this repo (`file:` dep) + playwright-core |
| `start` | start Node-RED in the background, wait until it responds on port 1890 |
| `stop` | stop it |
| `restart` | stop + start - **required** after editing any node `.html` (see Gotchas) |
| `seed [flow.json]` | deploy a flow via the Admin API (defaults to the bundled `seed-flow.json`) |
| `demo` | the full proof-of-life flow described above |

Screenshots land in `.claude/skills/run-node-red-contrib-myhome-bticino-v2/screenshots/`.
Node-RED's own log is at `<os tmpdir>/mh-bticino-nodered-test/node-red.log`.

## Run (human path)

Same `setup`/`start` commands, then open `http://localhost:1890/` in a
real browser. `stop` (or close the terminal) to end it. Set
`MH_TEST_PORT` to use a different port.

## Test

No automated test suite in this repo. `npx eslint .` catches syntax
errors in the `.js`/`.html` node files (config in `eslint.config.js`)
but says nothing about how the editor UI actually renders - that's
exactly the gap this skill's `demo`/screenshot flow fills.

---

## Gotchas

- **Node-RED's own default (no `settings.js`) binds the admin UI to
  `0.0.0.0` with no authentication** - reachable from every other
  device on the LAN, not just this machine, confirmed with `netstat`.
  `ensureScratchDir()` writes a `settings.js` with `uiHost:
  "127.0.0.1"` into the scratch userDir before first start to close
  this off; if you ever hand-edit or delete that file, re-check with
  `netstat -ano | grep :1890` (or the platform equivalent) that it
  still says `127.0.0.1`, not `0.0.0.0`.
- **Editing a node's `.html` is NOT picked up by a plain browser
  reload while Node-RED keeps running**, even though the file is a
  live symlink. Node-RED appears to cache the combined editor-side
  node HTML at the server level. Run `driver.mjs restart` (not just a
  page refresh) after any `.html` change, the same as you'd need for a
  `.js` change.
- **`restart`/`start` can silently no-op and still print "Node-RED is
  up"** if a Node-RED instance from an *earlier, unrelated* run was
  left listening on the port (e.g. `stop` was never called at the end
  of a previous session/turn). The new spawn fails to bind
  (`EADDRINUSE`) and exits almost immediately, but `waitForServer()`
  only checks "does *something* answer on the port" - it happily
  reports success because the OLD, stale process is still answering,
  still serving whatever `.html`/`.js` content was on disk when *it*
  started. Reproduced live TWICE: once where the new spawn died within
  a second (caught by the liveness check below), and once where it
  survived past that 1s check (this repo's node loading can take
  longer than that) before losing the bind race moments later - so the
  liveness check alone reported a false "is up" with no warning, and
  the OLD process kept serving stale locale/`.html` content
  indefinitely across several more `restart`s. Root cause both times:
  `cmdStop()` only ever killed the pid recorded in the pid file, which
  goes stale the moment an untracked process is left running from an
  earlier, disconnected session. Fixed at the source instead of
  papering over the timing: `cmdStop()` (and therefore `restart`) now
  ALSO looks up and kills whatever is actually listening on `PORT` via
  `netstat`/`taskkill` (Windows) or `lsof`/`SIGKILL` (POSIX,
  best-effort, unverified), regardless of what the pid file says - see
  `killPortOwner()`. `cmdStart()` still keeps its post-spawn liveness
  check as a secondary safety net (prints a clear warning and exits
  non-zero if the process it just spawned has already died), but the
  proactive kill-by-port in `stop` is what actually prevents the race
  rather than just detecting it after the fact. If you ever see that
  warning anyway, don't trust the restart - `netstat -ano | findstr
  :1890` (Windows) to find whatever still owns the port, kill it
  directly, then retry.
- **Hand-editing `.node-red/flows.json` and letting Node-RED load it
  at boot mis-scoped a config node.** A `myhome-gateway` node with no
  `z` property got miscategorized as an orphaned node and dumped into
  an auto-created "Recovered Nodes" tab - regenerated with a new
  random ID on every single page load, and the config node then showed
  as empty under "Global Configuration Nodes" in the sidebar, even
  though it worked fine everywhere else. Deploying the exact same JSON
  via `POST /flows` (the Admin API - what `driver.mjs seed` does)
  right after Node-RED starts did not reproduce this. Keep seed flow
  files outside `.node-red/` regardless - Node-RED overwrites
  `flows.json` with whatever was last deployed (including an
  intentional empty-array reset), so re-seeding from that same path
  can silently deploy nothing.
- **Don't bother with the "Global Configuration Nodes" sidebar tree**
  to reach a config node's edit dialog - it can show a perfectly
  working config node as "empty" for the z-scoping reason above. Open
  a *device* node that references it instead (`dblclick`) and click
  the pencil icon (`i.fa-pencil`) next to the config-node field - the
  same path a real user takes, and it always works regardless of
  sidebar categorization.
- **`dblclick` on a canvas node needs `{force: true}`.** The node's
  SVG `<rect>` body sits on top of its `<text>` label in hit-testing
  and intercepts the click Playwright's actionability check aims at
  the `<text>` element specifically, causing a 30s timeout otherwise.
- **First page load shows two blocking overlays**: a one-time "Enable
  Update Notifications" dialog, and (Node-RED 5+) a "Welcome to
  Node-RED 5.0!" tour guide whose shade keeps intercepting clicks
  during its fade-out animation. Dismiss the dialog by button text,
  then press `Escape` and wait ~1.2s before doing anything else -
  `gotoEditorAndDismissOnboarding()` already does both.
- **`playwright-core`'s dynamic `import()` resolves relative to
  `driver.mjs`'s own location, not the scratch install directory.**
  Installing it only under the scratch dir (where `node-red` lives)
  reproduces `ERR_MODULE_NOT_FOUND` the moment `demo`/`withBrowser` is
  used - it must also be installed next to `driver.mjs` itself (which
  `setup` does).
- **Prefer `page.evaluate(() => el.getBoundingClientRect() /
  getComputedStyle(el))` over eyeballing a screenshot** for exact
  alignment/sizing questions. It caught a real bug a screenshot alone
  made look "close enough": a `<select>` pinned to Node-RED's own
  default width and `box-sizing: content-box` despite a `width: 100%`
  class rule - the same "Node-RED's core CSS beats a plain class rule"
  pattern documented in this repo's `CLAUDE.md`, just not yet applied
  to that particular element.

## Troubleshooting

- **`Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'playwright-core'`**
  when running `demo`: `setup` wasn't run (or was run before this
  Gotcha was fixed and only installed it in the scratch dir). Re-run
  `driver.mjs setup`.
- **`node driver.mjs start` reports "did not come up in time"**: check
  `<os tmpdir>/mh-bticino-nodered-test/node-red.log` - most likely
  another process is already using port 1890 (`driver.mjs stop` first,
  or set `MH_TEST_PORT` to a free port).
- **A screenshot shows the flow editor but the expected node/dialog
  isn't there**: the seed flow probably wasn't (re-)deployed after a
  Node-RED restart - `demo` re-seeds every time, but if you're scripting
  your own flow, call `seed` again after any `restart`.
