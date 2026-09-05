/**
 * Small helpers for safely editing this repo's locales/<lang>/myhome-*.json files by KEY rather
 * than by matching the old text value. Import these from a throwaway script when actually applying
 * a wording fix after scan-wraps.mjs has identified it (see SKILL.md).
 *
 * Why by-key and not a plain Edit/string-replace on the old accented text: doing this work live
 * once, most `old_string` replacements containing accented French characters (é, è, à, ô, ...)
 * silently failed to match even though the displayed text looked identical - almost certainly a
 * Unicode representation mismatch between how the text was generated for the edit and the actual
 * file bytes. Matching on the KEY NAME (always plain ASCII) and replacing only the value after it
 * sidesteps the whole problem, and is also just less error-prone to type by hand.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..'); // .claude/skills/check-label-wrapping/ -> repo root

export const NODE_TYPES = ['light', 'shutter', 'scenario', 'thermo-central', 'thermo-zone', 'energy', 'eventsession', 'commandsession', 'gateway'];
export const LANGUAGES = ['en-US', 'fr', 'nl'];

export function localeFile(lang, nodeType) {
  return path.join(REPO_DIR, 'locales', lang, `myhome-${nodeType}.json`);
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Set a single "key": "value" pair in one locale JSON file, matched by key name (not by old value). */
export function setLocaleValue(file, key, value) {
  let content = readFileSync(file, 'utf8');
  const re = new RegExp('("' + escapeRegExp(key) + '"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"');
  if (!re.test(content)) throw new Error(`Key "${key}" not found in ${file}`);
  content = content.replace(re, (_, prefix) => prefix + JSON.stringify(value));
  JSON.parse(content); // fail loudly before writing anything if this broke the JSON
  writeFileSync(file, content, 'utf8');
}

/**
 * Set a key that lives in the shared "common" block identically in ALL 9 of one language's node
 * files - required because (per CLAUDE.md) that block is a deliberate copy-paste duplication
 * across node types WITHIN a language, not a single shared source. Does NOT touch other languages
 * and does NOT bump _version_common - call bumpVersionCommon() separately once you're done with a
 * batch of common-block edits.
 */
export function setCommonValueAcrossNodeTypes(lang, key, value) {
  for (const nodeType of NODE_TYPES) {
    setLocaleValue(localeFile(lang, nodeType), key, value);
  }
}

/**
 * Bump `_version_common` to `date` (default: today, "YYYY.MM.DD") in ALL 27 locale files (3
 * languages x 9 node types) - per CLAUDE.md this marker is meant to stay byte-identical across
 * every file regardless of which language's wording actually changed, so its own spot-check
 * (`grep -rh "_version_common" locales/ | sort -u` => exactly one line) doesn't false-positive.
 */
export function bumpVersionCommon(date) {
  const d = date || new Date().toISOString().slice(0, 10).replace(/-/g, '.');
  for (const lang of LANGUAGES) {
    for (const nodeType of NODE_TYPES) {
      const file = localeFile(lang, nodeType);
      let content = readFileSync(file, 'utf8');
      content = content.replace(/("_version_common"\s*:\s*)"[\d.]+"/, (_, prefix) => prefix + JSON.stringify(d));
      JSON.parse(content);
      writeFileSync(file, content, 'utf8');
    }
  }
  return d;
}

/** Returns { consistent, values } - values should be a single-element array if everything is in sync. */
export function checkVersionCommonConsistency() {
  const values = new Set();
  for (const lang of LANGUAGES) {
    for (const nodeType of NODE_TYPES) {
      const content = readFileSync(localeFile(lang, nodeType), 'utf8');
      const m = content.match(/"_version_common"\s*:\s*"([\d.]+)"/);
      values.add(m ? m[1] : 'MISSING:' + localeFile(lang, nodeType));
    }
  }
  return { consistent: values.size === 1, values: [...values] };
}

/** Resolve a data-i18n value like "node-red-contrib-myhome-bticino-v2/myhome-light:common.option-readonly"
 *  (or a bare "common.option-readonly" / "mh-gateway.config.type-temperature-checkbox") to its
 *  current string value in a given language, by loading that node's own locale file and walking
 *  the dotted path - the JSON structure mirrors the dotpath 1:1. */
export function resolveI18nText(lang, dataI18nOrKey, fallbackNodeType) {
  let nodeType = fallbackNodeType;
  let key = dataI18nOrKey;
  const colon = dataI18nOrKey.indexOf(':');
  if (colon !== -1) {
    const modulePart = dataI18nOrKey.slice(0, colon); // e.g. ".../myhome-light"
    key = dataI18nOrKey.slice(colon + 1);
    const m = modulePart.match(/myhome-([a-z-]+)$/);
    if (m) nodeType = m[1];
  }
  if (!nodeType) return undefined;
  try {
    const root = JSON.parse(readFileSync(localeFile(lang, nodeType), 'utf8'));
    return key.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), root);
  } catch {
    return undefined;
  }
}
