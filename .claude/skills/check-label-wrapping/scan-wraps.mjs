#!/usr/bin/env node
/**
 * Scans every device/session node dialog + the fully-expanded gateway dialog, in a given editor
 * locale, for labels that render on 2+ lines - see SKILL.md for the full story.
 *
 * Usage: node scan-wraps.mjs <lang>        (e.g. fr, nl, en-US)
 *        node scan-wraps.mjs fr --no-seed  (skip restart+seed; use whatever is already running)
 *
 * Prints a deduplicated list of every wrapped label found, with its data-i18n key (when the
 * element has one) and the current text in `lang`, plus the same key's en-US text for reference.
 * This is READ-ONLY - it never edits any file. Use locale-edit-helpers.mjs from your own
 * throwaway script to apply a fix once you've agreed on a shorter wording.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveI18nText } from './locale-edit-helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..');
const DRIVER = path.join(REPO_DIR, '.claude', 'skills', 'run-node-red-contrib-myhome-bticino-v2', 'driver.mjs');
const SEED = path.join(__dirname, 'all-nodes-seed-flow.json');
const PORT = Number(process.env.MH_TEST_PORT || 1890);

const [, , langArg, ...rest] = process.argv;
const lang = langArg || 'fr';
const skipSeed = rest.includes('--no-seed');
// Node-RED's editor negotiates its own UI language from the browser context's locale/Accept-Language
// (confirmed live: locale:'fr-FR' + Accept-Language:'fr' reliably yields the French editor). This
// project's own locale folder for English is "en-US", but the *browser* locale for that is just "en".
const browserLocale = lang === 'en-US' ? 'en-US' : lang;
const acceptLanguage = lang === 'en-US' ? 'en' : lang;

if (!skipSeed) {
  console.log(`[scan-wraps] restarting the test server (kills any stale process on port ${PORT}) and seeding the all-nodes flow...`);
  execSync(`node "${DRIVER}" restart`, { stdio: 'inherit' });
  execSync(`node "${DRIVER}" seed "${SEED}"`, { stdio: 'inherit' });
}

const { chromium } = await import('playwright-core');

// The combined detector: (1) leaf-level - a single text-only span/div/button/etc, measured via
// Range.getClientRects() (multiple distinct `top` values = wrapped); (2) label-container level -
// the WHOLE <label> (checkbox + text + trailing info-icon and/or button), measured by comparing
// its rendered height to one line-height. (1) alone misses a label whose OWN text fits on one line
// but whose trailing sibling (the (i) info icon, or a button like energy's "debug: cache output")
// gets pushed to a second line - caught live only once a human actually looked at the rendered
// dialog, not from the text-only measurement. Always use both.
function wrapCheckFn() {
  return () => {
    function leafWraps(el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = Array.from(range.getClientRects());
      const tops = new Set(rects.map(r => Math.round(r.top)));
      return tops.size > 1;
    }
    function containerWraps(el) {
      const cs = getComputedStyle(el);
      let lh = parseFloat(cs.lineHeight);
      if (!lh || isNaN(lh)) lh = parseFloat(cs.fontSize) * 1.3;
      const rect = el.getBoundingClientRect();
      return rect.height > lh * 1.5;
    }
    const trays = Array.from(document.querySelectorAll('.red-ui-tray-body'));
    // No fallback to document.body: if no tray is open (a transient close/open race), scanning the
    // whole page instead would sweep up Node-RED's own (also localized) sidebar/debug-panel text
    // and misreport it as a wrapped config-dialog label - confirmed live, caught only by noticing a
    // stray runtime debug message ("gateway connection issue...") in a scan's own output.
    if (trays.length === 0) return [];
    const root = trays[trays.length - 1];
    const found = [];
    root.querySelectorAll('label').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const cs0 = getComputedStyle(el);
      if (cs0.display === 'none' || cs0.visibility === 'hidden') return;
      const text = el.textContent.replace(/\u00A0/g, ' ').trim();
      if (!text) return; // spacer labels used for grid alignment, not real content
      if (containerWraps(el)) found.push({ kind: 'label', dataI18n: null, text });
    });
    root.querySelectorAll('span, b, h4, h3, div, button').forEach(el => {
      if (el.children.length > 0) return; // only leaf (pure-text) elements
      const text = el.textContent.replace(/\u00A0/g, ' ').trim();
      if (!text) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      if (leafWraps(el)) found.push({ kind: 'leaf', dataI18n: el.getAttribute('data-i18n'), text });
    });
    return found;
  };
}

async function dismissOnboarding(page) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#red-ui-workspace', { timeout: 15000 });
  await page.waitForTimeout(800);
  const noThanks = page.locator('button:has-text("No, do not enable notifications")');
  if (await noThanks.count()) { await noThanks.click(); await page.waitForTimeout(300); }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1200);
}

// Node-RED's "Cancel" button label is itself translated - close dialogs by Escape-equivalent
// click on whichever of these matches (French "Annuler", Dutch "Annuleren", English "Cancel").
const CANCEL_LABELS = ['Cancel', 'Annuler', 'Annuleren'];
async function closeDialog(page) {
  // Compare the tray count before/after, not "wait for zero trays" - closing a NESTED dialog (e.g.
  // the gateway's config dialog reached via a device node's pencil icon) still leaves the outer
  // device-node tray open underneath, so "zero trays" would never come and this would just time out.
  const before = await page.locator('.red-ui-tray-body').count();
  for (const label of CANCEL_LABELS) {
    const btn = page.locator(`button:has-text("${label}")`);
    if (await btn.count()) {
      await btn.click().catch(() => {});
      // A dblclick fired while the closed tray is still mid-close-animation can transiently see
      // zero trays open at all (the next one hasn't appeared yet either) - wrapCheckFn now returns
      // an empty result rather than silently falling back to scanning the whole page in that case
      // (confirmed live: it used to sweep up Node-RED's own sidebar/debug-panel text and misreport
      // it as a wrapped label), but it's still better to just not race it in the first place.
      for (let i = 0; i < 20; i++) {
        if ((await page.locator('.red-ui-tray-body').count()) < before) break;
        await page.waitForTimeout(100);
      }
      return;
    }
  }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: browserLocale, extraHTTPHeaders: { 'Accept-Language': acceptLanguage } });
await dismissOnboarding(page);

const allFound = []; // { context, kind, dataI18n, text }

const NODE_NAMES = ['Test Light', 'Test Shutter', 'Test ThermoCentral', 'Test ThermoZone', 'Test Energy', 'Test EventSession', 'Test CommandSession', 'Test Scenario'];
for (const name of NODE_NAMES) {
  await page.dblclick('text=' + name, { force: true });
  await page.waitForSelector('.red-ui-tray-body', { timeout: 10000 });
  await page.waitForTimeout(400);
  const results = await page.evaluate(wrapCheckFn());
  for (const r of results) allFound.push({ context: name, ...r });
  await closeDialog(page);
  await page.waitForTimeout(250);
}

// Gateway, nested via Test Light's pencil icon, all sections expanded.
await page.dblclick('text=Test Light', { force: true });
await page.waitForSelector('.red-ui-tray-body', { timeout: 10000 });
await page.waitForTimeout(400);
await page.locator('i.fa-pencil').first().click({ force: true });
await page.waitForTimeout(600);
for (const id of ['#mh-gw-light-header', '#mh-gw-shutter-header', '#mh-gw-energy-header', '#mh-gw-thermozone-header', '#mh-gw-advanced-header']) {
  await page.click(id).catch(() => {});
  await page.waitForTimeout(300);
}
const gwResults = await page.evaluate(wrapCheckFn());
for (const r of gwResults) allFound.push({ context: 'Gateway (all sections expanded)', ...r });
await closeDialog(page);
await page.waitForTimeout(250);
await closeDialog(page);

await browser.close();

// Dedupe by TEXT, not by key: the leaf check and the label-container check often both fire for the
// SAME wrapped row (the row's own text also renders as 2 lines once its container is too narrow),
// but only the leaf check can resolve a data-i18n key - the container check always reports
// dataI18n:null since a <label> itself never carries the attribute (its inner <span> does). Prefer
// whichever occurrence of a given text HAS a resolved key. Separately, the same "common" key
// legitimately appears identically in several node dialogs (see CLAUDE.md's documented
// per-node-type duplication) - report it once with the list of dialogs it was seen in.
const byText = new Map();
for (const item of allFound) {
  const dedupeKey = item.text;
  if (!byText.has(dedupeKey)) byText.set(dedupeKey, { ...item, contexts: [item.context], hasLeaf: item.kind === 'leaf' });
  else {
    const existing = byText.get(dedupeKey);
    if (!existing.dataI18n && item.dataI18n) existing.dataI18n = item.dataI18n;
    if (!existing.contexts.includes(item.context)) existing.contexts.push(item.context);
    if (item.kind === 'leaf') existing.hasLeaf = true;
  }
}

// IMPORTANT: a "label"-only finding (no leaf-text match ever confirmed the same text as wrapping
// on its own) is NOT reliable on its own - a label pairing an icon-font glyph with regular text can
// report a spurious height/multi-line signal purely from icon/text line-height metric mismatches,
// with NOTHING actually wrapping on screen. Confirmed live: a label read as "2 lines tall" by both
// the height check and a Range check on the whole label, yet an outlined screenshot of that exact
// measured box showed one clean visual line. Always screenshot-and-look at a `needs-visual-check`
// row before proposing a fix for it - don't trust the number alone, unlike every leaf-confirmed row.
console.log('\n=== Wrapped labels found (' + lang + ') ===\n');
const rows = [];
for (const item of byText.values()) {
  const enText = item.dataI18n ? resolveI18nText('en-US', item.dataI18n) : undefined;
  rows.push({
    key: item.dataI18n || '(none - dynamically built)',
    [lang]: item.text,
    'en-US': enText || '',
    dialogs: item.contexts.join(', '),
    confidence: item.hasLeaf ? 'confirmed' : 'needs-visual-check',
  });
}
console.table(rows);
console.log(JSON.stringify(rows, null, 2));
