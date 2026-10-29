// Loads the real entry point against stubbed Foundry globals. This catches broken imports, missing
// exports and hook wiring mistakes; it does not replace testing in Foundry.
import { test } from "node:test";
import assert from "node:assert/strict";

const hooks = { once: {}, on: {} };
globalThis.Hooks = {
  once: (name, fn) => { hooks.once[name] = fn; },
  on: (name, fn) => { (hooks.on[name] ??= []).push(fn); },
  off() {}, callAll: () => true
};
class FakeApp { static DEFAULT_OPTIONS = {}; constructor(o) { this.options = o; } render() { return this; } }
globalThis.foundry = {
  applications: { api: { ApplicationV2: FakeApp, DialogV2: class {} }, instances: new Map() },
  utils: { randomID: () => "abc123", deepClone: v => structuredClone(v), escapeHTML: s => String(s) }
};
const settings = new Map();
const registered = { settings: [], menus: [], keys: [] };
globalThis.CONFIG = { queries: {}, statusEffects: [] };
globalThis.game = {
  system: { id: "dnd5e", version: "6.0.5" }, release: { generation: 14 },
  user: { isGM: true, id: "gm" },
  users: [{ id: "gm", active: true, isGM: true }],
  actors: { contents: [], some: () => false, [Symbol.iterator]: function* () {} },
  journal: { contents: [], get: () => null },
  combats: [],
  modules: new Map([["planar-homebrew", {}]]),
  settings: {
    register: (mod, key, cfg) => { registered.settings.push(`${mod}.${key}`); settings.set(key, cfg.default); },
    registerMenu: (mod, key) => registered.menus.push(key),
    get: (mod, key) => settings.get(key),
    set: async (mod, key, v) => settings.set(key, v)
  },
  keybindings: { register: (mod, key) => registered.keys.push(key) },
  i18n: { localize: k => k, format: k => k, has: () => false, lang: "en" }
};
game.users.activeGM = game.users[0];
globalThis.ui = { notifications: { warn() {}, info() {}, error() {} } };
globalThis.JournalEntry = { create: async () => ({ id: "j", ownership: { default: 0 }, getFlag: () => undefined, setFlag: async () => {} }) };

await import("../scripts/main.mjs");

test("registers settings, menus and the GM query on init", () => {
  hooks.once.init();
  for (const k of ["deathSavesEnabled", "deathSavesAuto", "deathSavesNPCs", "textLanguage", "debug", "language"]) assert.ok(registered.settings.includes(`planar-homebrew.${k}`), k);
  assert.deepEqual(registered.menus, ["manager", "companionStatus", "lightController"]);
  assert.equal(typeof CONFIG.queries["planar-homebrew.companionRequest"], "function");
  assert.equal(settings.get("textLanguage"), "el", "chat is Greek by default at our table");
});

test("exposes the api on game.modules and the old global on ready", () => {
  hooks.once.ready();
  const api = game.modules.get("planar-homebrew").api;
  for (const fn of ["open", "openManager", "openStatus", "openLights", "performCompanionAction", "calculateResonance", "togglePortableLight", "rollBlindDeathSave", "addPrivateDeathFailure"]) assert.equal(typeof api[fn], "function", fn);
  assert.equal(game.planarHomebrew, api);
  assert.equal(api.registry.list().length, 4);
  for (const hook of ["dnd5e.rollDamage", "dnd5e.preRollDeathSave", "preUpdateActor", "updateCombat", "dnd5e.postUseActivity", "updateWorldTime", "deleteToken"]) assert.ok(hooks.on[hook]?.length, hook);
});

test("token controls: manager for the GM only, lights for everyone", () => {
  const [fn] = hooks.on.getSceneControlButtons;
  const controls = { tokens: { tools: {} } };
  fn(controls);
  assert.equal(controls.tokens.tools["planar-homebrew-manager"].visible, true);
  assert.equal(controls.tokens.tools["planar-homebrew-lights"].visible, true);
  game.user.isGM = false;
  const player = { tokens: { tools: {} } };
  fn(player);
  assert.equal(player.tokens.tools["planar-homebrew-manager"].visible, false);
  assert.equal(player.tokens.tools["planar-homebrew-companions"].visible, false, "no companion → no button");
  game.user.isGM = true;
  assert.doesNotThrow(() => fn({}));
});
