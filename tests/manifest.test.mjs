import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODULE_ID } from "../scripts/core/constants.mjs";
import { LIGHT_PRESETS } from "../scripts/core/light-presets.mjs";
import { COMPANION_STATES } from "../scripts/core/constants.mjs";

const manifest = JSON.parse(readFileSync(new URL("../module.json", import.meta.url), "utf8"));
const file = p => new URL(`../${p}`, import.meta.url);

test("manifest has the fields Foundry requires", () => {
  for (const k of ["id", "title", "description", "version", "compatibility"]) assert.ok(manifest[k], k);
  assert.equal(manifest.id, MODULE_ID, "constants.mjs and module.json must agree");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.compatibility.minimum, "14");
  assert.equal(manifest.relationships.systems[0].id, "dnd5e");
  assert.deepEqual(manifest.esmodules, ["scripts/main.mjs"]);
  assert.ok(manifest.relationships.recommends.some(r => r.id === "planar-glitch"));
});

test("every referenced file exists", () => {
  for (const p of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) assert.ok(existsSync(file(p)), p);
  assert.deepEqual(manifest.languages.map(l => l.lang).sort(), ["el", "en"]);
});

const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const langs = Object.fromEntries(manifest.languages.map(l => [l.lang, JSON.parse(readFileSync(file(l.path), "utf8"))]));

test("all languages define exactly the same keys as English", () => {
  const en = flatten(langs.en).sort();
  for (const [code, data] of Object.entries(langs)) assert.deepEqual(flatten(data).sort(), en, `${code} differs from en`);
});

test("placeholders match between languages", () => {
  const get = (o, path) => path.split(".").reduce((x, k) => x[k], o);
  const holders = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const key of flatten(langs.en)) {
    for (const [code, data] of Object.entries(langs)) assert.equal(holders(get(data, key)), holders(get(langs.en, key)), `${code}: ${key}`);
  }
});

const walk = dir => readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sources = walk(new URL("../scripts", import.meta.url).pathname).filter(p => p.endsWith(".mjs")).map(p => readFileSync(p, "utf8")).join("\n");

test("every localization key used in the code exists", () => {
  const known = new Set(flatten(langs.en).map(k => k.replace(/^PLANAR_HOMEBREW\./, "")));
  const used = new Set([
    ...[...sources.matchAll(/\b(?:t|tw|fail|warn|info|error)\(\s*'([A-Z][\w.]+)'/g)].map(m => m[1]),
    ...[...sources.matchAll(/button\('[\w-]+',\s*'([A-Z][\w.]+)'/g)].map(m => m[1]),
    ...[...sources.matchAll(/'((?:Rule|Chat|Death|Light|Companion|Common|Err)\.[\w.]+)'/g)].map(m => m[1]),
    ...[...sources.matchAll(/PLANAR_HOMEBREW\.([\w.]+)/g)].map(m => m[1]).filter(k => !k.endsWith("."))
  ]);
  assert.ok(used.size > 250, `found the keys (${used.size})`);
  for (const key of used) assert.ok(known.has(key), `missing key ${key}`);
  // keys built from lists
  for (const s of COMPANION_STATES) assert.ok(known.has(`State.${s}`), s);
  for (const p of Object.keys(LIGHT_PRESETS)) assert.ok(known.has(`Preset.${p}`), p);
  for (const c of ["bonus", "action", "free"]) assert.ok(known.has(`Cost.${c}`), c);
  for (const o of ["pending", "stable", "dead", "revived"]) assert.ok(known.has(`Death.Outcome.${o}`), o);
  for (const r of ["Resonance", "Companion", "Light", "Death"]) for (const f of ["Name", "Target", "Hint", "Manager"]) assert.ok(known.has(`Rule.${r}.${f}`), `${r}.${f}`);
  for (const a of ["manifest", "return", "returnFree", "recall", "dismiss", "destroy", "command", "unbind"]) assert.ok(known.has(`Companion.Action.${a}`), a);
  for (const a of ["Manifest", "Recall", "Dismiss", "Destroy", "Command", "Vanish"]) assert.ok(known.has(`Chat.CompanionAction.${a}`), a);
  for (const key of ["deathSavesEnabled", "deathSavesAuto", "deathSavesNPCs", "textLanguage", "debug", "language"]) {
    assert.ok(known.has(`Settings.${key}.Name`) && known.has(`Settings.${key}.Hint`), key);
  }
});

test("no hard-coded user-facing English left in thrown errors", () => {
  // Errors shown to users go through fail(key). Plain Errors are allowed only in the registry and the
  // roll-internals guards, whose messages go to the diagnostics log, not to a person.
  const allowed = ["Invalid rule definition", "Rule already registered", "Bonus roll has no evaluated terms", "Unsupported critical-dice representation", "Native roll total was not updated"];
  for (const [, text] of sources.matchAll(/new Error\(\s*[`'"]([^`'"]+)/g)) {
    assert.ok(allowed.some(a => text.startsWith(a)), `hard-coded error: ${text}`);
  }
});

test("the repo carries no DM secrets or book text (it is public; players can read it)", () => {
  const texts = ["lang/en.json", "lang/el.json", "README.md", "module.json"].map(p => [p, readFileSync(file(p), "utf8")]);
  for (const [p, text] of texts) {
    for (const word of ["Shemeshka", "DM eyes only", "Kallidor", "Aerlis", "Strahd"]) assert.ok(!text.includes(word), `${p} mentions ${word}`);
  }
});
