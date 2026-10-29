// Loaded before every test file (npm test: --import ./tests/setup.mjs): installs the English
// dictionary so error and chat text in tests reads as it does in Foundry with English selected.
import { readFileSync } from "node:fs";
import { setDictionary } from "../scripts/i18n.mjs";

for (const lang of ["en", "el"]) setDictionary(lang, JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), "utf8")));
