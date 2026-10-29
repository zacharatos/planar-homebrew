import { test } from "node:test";
import assert from "node:assert/strict";
import { lookup, fill, pickLanguage, isSupportedSystemVersion } from "../scripts/util.mjs";
import { tIn } from "../scripts/i18n.mjs";

test("lookup reads nested keys and ignores non-strings", () => {
  const d = { A: { B: "x", C: { D: "y" } } };
  assert.equal(lookup(d, "A.B"), "x");
  assert.equal(lookup(d, "A.C.D"), "y");
  assert.equal(lookup(d, "A.C"), undefined);
  assert.equal(lookup(d, "Z"), undefined);
  assert.equal(lookup(null, "A"), undefined);
});

test("fill replaces known placeholders only", () => {
  assert.equal(fill("{a} and {b}", { a: 1 }), "1 and {b}");
  assert.equal(fill("plain"), "plain");
});

test("language: user choice, then world, then Foundry, then English", () => {
  assert.equal(pickLanguage("en", "el", "el"), "en");
  assert.equal(pickLanguage("", "el", "en"), "el");
  assert.equal(pickLanguage(undefined, undefined, "el"), "el");
  assert.equal(pickLanguage(undefined, undefined, "fr"), "en");
});

test("dnd5e 6.0.x is the supported range for the roll internals", () => {
  assert.ok(isSupportedSystemVersion("6.0.5"));
  assert.ok(isSupportedSystemVersion("6.0.12"));
  assert.ok(!isSupportedSystemVersion("6.1.0"));
  assert.ok(!isSupportedSystemVersion("5.2.4"));
  assert.ok(!isSupportedSystemVersion(undefined));
});

test("Greek and English text come from the dictionaries", () => {
  assert.equal(tIn("en", "Chat.Dead", { name: "Ada" }), "Ada has died.");
  assert.match(tIn("el", "Chat.Dead", { name: "Ada" }), /πέθανε/);
  assert.equal(tIn("en", "No.Such.Key"), "No.Such.Key");
});
