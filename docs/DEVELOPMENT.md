# Development

Planar Homebrew is our campaign's homebrew rules as one module (campaign-specific by design; see the README). No build step: Foundry loads `scripts/main.mjs` directly.

## File map

```
scripts/main.mjs              hooks only: settings, menus, keybinding, token-control buttons, Token HUD buttons, live redraw, api on ready
scripts/i18n.mjs              t() for this user's language, tw() for chat everyone reads, fail() for localized errors
scripts/util.mjs              pure helpers: dictionary lookup, placeholders, language choice, supported dnd5e range
scripts/core/                 pure rule logic, no Foundry globals (unit-tested)
  constants.mjs               ids, rule ids, defaults, companion states
  registry.mjs                the rule registry
  companion-helpers.mjs       slots to pay with, slot snapshots, placement geometry, request shape
  validation.mjs              resonance / companion config validation, nearest free square
  state.mjs                   companion state machine
  death-math.mjs              2024 death save math, formula, natural d20
  light-presets.mjs           light profiles, item-name recognition, fuel and burn-time math, token light data
  token-lights.mjs            token light presets (from the v3 light macro), switchboard rules (toggle, soften)
scripts/rules/                Foundry-side rule code
  resonance.mjs               dnd5e damage hooks: chain inside the evaluated DamageRoll, or a separate exploding-die card (macro way)
  vestige.mjs                 Bound Companion lifecycle, paying for Manifest, GM query (CONFIG.queries), adoption, combat sync
  token-lights.mjs            apply a preset to a token; GM scene switchboard (reads the old macro's world flags too)
  light.mjs                   ignite / put out / hood / refuel, world-time burn, Utility activity hook
  death-saves.mjs             GM-only ledger journal, secret rolls, sheet-counter guard, hand-off to Planar Glitch
scripts/ui/                   ApplicationV2 windows (EN/ΕΛ button in each)
  manager.mjs                 GM manager (bind dialog); companion window (cards, actions, light, sheet)
  light-ui.mjs                light section of the manager; light window: Carried items · Token lights · Scene lights (GM)
styles/planar-homebrew.css
lang/en.json lang/el.json     identical keys (tests check); chat lines use the world's "textLanguage"
tests/                        node:test; setup.mjs installs the dictionaries before every file
tools/                        check-syntax, stamp-manifest, package, release-api (copied from planar-theater)
```

**Data.** Item flag `planar-homebrew.resonance` (weapon); actor flags `planar-homebrew.vestige` (summoner binding and state) and `planar-homebrew.companionCommand`; token flags `planar-homebrew.summonerUuid`, `planar-homebrew.activePortableLight`, `planar-homebrew.tokenLight` (last preset), `planar-homebrew.lightSwitch` (switched off: saved light / hidden), `planar-homebrew.lightLook` (look before softening; ambient lights carry the last two as well); item flag `planar-homebrew.portableLight` (`{config, state}`); the death save ledger is the flag `deathLedger` (`{records, configs}`) on a GM-only JournalEntry marked `deathLedgerStore`. World settings: `deathSavesEnabled`, `deathSavesAuto`, `deathSavesNPCs`, `companionApproval`, `textLanguage`, `debug`; client setting `language`. 0.8.0 added binding fields `costMode` / `grantOwnership` and resonance `mode`; old records read them from their defaults or old fields (`companionCostMode`), so no migration.

**Other modules.** Planar Glitch through `game.modules.get("planar-glitch").api.recordDeath(actor, {cause, source: "saves"})` only (dev guide § 3: APIs, never its settings or flags).

## Checks

`npm test` = syntax check of every `.mjs`, then node:test with `--import ./tests/setup.mjs`. It covers the pure helpers, the rules against mocked documents (damage pipeline, companion lifecycle and GM approval, lights, death saves and the Glitch hand-off), the manifest, language parity, every key used in the code, a link test of `main.mjs` with stubbed globals, and the release tools. It does not start Foundry: the checklist below is tried by hand.

When you add a feature: pure logic in `scripts/core/` with a test, Foundry code in `scripts/rules/` or `scripts/ui/`, every string in **both** language files, a line in the checklist below.

## Manual test checklist (copy of the world, one GM + one player browser)

**Install and language**
- [ ] Install from the manifest URL, enable, reload: no console errors; three buttons in Token controls (player sees *Portable lights*, and *Bound companions* only with a companion).
- [ ] EN/ΕΛ button switches the window language for that user only; the world setting *Chat language* sets the chat lines.

**Silver Eagle Resonance** (Lothrik's Silver Eagle Greatsword)
- [ ] Assign to the sword's Attack activity; reload; assignment still there.
- [ ] Several damage rolls: matching and non-matching first dice; the chat line's numbers add up to the total.
- [ ] Critical hit: the weapon's own dice are not doubled; a Divine Smite's dice still are.
- [ ] Graze alone doesn't chain. Apply damage once and check resistances on the target.
- [ ] *How the chain is rolled: separate card*: matching dice post a second damage card "chaining dice (4, 4)" with `1d6x=4`; a crit doesn't double the sword's dice; apply both cards.
- [ ] **Great Weapon Fighting**: note whether a 1 or 2 shows as 3 before the doubles check (house rule R2 says check the doubles *before* GWF; see the Implementation status).

**Bound Companion** (Marigia's vestige)
- [ ] Bind Marigia → her vestige with the defaults (one slot, Vestige Companion HP, Spectral Aura): one dialog; the player gets OWNER of the vestige actor. Bind while the vestige already stands on the map: adopted as manifested.
- [ ] Player browser: companion window (dragon button, or right-click Marigia's token) → Manifest → pick the Pact slot → the vestige appears next to Marigia with the violet aura; the Pact slot went down by one; no GM dialog.
- [ ] Manifest again while manifested: blocked, no second slot. No slot left: clear message, nothing placed.
- [ ] Player: the vestige's action buttons (Vestige's Strike…) roll from the companion window; *Sheet* opens its sheet; the light menu changes its token light.
- [ ] Hurt it, Recall, change scene, Return: same HP, no slot. Recall/Return in combat: blocked unless the binding allows it. Command twice in a round: second blocked.
- [ ] 0 HP: marked destroyed, token removed; next Manifest spends one slot and restores full HP.
- [ ] *Hit points: Vestige Companion*: at Warlock 4 the vestige comes out with 20/20 HP; drop it to 0, Manifest again: back at 20/20, one slot spent.
- [ ] Marigia dies (Planar Glitch records it, or the Dead status): the vestige's token disappears, a chat line says it fades, the state is dismissed.
- [ ] Setting *GM approves companion actions* on: the GM gets a dialog naming the player; declining gives the slot back.
- [ ] Player controls off, or GM disconnected: player requests refused cleanly.

**Portable Light Source**
- [ ] *Profile every recognised light*; a player lights a torch from the light window (one ignition spent), puts it out (none spent), relights.
- [ ] Utility activity of a torch lights it; attacking with it doesn't.
- [ ] Advance world time past 1 hour: the torch goes out on the GM's client. Oil lamp refill uses one oil item. Torch stack replacement lowers the quantity.
- [ ] Hooded lantern: lower / raise hood. Metric scene: radii converted.
- [ ] *Token lights* tab as a player: pick the vestige's token, Spectral Aura → violet ghost light; Torch on the hero; Vivid looks stronger, same radius; *Turn off*. Right-click a token → light bulb opens the tab with that token picked.
- [ ] A lit carried torch, then a Token light preset on the same token: the torch is put out first (its ignitions untouched).
- [ ] *Scene lights* tab (GM): turn off the selected lights; restore; toggle; soften and restore look; "all" asks first and doesn't reveal hand-hidden ambient lights. A light switched off by the old macro comes back with *Turn on / restore*.
- [ ] A player can't relight a token the GM switched off (message), until the GM restores it.

**Blind Death Saves**
- [ ] Drop a hero to 0 HP in combat: on their turn a blind roll is whispered to the GM only; the player's sheet shows no successes/failures; the sheet's death save button does nothing (GM gets a hint).
- [ ] Second browser as the player: the secret journal is not listed and its tally can't be read.
- [ ] Damage at 0 HP: if dnd5e marks a failure, it moves into the secret tally (not the sheet).
- [ ] Three failures: Planar Glitch records the death (body, Wheel) and the chat says the hero died, in Greek. Without Glitch: just *Dead*.
- [ ] Natural 20: back with 1 HP, tally reset. Three successes: *Stable*.
