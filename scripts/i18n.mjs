// Interface text. The module keeps its own English and Greek dictionaries, so each user can switch the
// module's language without switching all of Foundry (client setting "language", the EN/ΕΛ button in its
// windows). Chat lines that everyone reads use the world's "textLanguage" (Greek by default at our table).
// Until the dictionaries are loaded, and for anything missing, Foundry's own i18n answers.
import { ID } from "./core/constants.mjs";
import { lookup, fill, LANGUAGES, pickLanguage } from "./util.mjs";

const PREFIX = "PLANAR_HOMEBREW.";
const dict = {};

/** Install a dictionary directly (tests, or a module that already has the JSON). */
export function setDictionary(lang, data) {
  dict[lang] = data?.PLANAR_HOMEBREW ?? data ?? null;
}

/** Load lang/en.json and lang/el.json (once, at init). */
export async function loadDictionaries() {
  await Promise.all(LANGUAGES.map(async lang => {
    try { setDictionary(lang, await (await fetch(`modules/${ID}/lang/${lang}.json`)).json()); }
    catch (err) { console.warn(`${ID} | lang/${lang}.json`, err); }
  }));
}

const setting = key => { try { return globalThis.game?.settings?.get(ID, key); } catch { return undefined; } };

/** This user's language for the module: their choice, the world default, or Foundry's. */
export const language = () => pickLanguage(setting("language"), setting("textLanguage"), globalThis.game?.i18n?.lang);

/** The language of text everyone reads (chat): the world setting, else Foundry's language. */
export const textLanguage = () => pickLanguage(setting("textLanguage"), undefined, globalThis.game?.i18n?.lang);

/** The EN/ΕΛ button: switch this user's language. */
export const toggleLanguage = () => game.settings.set(ID, "language", language() === "el" ? "en" : "el");

/** Localize a key under PLANAR_HOMEBREW.* in a given language, with {placeholders}. */
export function tIn(lang, key, data) {
  const text = lookup(dict[lang], key) ?? lookup(dict.en, key);
  if (text !== undefined) return fill(text, data);
  const i18n = globalThis.game?.i18n;
  if (i18n?.has?.(PREFIX + key)) return data ? i18n.format(PREFIX + key, data) : i18n.localize(PREFIX + key);
  return fill(key, data);
}

/** Text for this user. */
export const t = (key, data) => tIn(language(), key, data);
/** Text for everyone (chat messages): the world's text language. */
export const tw = (key, data) => tIn(textLanguage(), key, data);

/** An Error whose message is already localized for this user. */
export const fail = (key, data) => new Error(t(key, data));

export const warn = (key, data) => ui.notifications.warn(t(key, data));
export const info = (key, data) => ui.notifications.info(t(key, data));
export const error = (key, data) => ui.notifications.error(t(key, data));
