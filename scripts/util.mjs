// Pure helpers shared by the whole module: no Foundry globals, unit-tested in tests/util.test.mjs.

/** The module's own interface languages (lang/en.json, lang/el.json). */
export const LANGUAGES = Object.freeze(["en", "el"]);

/** Read "A.B.C" from a nested dictionary; undefined when missing or not a string. */
export function lookup(dict, key) {
  if (!dict || typeof key !== "string") return undefined;
  const value = key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), dict);
  return typeof value === "string" ? value : undefined;
}

/** Replace {placeholders}; unknown placeholders stay as they are. */
export function fill(text, data) {
  if (!data) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(data, name) ? String(data[name]) : match));
}

/**
 * Which language a user sees the module in: their own choice ("en"/"el"), else the world's text
 * language, else Foundry's language, else English.
 */
export function pickLanguage(user, world, foundry) {
  for (const choice of [user, world, foundry]) if (LANGUAGES.includes(choice)) return choice;
  return "en";
}

/** dnd5e 6.0.x is the range the roll-internals code was checked against. */
export function isSupportedSystemVersion(version) {
  return /^6\.0\.\d+$/.test(String(version ?? ""));
}
