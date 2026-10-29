# Changelog

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
