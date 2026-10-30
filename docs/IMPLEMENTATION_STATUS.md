# Implementation status: Planar Homebrew 0.7.0

## Available in the module

**Silver Eagle Resonance:** assigned to weapon and optional Attack activity; pure roll calculations and guarded native `dnd5e.rollDamage` integration; custom critical handling for supported roll shapes; chat breakdown; Graze-only suppression. This was completed in v0.3.0 and remains **live unverified**.

**Bound Companion (0.8.0):** GM binds any existing world companion Actor to any world summoner Actor in one dialog (a companion already on the map is adopted; the hero's players can be given OWNER). Manifest is paid on the caller's client: one spell slot the player picks (module lowers it, refunds if placement fails), a native spell Activity (warns if no slot change is seen), or free. The token is placed on the nearest free square next to the hero by the GM's client, with the binding's token light. Companion window: Manifest, Recall, Return, Dismiss, Command (Destroy is GM-only), the companion's sheet, its item actions as buttons, its token light. HP and resources persist on the world Actor; a new casting restores full HP.

**Player security:** native owner check on the summoner on the caller's side; the active GM's query handler checks that the user id sent with the request owns the summoner and that the action is one of manifest/return/recall/dismiss for the bound Actor only. Foundry's query does not authenticate the sender, so a player could in principle send another user's id: acceptable at our table; the world setting `companionApproval` makes the GM confirm each request. No arbitrary document update, no open socket proxy.

**Robustness:** duplicate source Actor token detection, pending operation locks, manual token deletion detection, 0 HP monitor and GM reconnection reconciliation, status errors and narrow missing-token repair.

**Portable Light Source:** configurable Item-specific light emission (color, alpha, luminosity, animation, direction), manual player light toggle, automatic ignition by `dnd5e.postUseActivity` for Utility activities, Item flag persistence, world-time accounting, hooded lantern shutter, oil refills and torch stack replacement. Presets match prior campaign lighting macro radii, with configurable visual softness. GM can bulk assign known equipment profiles or configure any owned inventory Item. Preserves token backup light and avoids overwriting unrelated third-party modifications.

**Portable light security:** only owned Actors and tokens may be modified by players; GM-only assignment/edit/repair/reset; no privileged socket commands. Per-client local action lock prevents duplicate rapid clicks but cannot ensure multi-client atomicity.

**Blind Death Saves:** assigned globally to PCs by default, optionally NPCs; private per-Actor configuration and progress in a GM-owned Journal. Primary active GM rolls at combat turn start (or via manual GM button). Native `dnd5e.preRollDeathSave` attempts are canceled and public death-success/failure changes are rejected except zero resets. Confidential GM chat dice, natural 1 / natural 20 / regular success and failure accumulation, stabilization/death announcement, secret failures from 0 HP damage (buttons, or moved from the sheet automatically), and the hand-off of a death to Planar Glitch. Private ledger survives reload and ordinary restart. Existing visible counters must be explicitly cleared; GM-only journal privacy requires live multiplayer verification.

## Limitations and unverified behavior

- No running Foundry V14 + official D&D 5e 6.0.5 world was available. APIs were cross-checked against published hooks/docs but the exact live consumption and token lifecycle remain unverified.
- *Cast a spell* cost: the module checks the slot change only to warn; *Spend one spell slot* lowers `system.spells.pact|spellN.value` directly and is the default.
- Native spell cast and linked-token creation are not one server transaction. Successful casting followed by failed placement cannot be automatically refunded safely. A GM must resolve such a case manually.
- Placement is automatic (nearest free square within range of the hero's token); players drag the token afterwards. A `point` can be passed through the API.
- Command is announced and tracked once per combat round; it does not automatically execute Help/Dodge/Attack actions or deduct D&D action economy resources. Independent Dodge remains a table rule.
- GM authorization requires a connected active GM. No unsafe proxy user-id trust or broad Actor-creation permissions are used.
- Linked token collision is basic 2D axis-aligned rectangle overlap; terrain, height, walls, line-of-sight, difficult terrain, and gridless/special grids are not modeled.
- Companion Actor ownership must be set manually, as expected for normal Foundry permission management.
- Combat initiative and chat behavior need real in-world verification. Other automation modules (Midi-QOL, Ready Set Roll, etc.) have not been tested.

## Testing

`npm test` — expanded local deterministic tests, including pure calculations, damage-pipeline mocks, companion transitions, slot deltas, simulated document lifecycle, and GM-query approval flows. This is **not** Foundry integration verification. See `docs/TEST_REPORT.md`.

- Portable Light time expiration depends on Foundry world-time changes and an active connected GM to perform auto-extinguish; the stored fuel state also reconciles on regular use and status rendering.
- Portable-light automatic use hook is restricted to Utility Activities; attacks with a torch are excluded. Other system item-usage patterns need live verification.
- Oil refills are configured per Actor Item; no attempt to auto-find or grant consumables.

- Blind Death Saves rolling is *not* the native system death save workflow. Its GM-only 1d20 uses a GM-configured static modifier/advantage, so system Active Effects, situational bonuses, Bless and other external roll integrations are **not automatically imported**.
- Blind Death Saves auto-roll runs from the `updateCombat` hook only with a connected primary GM and on turn changes; rolling outside combat is manual. Damage at 0 HP is recorded when a failure reaches `preUpdateActor` on the primary GM's client; whether dnd5e 6.0.x writes one on damage still needs checking at the table. Native `dnd5e.preRollDeathSave` cancellation and `preUpdateActor` sanitization need in-world verification.
- Secret ledger is stored on a GM-only JournalEntry. Never grant players permission to the private journal. Custom modules that bypass the native death-save workflow can leak information; run a real second-browser player privacy test.

## Open points to check at the table (0.7.0)

- **Silver Eagle Resonance and Great Weapon Fighting (house rule R2).** The default ruling is "doubles are checked *before* GWF". The code reads the die results as dnd5e leaves them; if dnd5e applies GWF as a minimum (1–2 shown as 3) inside the same term, the doubles check happens *after* GWF. Check one roll with GWF in a test world (the chat line shows the first two dice): if a 1 or 2 ever appears as 3, the module needs to read the original result. Not changed in code until Timos confirms the ruling and the behaviour.
- **Secret ledger privacy.** Foundry sends world documents to every client; ownership "None" hides the journal in the UI, but a player with the browser console can read its flags. Good enough for the table; not a security boundary.
- **Planar Glitch hand-off** relies on Glitch's `recordDeath` being idempotent (it is, per open record), so the *Dead* status set right after doesn't record a second death.

