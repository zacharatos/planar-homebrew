# Changelog

## [0.9.0] — 2026-10-30

From the 0.8.0 test at the table.

- **Players light only what they carry.** Token light presets (the *Token lights* tab, the companion card's light menu, the Token HUD light bulb) are GM-only now; players see just their carried items and light spells in the light window. The GM decides what light each item or spell gives (*Manager → Lights → Edit*: any profile, e.g. Lothrik's torch as a Spectral Aura). New item profile *Moonlit glow*.
- **Light spells:** *Light*, *Continual Flame*, *Produce Flame* and *Daylight* on a sheet are recognised like torches (or the GM sets any spell up). Casting the spell lights the caster's token (hurling Produce Flame doesn't); in the light window the spell has **Cast** (through dnd5e: slot, chat card) and **End**.
- **Fixed: the manager's light buttons did nothing** (Set up a light, Profile every recognised light, Edit, Reset, Repair, Remove). They carried a different data attribute than the one the manager listened for, so no click reached the code and no error showed.
- **Refill oil** finds the actor's *Oil* by itself when none was set up (and remembers it).
- **Companion: the player chooses the spot.** Manifest and Return ask the player to click a square near the hero (right-click or Esc cancels; an out-of-range or taken square says why and waits for another click). The module's windows step aside while picking.
- **Companion: casting the bound spell manifests it.** With a spell bound (Manifest Vestige), casting it from the sheet, a hotbar or the companion window's Manifest button brings the companion out, then the player picks the spot. The cast is refused before any slot is spent when the companion is already out or the hero has no token on the scene. dnd5e's own Summon is skipped for that activity, so a Summon activity can be bound now. If the placement is cancelled or fails, the casting is kept: **Place (already cast)** in the companion window finishes it without a new slot. Without a bound spell, Manifest spends one slot as in 0.8.0. In the bind dialog the spell is chosen up front; choosing one means "manifest by casting it".
- **Toolbar:** the module's buttons moved out of the Tokens column into their own **Planar Homebrew** group of the scene controls (a submenu like Tokens): Manager and Scene lights (GM), Portable lights, Bound companions. Opening the group keeps token selection working. World setting *Own toolbar group* (on) puts them back under Tokens when off.
- Action buttons sit side by side instead of one per line. The scene switchboard names token lights ("Token: Marigia") instead of "Token".
- Stored data: binding field `paidPending` (a casting not yet placed). No migration needed.

## [0.8.0] — 2026-10-30

Fixes from the first live test on our Foundry 14 server, and Timos's tested macros brought into the module.

- **Lights for any token (new tab *Token lights*):** the *Player & GM Light Controller* macro (v3) as part of the light window. Any token a user owns (a hero, Marigia's vestige, a familiar) gets a ready-made light: Candle, Torch, Oil Lamp, Hooded Lantern open / shut, Bullseye Lantern (60° cone), *Light*, *Continual Flame*, *Produce Flame*, *Daylight*, Spectral Aura, Spectral Beacon, Moonlit Glow, or no light; with a Gentle / Balanced / Vivid look (the radii never change). It spends nothing. A burning carried item on that token is put out first. The menus are grouped (lamps and torches · spells · spectral · none).
- **Scene lights (new GM tab):** the macro's switchboard for every ambient light and token light of the scene: turn off (keeps the original), turn on / restore, toggle each, soften the look, restore the original look; for the lights selected on the map, the ticked ones, or all (with a confirmation). Magical darkness and Global Illumination are never touched; "all" never reveals an ambient light that was hidden by hand. Lights switched off or softened by the old macro (its `world` flags) are restored too.
- **Token HUD:** right-click a token → a light-bulb button opens the light window on that token; on a hero with a bound companion (or the companion itself) a dragon button opens the companion window.
- **Bound Companion reworked (Marigia couldn't manifest, recall or dismiss):**
  - Manifest no longer asks for X/Y coordinates: the token appears on the nearest free square next to the hero, and the player drags it.
  - New **cost** setting: *Spend one spell slot* (default for new bindings; the player picks the slot, Pact Magic first, and the module spends it; if the token can't be placed the slot is given back), *Cast a spell from the sheet* (the old way; no longer refuses when it can't see exactly one slot change, it warns), or *Free*. Bindings from 0.7.0 keep what they had (a chosen spell → *Cast a spell*; "no slot" → *Free*).
  - Player requests (Manifest, Return, Recall, Dismiss) run on the GM's client **without a GM dialog**: the binding is the permission. The GM checks that the requesting user owns the hero. New world setting **GM approves companion actions** (off) brings the confirmation back.
  - **Binding is simpler:** one short dialog (companion, cost, hit points, light, "the hero's players own the companion"), the rest under *More options*. Companions are listed NPCs first. A companion already standing on the map is **adopted** instead of refused, and the hero's players get OWNER of the companion actor (so they can move it and use its actions).
  - The companion's light can be any token light preset (Spectral Aura by default), placed with the full light settings (colour, animation) and converted for metric scenes.
  - A new casting always brings the companion back at full HP (also in "own HP" mode), so a 0 HP companion no longer blocks Manifest.
  - **Companion window** is now a card per companion: portrait, HP, state, scene, the actions, a light menu for its token, its **sheet**, and its **actions as buttons** (Vestige's Strike and its other weapons, features and spells) while it is manifested. Warnings no longer hide the buttons.
  - Repair also adopts a companion token placed by hand.
- **Silver Eagle Resonance:** new per-weapon setting *How the chain is rolled*: inside the weapon's damage roll (as before) or as a **separate damage card**, the tested *Silver Eagle Great Sword* macro's way (crit doubling off for this attack, `1d6x=N` exploding chain as its own native damage card). When the inline way can't run (unusual roll, untested version, error), the separate card is rolled instead of nothing. Fixed: a failure inside the hook threw a second error instead of warning.
- API: `openLights({tab, tokenId})`, `applyTokenLight(tokenDoc, preset, {strength})`, `switchLights(sources, action, {scope})`, `sceneLightSources(scene)`, `lightPresets()`; `performCompanionAction(actor, action, {point, slotKey})`.
- Stored data: bindings gain `costMode` and `grantOwnership` (read from the old fields when missing; no migration needed). Resonance assignments gain `mode` (default `inline`). New token flags `lightSwitch`, `lightLook`, `tokenLight`.

## [0.7.0] — 2026-10-29

- **Planar Glitch:** a hero who dies on Blind Death Saves is handed to Planar Glitch through its API (`recordDeath`, source *saves*) before the *Dead* status is set. Glitch's own "third failed save" detection can't see secret failures. The status used is Foundry's DEFEATED status (dnd5e: `dead`). `planar-glitch` is listed under `recommends`.
- **Blind Death Saves:** a death save failure written on the sheet (dnd5e's damage-at-0-HP failure, the GM clicking the pips) is moved into the secret tally on the primary GM's client instead of being dropped.
- **Greek and English:** every string moved to `lang/en.json` and the new `lang/el.json`; each user can switch with the EN/ΕΛ button (client setting *Module language*); chat lines everyone reads use the new world setting *Chat language* (Greek by default).
- **Token-controls buttons:** Planar Homebrew (GM), Portable lights (everyone), Bound companions (owners of a hero with a companion). A keybinding for the manager (unset by default).
- **API:** `game.modules.get("planar-homebrew").api` (`open`, `openLights`, `openStatus`, `addPrivateDeathFailure` added); `game.planarHomebrew` still works.
- Resonance now runs on any dnd5e 6.0.x, not only 6.0.5 (it still stays off outside Foundry 14 / dnd5e 6.0.x).
- Repo brought in line with the other Planar modules: `.mjs` files, `AGENTS.md` / `CLAUDE.md` / copilot instructions, `tools/` (syntax check, manifest stamping, packaging, release API), CI and release workflows that build `module.zip` + `module.json` from the tag, `docs/DEVELOPMENT.md` with the manual checklist, `docs/PUBLISHING.md`, manifest and language tests, a link test of `main.mjs`. Stylesheet renamed `styles/planar-homebrew.css`.
- **Bound Companion, for Marigia's vestige (Manifest Vestige):** a binding can use *Vestige Companion* hit points (4 + 4 × Warlock level, full on every manifestation, so a vestige that dropped to 0 HP comes back with the next casting), and a companion **vanishes when its hero dies** (Planar Glitch's death hook or the Dead status; on by default, per binding).
- Stored data: two new binding fields (`hpMode`, default `keep`; `vanishOnDeath`, default on). Old bindings read them with their defaults; no migration needed.

## [0.6.0] — 2026-10-29

- Added a fourth reusable rule, **Blind Death Saves**, to the one-module GM manager.
- New private GM-restricted Journal ledger for death successes, failures, resolved outcomes, per-Actor configuration, and per-turn deduplication.
- GM-only automatic combat-turn rolls (one per downed Actor turn) or manual Secret Roll; native character death-save button prevented while enabled.
- Optional per-character modifier, advantage, and auto-roll; standard natural 1 / natural 20 / stabilization / death logic.
- Final state announcements only; private intermediate chat rolls whispered to GMs.
- GM can apply private damage-at-0 failures (+1 or +2), reset tallies and clear preexisting player-visible counters.
- The death-save hook and actor-update sanitization are tested in simulated clients. Live Foundry V14+ D&D5e 6.0.5 and multiplayer privacy still unverified.



## [0.5.0] — 2026-10-29

- Added **Portable Light Source** as the third rule in the same Planar Homebrew module.
- Item-specific preset lighting with feet-to-meters conversion, configurable glow/animation/angle and shuttered hooded lanterns.
- GM bulk-assign recognized inventory light items or configure any inventory Item individually. Player Light Controller and native D&D 5e Utility Activity ignition hook.
- Persistent per-item ignition counts (homebrew: torch/candle 5, oil lamp/lantern 10) and official-style burn-time budgets (torch/candle 1h, oil 6h); Foundry world time consumption.
- Refills consume one configured Oil inventory Item; stacked replacement torches/candles reduce Item quantity. GM override/repair controls.
- Token lighting backup/restore guards, ownership checks, locally serialized actions, and rollback attempts.
- Added pure and simulated-document tests. Live Foundry V14 verification is still required.

## [0.4.0] — 2026-10-29

- Added reusable **Bound Companion** (familiar / vestige / construct / other world Actor) configuration and lifecycle to the existing Planar Homebrew module.
- Native D&D 5e spell Activity casting with observed post-consumption hook and strict exactly-one-slot verification. Free/no-slot mode is explicit and configurable.
- Added player Companion Controller, selected X/Y placement, configurable command cost, outside-combat Recall/Return, linked Actor persistence, spectral glow, and chat announcements.
- Added GM authorization via Foundry V14 targeted queries, pre-cast reservations, per-binding locks, duplicate-token protection, and GM-side slot-difference verification.
- Added automatic 0 HP destruction monitoring, reconnection reconciliation, command-per-round tracking, combat initiative synchronization, and GM stale-state repair.
- Added 23 companion helper and lifecycle/GM-query mock tests, bringing the local suite to 60 tests. No real Foundry integration tests have been performed.
- Important: querying GM cannot authenticate requester identity; all privileged player requests require explicit GM approval. Native spell casting and token creation cannot be rolled back atomically.

## [0.3.0] — 2026-10-28

- Implemented Silver Eagle Resonance automation for evaluated native weapon-damage rolls.
- Added activity-specific assignment, critical handling, Graze skip, chat breakdown, and test coverage.

## [0.2.0] — 2026-10-28

- Single Planar Homebrew module, GM manager, companion binding preview, and first rule assignments.
