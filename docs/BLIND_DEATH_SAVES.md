# Blind Death Saves — mechanics and integration checklist (v0.6.0)

This is the fourth rule in **one module**, `planar-homebrew`, not a separate add-on. It is targeted to **Foundry V14 + official dnd5e 6.0.5**. The implementation was locally mocked; it has **not** been verified in a running Foundry world.

## Philosophy and privacy model

- Players see only the character's unconscious/dying state and final stabilization, death or natural-20 revival; the GM sees each private roll, natural value, and confidential successes/failures.
- Intermediate progress is stored in the flags of a **restricted world JournalEntry** named `Planar Homebrew — GM Secret Death Saves`, with `ownership.default = 0`. It is not stored on the Actor. Do not grant player users permissions to that Journal.
- All clients block the native `dnd5e.preRollDeathSave` workflow for character Actors when the global rule is enabled, including the sheet's normal death-save button. Player-side writes to `system.attributes.death.success` / `.failure` are removed from pending Actor updates except zeros; this also blocks native death-save counter automation, intentionally.
- The first active GM according to stable user ID ordering is the only GM permitted to trigger rolls; other GMs see the confidential result messages and can configure/review the state but cannot produce duplicate saves. No socket endpoint lets a player request arbitrary GM rolls.
- Final stabilization/death/revival is deliberately public. On completion, the module attempts the matching Foundry Actor status effect; when unavailable the GM needs to apply it manually.

## Configuration and usage

1. Enable **Blind Death Saves enabled** in World Module Settings. **Automatically roll on downed character turns** is enabled by default. For NPCs, additionally enable **Blind death saves for NPCs**.
2. Open **Planar Homebrew Manager → Death Saves (GM)**. The interface is restricted to a GM. Each character shows eligibility, private tally and result.
3. Choose **Configure** to adjust per-Actor enabled state, auto-roll, static save modifier (–30 through +30) and normal/advantage/disadvantage.
4. Use **Clear visible counters** on any character with nonzero native counters from before installation; do this before a player looks at the sheet.
5. On a downed character's combat turn, the **primary active GM** automatically rolls. The private GM chat message includes actual die and tally. The module prevents rerolling the same combatant's same turn. Alternatively press **Secret Roll** to roll manually (global/per-Actor auto-roll settings can disable turn automation).
6. If the character takes damage at 0 HP and dnd5e (or the GM, on the main GM client) writes a failure on the sheet, it is moved into the secret tally (at most +2 per update). Otherwise press **+1 failure** or **+2 failures (critical)**, without announcing which.
7. On the third failure the hero is handed to **Planar Glitch** (`api.recordDeath(actor, {source: "saves"})`) before the *Dead* status is set, so Glitch's body / Wheel / glitch flow runs as for any death.
7. Use **Reset tally** to correct errors or after a nonstandard rescue that doesn't involve regaining HP. Positive HP recovery normally clears the private tally while a GM is connected.

## Deterministic death-save calculation

- `d20 + configured static modifier` reaches DC 10 => success. Normal 1–9 => failure. Natural 1 gives two failures independent of total. Natural 20 restores 1 HP independent of total. Advantage/disadvantage uses `2d20kh`/`2d20kl`, testing the kept die as the natural result.
- 3 successes => Stable; 3 failures => Dead; a recovered Actor at positive HP resets the secret tally.
- Normal D&D 5e saving throw modifiers/Active Effects (Bless, special features, rerolls, bonuses from other modules) are **not automatically incorporated**. Configure a static modifier/advantage on the GM screen as needed; the GM can choose manual rolling when special mechanics require adjudication.

## Threats, limitations, and migration

1. **Permission leak:** players must never have observer/owner permission to the GM Journal. Verify with an actual separate player account (not by using only the GM client). Journal availability and backend permission behavior have not been live-tested.
2. **Public counters:** preexisting nonzero native death counters on Actors remain readable until the GM presses **Clear visible counters**; there is no way to retroactively hide information already seen.
3. **Competing modules:** other death-save automation systems or nonstandard sheets may bypass the canceled native death-save hook, update Actor fields outside the guard, or make visible chat rolls. Disable competing modules and test thoroughly.
4. **GM presence:** no primary active GM means no automatic roll; this is deliberate rather than trusting a player client with secret dice. Multiple connected GM clients must coordinate around a single primary GM.
5. **Turn rewind:** the private ledger remembers the last combat turn processed to prevent immediate duplicate clicks. It cannot guarantee distributed atomicity across concurrent GM/database clients or recover pending server transactions after a crash.
6. **Status integration:** standard `stable` and `dead` Foundry status IDs are attempted if available. Other automation modules could override those states. Failures written on the sheet by other code are converted into private failures only when the update comes from the primary GM's client.
7. **Actor copies:** embedded token Actors and new Actor copies have distinct UUIDs; when an Actor is duplicated, it starts with separate private progress rather than sharing the original journal entry.
8. **Enabling/disabling:** disabling the world setting restores standard D&D saves, which expose native counters. Setting only an individual Actor's enabled flag to false stops secret rolls but keeps the native button blocked while the global rule is on, as a privacy failsafe.
9. **Actor healing:** the system's ordinary HP recovery and death-saves reset interactions are left intact except for blocking nonzero public counters. HP recovery triggers a GM-side journal reset when the update is observed.

## Live test plan (not yet executed)

- Two clients: one GM and one player who owns the target character. With the character at 0 HP, confirm native sheet Death Saves cannot create a public roll, and confirm the player's Actor document still shows 0/0 successes/failures.
- Advance combat to the character's turn. Confirm precisely one GM-secret chat message. Refresh both browsers; verify GM tally persists and player cannot inspect it, including via Journal sidebar, Actor sheet, chat and console.
- Perform a second turn, natural 1, natural 20, success stabilization and failure death using GM rolls. Check end-status indicators and HP behavior.
- Test damage at 0 HP (automatic, if dnd5e marks a failure) and the **+1 / +2 failures** buttons. Confirm no interim reveal and no duplicate end messages.
- Heal to 1 HP and verify confidential progress resets without revealing previous saves. Re-drop to 0 HP and verify a fresh tally.
- Turn back combat and forward, relog, restart Foundry server, open new scenes, temporarily disconnect/reconnect GM, and test with other modules disabled and re-enabled separately.

References: [official D&D 5e hooks](https://github.com/foundryvtt/dnd5e/wiki/Hooks), [Foundry V14 API](https://foundryvtt.com/api/v14/).
