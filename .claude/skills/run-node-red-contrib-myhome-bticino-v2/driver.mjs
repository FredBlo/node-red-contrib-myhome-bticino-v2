#!/usr/bin/env node
/**
 * Drives a scratch Node-RED instance with this package linked in, for visually verifying custom
 * node editor HTML/CSS (config dialogs, editableList rows, icon pickers, etc.) that a test suite
 * can't check. See SKILL.md for the full story, the gotchas, and why each step is shaped this way.
 *
 * Usage (from anywhere - paths are resolved relative to this file):
 *   node driver.mjs setup             - npm install node-red + this repo (as a file: dep) + playwright-core
 *   node driver.mjs start             - start Node-RED in the background, wait until it responds
 *   node driver.mjs stop              - stop it
 *   node driver.mjs restart           - stop + start (REQUIRED after editing any node .html - see Gotchas)
 *   node driver.mjs seed [flow.json]  - deploy a flow via the Admin API (defaults to seed-flow.json)
 *   node driver.mjs demo              - seed the bundled demo flow, open the gateway's nested
 *                                       config dialog, expand a point row, screenshot to ./screenshots/
 *
 * For a custom interaction (not the canned demo), import the helpers from this file in your own
 * throwaway .mjs script: withBrowser(), gotoEditorAndDismissOnboarding(), PORT. See SKILL.md.
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, openSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..'); // .claude/skills/<name>/ -> repo root
const SCRATCH_DIR = path.join(os.tmpdir(), 'mh-bticino-nodered-test');
const USER_DIR = path.join(SCRATCH_DIR, '.node-red');
const PID_FILE = path.join(SCRATCH_DIR, 'node-red.pid');
const LOG_FILE = path.join(SCRATCH_DIR, 'node-red.log');
export const PORT = Number(process.env.MH_TEST_PORT || 1890);
const SCREENSHOTS_DIR = path.join(__dirname, 'screenshots');

function log(...args) { console.log('[driver]', ...args); }

function ensureScratchDir() {
  mkdirSync(USER_DIR, { recursive: true });
  const pkgPath = path.join(SCRATCH_DIR, 'package.json');
  if (!existsSync(pkgPath)) {
    writeFileSync(pkgPath, JSON.stringify({ name: 'mh-bticino-nodered-test', private: true }, null, 2));
  }
  // TechNote: Node-RED's own default (no settings.js) binds the admin UI to ALL interfaces
  // (0.0.0.0) with no auth - confirmed via `netstat` while this driver's instance was running,
  // reachable from anywhere on the LAN. uiHost restricts it to loopback only, regardless of
  // whether anyone remembers to `stop` it afterwards.
  const settingsPath = path.join(USER_DIR, 'settings.js');
  if (!existsSync(settingsPath)) {
    writeFileSync(settingsPath, 'module.exports = {\n  uiHost: "127.0.0.1",\n  flowFile: "flows.json",\n  functionGlobalContext: {}\n};\n');
  }
}

function cmdSetup() {
  ensureScratchDir();
  log('Installing node-red + this repo (as a file: dependency) into', SCRATCH_DIR);
  // TechNote: npm symlinks a `file:` dependency (confirmed: node_modules/node-red-contrib-.../ is
  // a symlink back to REPO_DIR) - so edits to this repo's .js/.html are picked up with no reinstall.
  execSync(`npm install --no-audit --no-fund node-red "file:${REPO_DIR.replace(/\\/g, '/')}"`, { cwd: SCRATCH_DIR, stdio: 'inherit' });
  // playwright-core is installed HERE (next to driver.mjs), not in SCRATCH_DIR: this file's own
  // `import('playwright-core')` resolves relative to its own location, not the scratch install -
  // installing it only in SCRATCH_DIR reproduces ERR_MODULE_NOT_FOUND on `demo`.
  if (!existsSync(path.join(__dirname, 'package.json'))) {
    writeFileSync(path.join(__dirname, 'package.json'), JSON.stringify({ name: 'run-node-red-contrib-myhome-bticino-v2-skill', private: true }, null, 2));
  }
  execSync('npm install --no-audit --no-fund --no-save playwright-core', { cwd: __dirname, stdio: 'inherit' });
  log('Setup done.');
}

export async function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function cmdStart() {
  ensureScratchDir();
  const redEntry = path.join(SCRATCH_DIR, 'node_modules', 'node-red', 'red.js');
  if (!existsSync(redEntry)) {
    log('node-red not installed yet in scratch dir - running setup first');
    cmdSetup();
  }
  const out = openSync(LOG_FILE, 'a');
  const child = spawn(process.execPath, [redEntry, '-u', USER_DIR, '-p', String(PORT)], {
    cwd: SCRATCH_DIR, detached: true, stdio: ['ignore', out, out],
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  log(`Started Node-RED (pid ${child.pid}), waiting for it to respond on port ${PORT}...`);
  const ok = await waitForServer();
  if (!ok) { log('Node-RED did not come up in time - check', LOG_FILE); process.exitCode = 1; return; }
  // TechNote: waitForServer() only checks 'does something answer on PORT' - if a PREVIOUS run's
  // Node-RED was left running (e.g. from an earlier session/turn that never called `stop`), this
  // spawn fails to bind (EADDRINUSE), its child process exits almost immediately, and waitForServer
  // still reports success because it's actually still talking to the OLD, stale process - which is
  // still serving whatever .html/.js content was on disk when IT started, silently ignoring any
  // edits made since. Confirmed live: a `restart` in this situation logs 'Node-RED is up' and exits
  // 0, yet none of the edits made after the stale process started ever showed up in the browser.
  // A signal-0 check (doesn't actually signal anything, just probes liveness) catches this: if the
  // child we just spawned has already died, whatever answered the port above wasn't it. The extra
  // wait here matters: waitForServer() can resolve within milliseconds when a stale server is
  // already up, which can be BEFORE our own spawn has even reached its (doomed) bind attempt.
  await new Promise(r => setTimeout(r, 1000));
  try {
    process.kill(child.pid, 0);
  } catch {
    log(`WARNING: the Node-RED process this call just spawned (pid ${child.pid}) is no longer running, but something is still answering on port ${PORT} - that's very likely a STALE Node-RED left over from an earlier run that was never stopped, silently serving old file content. Check ${LOG_FILE} for a bind/EADDRINUSE error, then find and kill whatever really owns the port (e.g. 'netstat -ano | findstr :${PORT}' on Windows) before trusting this restart.`);
    process.exitCode = 1;
    return;
  }
  log('Node-RED is up: http://localhost:' + PORT + '/');
}

// TechNote: killing only the pid-file's process is not enough - that pid can be stale (e.g. a
// process from an earlier, disconnected session was never stopped, and a later start overwrote
// the pid file with a DIFFERENT pid than whatever is actually bound to PORT). Reproduced live: a
// `restart` killed the pid file's (already-dead) pid, spawned a new process that stayed alive past
// the old 1s liveness check (this repo's node loading can take longer than that), then lost the
// bind race (EADDRINUSE) against a still-running, untracked process from hours earlier - `restart`
// printed "Node-RED is up" with no warning, yet kept serving stale file content indefinitely.
// Directly killing whatever ACTUALLY listens on PORT closes this regardless of pid-file accuracy.
function killPortOwner(port) {
  try {
    if (process.platform === 'win32') {
      let out;
      try { out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' }); } catch { return false; }
      const pids = new Set();
      for (const line of out.split('\n')) {
        const m = line.match(/LISTENING\s+(\d+)\s*$/);
        if (m) pids.add(m[1]);
      }
      let killedAny = false;
      for (const pid of pids) {
        try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'inherit' }); killedAny = true; }
        catch { /* already gone */ }
      }
      return killedAny;
    } else {
      let out;
      try { out = execSync(`lsof -ti:${port}`, { encoding: 'utf8' }).trim(); } catch { return false; }
      if (!out) return false;
      for (const pid of out.split('\n')) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
      }
      return true;
    }
  } catch { return false; }
}

function cmdStop() {
  let stoppedSomething = false;
  if (existsSync(PID_FILE)) {
    const pid = readFileSync(PID_FILE, 'utf8').trim();
    log('Stopping Node-RED (pid ' + pid + ')');
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'inherit' });
      } else {
        process.kill(Number(pid), 'SIGTERM');
      }
      stoppedSomething = true;
    } catch (e) { log('(process may already be gone)', e.message); }
  } else {
    log('No pid file - nothing tracked to stop');
  }
  if (killPortOwner(PORT)) {
    log(`Also killed a process actually listening on port ${PORT} that the pid file didn't know about (stale from an earlier run - see Gotchas)`);
    stoppedSomething = true;
  }
  if (!stoppedSomething) log('Nothing was listening on port ' + PORT + ' either - already clean.');
}

async function cmdRestart() {
  cmdStop();
  await new Promise(r => setTimeout(r, 1000));
  await cmdStart();
}

async function cmdSeed(flowPath) {
  const p = flowPath ? path.resolve(flowPath) : path.join(__dirname, 'seed-flow.json');
  const body = readFileSync(p, 'utf8');
  log('Deploying', p, 'via POST /flows');
  // TechNote: deploy via the Admin API, not by writing .node-red/flows.json directly - a config
  // node with no 'z' in a flow file loaded at boot got miscategorized as orphaned (dumped into an
  // auto-created, regenerated-every-load 'Recovered Nodes' tab); POST /flows right after startup
  // did not reproduce that. Also keep seed files OUTSIDE .node-red/ - Node-RED overwrites
  // flows.json with whatever was last deployed, so re-seeding from that same path can go stale.
  const res = await fetch(`http://localhost:${PORT}/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  log('Deploy result: HTTP', res.status);
  if (!res.ok) process.exitCode = 1;
}

export async function withBrowser(fn) {
  const { chromium } = await import('playwright-core');
  // TechNote: channel:'msedge' drives the system's already-installed Edge - verified working on
  // Windows. Not verified on Linux/macOS in this project; see SKILL.md Gotchas before assuming it
  // works unchanged there (try channel:'chrome', or a full `playwright install chromium`).
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', err => log('[pageerror]', err.message));
  try {
    await fn(page);
  } finally {
    await browser.close();
  }
}

export async function gotoEditorAndDismissOnboarding(page) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#red-ui-workspace', { timeout: 15000 });
  await page.waitForTimeout(800);
  const noThanks = page.locator('button:has-text("No, do not enable notifications")');
  if (await noThanks.count()) { await noThanks.click(); await page.waitForTimeout(300); }
  // Node-RED 5's 'Welcome to Node-RED 5.0!' tour overlay - Escape starts its fade-out, which must
  // be given time to finish or its shade keeps intercepting clicks on anything underneath it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
}

async function cmdDemo() {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  if (!(await waitForServer(2000))) { await cmdStart(); }
  await cmdSeed();
  await withBrowser(async (page) => {
    await gotoEditorAndDismissOnboarding(page);

    // Open the 'Test Light' node's edit dialog. force:true is required here: the node's SVG
    // <rect> body sits on top of its <text> label in hit-testing and intercepts the click that
    // Playwright's actionability check aims at the <text> element specifically.
    await page.dblclick('text=Test Light', { force: true });
    await page.waitForSelector('#dialog-form', { timeout: 10000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '01-light-node.png') });

    // Click the pencil icon next to the Gateway field to reach its nested config dialog - the
    // same path a real user takes, and it avoids the 'Global Configuration Nodes' sidebar tree
    // entirely (which can show a perfectly working config node as empty - see SKILL.md Gotchas).
    await page.locator('i.fa-pencil').first().click({ force: true });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '02-gateway-collapsed.png') });

    await page.click('text=Lights (6)');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '03-lights-expanded.png') });

    await page.click('text=Salon : Lampe plafond (1.1)');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCREENSHOTS_DIR, '04-row-expanded.png') });
  });
  log('Screenshots written to', SCREENSHOTS_DIR);
}

const [, , cmd, arg] = process.argv;
switch (cmd) {
  case 'setup': cmdSetup(); break;
  case 'start': await cmdStart(); break;
  case 'stop': cmdStop(); break;
  case 'restart': await cmdRestart(); break;
  case 'seed': await cmdSeed(arg); break;
  case 'demo': await cmdDemo(); break;
  default:
    console.log('Usage: node driver.mjs <setup|start|stop|restart|seed [file]|demo>');
    process.exitCode = 1;
}
