# Planar Homebrew

The homebrew rules of our *Turn of Fortune's Wheel* table, as one Foundry VTT module for dnd5e (2024 rules). **This module is campaign-specific by design**: unlike the other Planar modules, which ship a generic engine plus a private campaign pack, its rules exist for our heroes (Lothrik's Silver Eagle Greatsword, Marigia's vestige, our torches and our death saves). It ships no book text and no DM secrets: the repo is public, so anything a player shouldn't read stays in the campaign vault.

<!-- screenshot: docs/images/manager.webp -->

- **Silver Eagle Resonance**: when the weapon's two damage dice match, it rolls another and keeps going while they match; the weapon's own dice aren't doubled on a critical hit. Inside the normal dnd5e damage roll, or as a separate exploding-die damage card (the tested macro's way, and the fallback).
- **Bound Companion**: any world actor bound to a hero as a familiar or vestige. Manifest spends one slot the player picks (or casts a spell, or is free) and places the token next to the hero; recall, free return, dismiss, command once per round, destroyed at 0 HP. The companion window shows its actions as buttons, its sheet and its light.
- **Portable Light Source**: torches, candles, lamps, lanterns and light spells light the holder's token with their own look, counting ignitions and burn time on Foundry's world clock; hooded lantern shutter, oil refills, new torch from the stack.
- **Token lights and scene lights (GM)**: ready-made lights for any token (the vestige's Spectral Aura, *Light*, *Daylight*, Moonlit Glow…), and a switchboard for every light of the scene (off / on / toggle, soften / restore look). From the *Player & GM Light Controller* macro. Players light only what their heroes carry.
- **Token HUD**: right-click a token: a light button (GM) and, on a hero with a companion or the companion itself, a companion button.
- **Blind Death Saves**: the GM rolls death saves in secret (automatically at a downed hero's turn), the tally lives in a GM-only journal, only the end is announced. A death is handed to **Planar Glitch**, which can't see secret failures by itself.
- Greek and English, per user (EN/ΕΛ button in every window); chat lines everyone reads use the world's chat language (Greek by default).

## Install

In Foundry: **Add-on Modules → Install Module**, paste this **Manifest URL**, then enable *Planar Homebrew* in the world:

```
https://github.com/zacharatos/planar-homebrew/releases/latest/download/module.json
```

Updates come from the same screen when a new release is tagged. Needs Foundry V14 and dnd5e 6.0.x. Works best with Planar Glitch (recommended in the manifest).

**Where to find it:** the **Planar Homebrew** group of the scene controls (left toolbar; a submenu like Tokens): *Planar Homebrew* (GM manager), *Scene lights* (GM), *Portable lights* (everyone) and *Bound companions* (players who own a hero with a companion, and the GM). The world setting *Own toolbar group* off puts them under Tokens instead. The same windows are under **Game Settings → Configure Settings → Planar Homebrew**.

> **Test in a copy of the world first.** Every rule is covered by tests against mocked Foundry documents. 0.7.0 was tried on our live V14 server (2026-10-30); 0.8.0 fixes what failed there (companion actions, lights for tokens other than carried items) and brings in the tested light and sword macros, but has not been played live yet. See [Implementation status](docs/IMPLEMENTATION_STATUS.md) and the manual checklist in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Configure Lothrik's Silver Eagle Greatsword

1. On Lothrik's character sheet, ensure the Silver Eagle Greatsword is a **Weapon Item** with a standard **Attack Activity**. Its base weapon damage must be **2d6 Slashing** plus the normal Strength and magic bonuses. Do not enter the chaining dice as a separate damage part.
2. Open **Planar Homebrew Manager → Weapons → Give resonance to a weapon**.
3. Select **Lothrik Seraphion** (or your world Actor with the desired sword), then select the **Silver Eagle Greatsword** Item.
4. Set **Enabled** to `Enabled`.
5. Under **Attack Activity**, select the sword's specific Attack Activity. The option **All Attack Activities (this weapon only)** can be used if you prefer.
6. Set **Dice faces** to `6`, **Max chaining dice** to `100`, **Damage type** to `Slashing`, and **How the chain is rolled**: *Inside the weapon's damage roll* (one card with the total) or *Separate damage card* (the tested *Silver Eagle Great Sword* macro: the sword's crit doubling is switched off for that attack and matching dice post a second damage card rolling `1d6x=N`; apply both cards). If the inline way can't handle a roll, the separate card is rolled instead.
7. Click **Save**. The flag is stored on *that one owned weapon*, `flags.planar-homebrew.resonance`. Two items with the same name do not share a rule unless both are assigned.
8. Make a test attack through the sword's **normal D&D 5e Attack Activity** and use the standard **Roll Damage** button. No separate macro or button is required.

### What the rule does

- If the **two original d6** results differ, the base damage remains unchanged.
- If they match, it adds **1d6**, then another for every subsequent die which matches that original value, **including the final nonmatching die** in the total.
- Example: `4, 4` initially, then `4, 2` → weapon dice `4 + 4 + 4 + 2 = 14`, plus Strength and weapon bonus **once**. An illustrative `+3` makes **17 Slashing damage**.
- On a critical hit, the weapon's own additional doubled dice are removed from that base roll **only when dnd5e represents them as one 4d6 term**. Resonance then applies normally. Other independently rolled damage parts (such as Radiant Smite) remain untouched.
- Pure Graze damage and damage without the actual 2d6 weapon pool are ignored.
- The automation is performed inside the **existing evaluated damage roll** before it is displayed. It never edits the target's HP and never posts a second separately applicable damage card. Foundry's normal damage-application interface remains responsible for resistances and HP changes.
- The original two die faces and bonus-chain results are displayed on the damage chat message, provided Foundry serializes the roll options as expected.

### Important restrictions

- The hook supports an unambiguous **single 2d6 base term** (or one 4d6 doubled base term on critical), with any additional damage parts distinguishable. If another part makes the weapon dice ambiguous, the module **skips adjustment** and logs a warning. Never assume a skipped roll applied the homebrew rule.
- The module does not adjudicate whether a player should roll damage after a miss. Graze *alone* is ignored; if someone manually triggers the full damage roll after a miss, the module cannot reliably infer that the attack missed.
- Alternative critical rules such as maximized criticals, advanced GWF rerolls, damage-system replacement modules, and manual/external dice resolvers have not been verified.
- In Foundry V14 the evaluated `Roll` is documented as immutable. There is no public mutation API for attaching dice to it in this post-roll hook. The implementation deliberately uses guarded internal fields and rollback; **test in a copied world**, not a session with live players.
- `Dice So Nice` may not animate the bonus dice, because they are resolved synchronously in the roll hook. They should appear in the resulting damage-roll terms if native serialization succeeds.

## Apply Resonance to another weapon

Repeat **Give resonance to a weapon** with a different character, weapon Item, and Attack Activity. No code changes are needed. You can later **Edit**, disable, or **Remove** each assignment separately. The manager is GM-only; players use the normal weapon activity.

## Bound Companion — familiar, vestige, construct or other world Actor

This is **the same Planar Homebrew module**, not a second package. You can bind **any existing world Actor** to another world Actor (saved as Actor UUIDs, so names don't matter).

### Bind Marigia's vestige (or any other companion)

> **At our table (house rule):** Marigia's *Unseen Servant* is renamed **Manifest Vestige**. Casting it spends a slot and brings out the vestige with the Arcana Unleashed *Vestige Companion* stats; it stays until it drops to 0 HP or she dismisses it. The defaults below are exactly that rule.

1. Create the companion as its own **world Actor** (Actors directory). It can already be on the map: its token is adopted.
2. **Planar Homebrew Manager → Companions → Bind a companion**, choose the hero (Marigia).
3. One dialog: **Companion actor**, **Cost to manifest** (*Spend one spell slot*, default), **Hit points** (*Vestige Companion: 4 + 4 × Warlock level*, default), **Light** (*Spectral Aura*, default; any token light), **The hero's players own the companion** (Yes: they can move it and use its actions). Range, command cost, recall in combat, player controls, vanish on death and a spell to cast are under *More options*.
4. Save.

### Using it (player or GM)

Open **Bound companions** from the Token controls, or right-click the hero's (or the companion's) token → the dragon button. Each companion is a card:

- **Manifest**: with a bound spell (Manifest Vestige) it casts that spell (so does casting it from the sheet); without one, pick a slot (Pact Magic first) and the module spends it. Then **click the square** where the companion appears (within range of the hero; right-click or Esc cancels). It comes out with its light, at full HP. A cancelled or failed placement keeps the casting: **Place (already cast)** finishes it for free; a slot spent by the module is given back instead.
- **Recall** removes the token and keeps its HP (*dormant*); **Return** brings it back for free, where the player clicks. By default both are outside combat only (binding option).
- **Dismiss** ends it; the next Manifest needs a new slot. At **0 HP** it is destroyed automatically (GM connected). If the hero dies it vanishes (option, on by default).
- **Command** announces the order in chat and is tracked once per round in combat. Without a command it takes the Dodge action (campaign rule; not automated).
- While it's out: its **actions as buttons** (Vestige's Strike, other weapons, features, spells, rolled through dnd5e as usual) and its **Sheet**. The GM also gets a **light** menu for its token.

**Cost options:** choosing a **spell** in the bind dialog means the companion comes out when that spell is cast (any activity, Summon included: dnd5e's own summoning is skipped for it; the cast is refused before a slot is spent when the companion is already out). Without a spell: *Spend one spell slot* (the module lowers the slot) or *Free*. Bindings made before 0.8.0 keep their behaviour.

**Who does what:** token changes run on the active GM's client. A player's request names the player, and the GM's client checks that this player owns the hero; by default it then just happens, because binding the companion was the GM's decision. Turn on the world setting **GM approves companion actions** to confirm every request by hand. No connected GM: player requests are refused. **Repair** (manager or card) fixes a manifested companion whose token was deleted, a dormant one at 0 HP, and adopts a companion token placed by hand.

## Run the automated tests

From a terminal inside the module source folder (Node 20+):

```bash
npm test
npm run check
```

Tests cover the pure dice algorithm, an isolated Foundry-roll mock, the registered damage hook, critical behavior, independent damage parts, Graze, duplicate hook calls, rollback, companion state/placement geometry, native slot decrement detection, a mocked companion lifecycle (slot / spell / free costs, refunds, adoption, player requests through the GM query), token light presets and the scene switchboard. **These are not tests inside the Foundry application.**

### Suggested first in-world checklist

1. Back up the world, enable the module, and confirm the manager opens.
2. Assign the flag to Lothrik's actual Attack Activity, then reopen the manager and confirm the assignment survived a reload.
3. Make a normal damage roll. Inspect the expanded roll terms and the Resonance line; check the resulting number matches all displayed dice.
4. Trigger several damage rolls to observe both matching and nonmatching dice. Compare final damage with manual calculations.
5. Trigger a critical hit, verify the weapon's base dice are **not doubled**, and check separately rolled Smite damage follows its own critical rule.
6. Roll a Graze-only miss and verify it doesn't chain.
7. Apply damage once to a sacrificial target and check HP/resistance calculations; test with other damage modules **disabled** first.
8. If a roll warns of unsupported/ambiguous shape, disable this assignment before live play and check the JavaScript diagnostics.

## Portable Light Source — per-Item lighting and fuel tracking (new in v0.5.0)

This is a **third rule in the same module**, sharing the same GM Manager and Foundry installation. It reuses the preset radii of our Player Light Source macro, and lets each *specific Item* have its own color, animation, intensity, cone and fuel limits. It does **not** modify an Actor's darkvision, senses or unrelated item data. A character may hold several eligible lights but only one portable light is applied to a given token at once.

### GM: enable default lights across existing Actors

1. Open **Game Settings → Configure Settings → Module Settings → Planar Homebrew Manager → Open the manager**.
2. Open the **Lights** section, then choose **Profile every recognised light**. This scans the inventories of all **world Actors** for recognized torch, candle, lamp, hooded lantern, and bullseye lantern names. Existing custom assignments are left untouched.
3. For a custom light Item or any item that was not recognized, choose **Set up a light**, select the Actor and the inventory Item. This can be an Equipment, Loot, Consumable, Tool, or another Item type; it does not depend on its name.
4. Choose a preset, then configure **Bright radius** and **Total dim radius** (feet), color, alpha, luminosity, angle, animation type/speed/intensity, fuel mode, max ignitions, total burn duration (seconds), and optionally a specific **Utility Activity**.
5. For an oil lamp/lantern, select **Oil inventory Item** from the same Actor's inventory. Refilling consumes **one** unit from that item's `system.quantity`. There is no hidden oil creation. This is optional for magical/permanent lights, which can have no fuel tracking.
6. Save. You can subsequently **Edit**, **Reset** (GM override of fuel/charges), **Repair** a stale link, or **Remove** the assignment. To turn off an otherwise recognized item permanently, **Edit → Enabled: Disabled**; removing its custom assignment permits the name-based default again.

**Light spells.** *Light*, *Continual Flame*, *Produce Flame* and *Daylight* are recognised on a sheet (or set any spell up with *Set up a light*). Casting the spell lights the caster's token (attacks such as hurling Produce Flame don't); the light window shows the spell with **Cast** and **End**. Spell lights have no ignitions or burn time: the GM or player ends them.

Newly acquired items with recognizable names are detected on the first use, even if not included in the initial bulk assignment. Nonstandard magical items require an explicit GM assignment; no arbitrary weapon or item is modified merely because its name resembles a spell.

### Player: ignite, extinguish or refill

1. Select your owned token in the canvas (if you have just one token of that Actor in this scene, the controller can identify it automatically).
2. Open **Game Settings → Configure Settings → Module Settings → Portable lights → Open the light window**.
3. Find your Torch/Lamp/Lantern and press **Light**. The module updates the token's actual Foundry lighting and spends **one ignition**. Press **Extinguish** to turn it off **without spending** another ignition.
4. Alternatively, if that Item has a D&D 5e **Utility Activity**, use it normally on the Actor sheet: the module listens for `dnd5e.postUseActivity` and turns on the corresponding light automatically. **Attacking with a torch never lights it automatically.** For an item with several Utility Activities, the GM can select the exact lighting Activity in its configuration. Native Activity consumption, if independently configured, is not modified or refunded by this rule.
5. To refill an oil lamp/lantern, select **Refill oil**, which uses one *preconfigured Oil inventory Item*. For a spent stack of torches/candles choose **Replace from stack** (requires at least 2 remaining in its quantity; reduces the quantity by one). An exhausted single torch cannot be relit without receiving more inventory or an explicit GM Reset.
6. For a hooded lantern that is currently lit, choose **Lower hood / Raise hood**; its lowered setting is 0 ft bright / 5 ft total dim. This action costs no extra ignition.

### Default homebrew presets

| Light item | Bright / total dim light | Ignitions per item or oil flask | Maximum burn duration | Distinct appearance |
|---|---|---:|---|---|
| Candle | 5 / 10 ft | 5 | 1 hour | Amber, gentle flame |
| Torch | 20 / 40 ft | 5 | 1 hour | Orange torch flicker |
| Oil lamp | 15 / 45 ft | 10 | 6 hours | Warm golden flame |
| Hooded lantern | 30 / 60 ft | 10 | 6 hours | Golden flame; closeable hood |
| Bullseye lantern | 60 / 120 ft | 10 | 6 hours | Golden 60° cone |
| Magical light | 20 / 40 ft | Unlimited | Unlimited | Soft pale magic |
| Spectral aura | 0 / 15 ft | Unlimited | Unlimited | Violet ghost light |

**Important distinction:** Five ignitions for torches and ten for oil lamps are **homebrew defaults** based on the campaign request; they are not official D&D limits. Official 2024 equipment rules set a one-hour torch/candle burn duration and six hours per flask of oil; remaining burn time can be spread across multiple lightings. The module tracks both remaining ignitions and remaining duration and stops the light if either is exhausted. Time advances only with Foundry's `game.time.worldTime` clock, not real-world wall time. If a GM is connected, advancing that world time automatically extinguishes lights whose time has expired. The active light item stores its state persistently.

The additional macro-inspired presets **Light Cantrip (20/40)**, **Continual Flame (20/40)**, **Produce Flame (10/20)**, **Daylight (60/120)**, **Spectral Aura (0/15)**, and **Spectral Beacon (10/30)** are also available for manually configured Items. They are unlimited by default; any spell duration must still be handled by the game system or configured explicitly. No spellcasting ability is granted by assigning a light profile.

The module preserves a token's previous light settings on ignition and normally restores them on extinction. If a GM or another module changes that token lighting while the item is burning, Planar Homebrew leaves the newer settings intact and reports a warning rather than overwrite them. Light radii are configured in feet and converted to meters for metric scenes (other scene units require manual conversion). Player operations require ownership of both the Actor and the token; no unrestricted GM socket is used.

### Important limitations

- One active portable light per token, not multiple independently burning attached sources. Switching to a new light automatically extinguishes the previous one. Carrying a lit lantern on a different token is disallowed for the same Item instance.
- Auto-recognition covers a limited list of recognizable English equipment names; other light Items need explicit assignment. No background bulk scanning is performed without a GM command.
- The default Utility Activity hook **ignites but does not extinguish** an already-lit item on repeated use (the player controller has explicit Extinguish). This prevents a second native usage from unintentionally toggling it off.
- Burn duration expires when Foundry's game clock advances; a paused or unmoving world clock will not consume time. No full real-time timer or automatic accounting of resting outside the world clock is added.
- Each Actor's inventory Item stores its light charges as a module flag, separate from native dnd5e Activity uses. It does not change native item's own consumable targets; do not configure a second independent consumption rule for the same ignition without checking it.
- Simultaneous writes by two *separate clients* are not a distributed transaction. Test shared-Actor simultaneous usage and enable only one controller at a time for the same Item.
- No live Foundry V14 + D&D 5e 6.0.5 integration test has been performed. Test in a copied world, especially lighting after native Utility Activity use, world clock changes, stacked torch replacement, and oil consumption.

**References:** [2024 D&D equipment rules](https://www.dndbeyond.com/sources/dnd/br-2024/equipment), [D&D 5e v6 Activity hooks](https://github.com/foundryvtt/dnd5e/wiki/Hooks), [Foundry V14 LightData schema](https://foundryvtt.com/api/v14/classes/foundry.data.LightData.html).

## Token lights and scene lights (GM, new in v0.8.0)

The *Player & GM Light Controller* macro as two GM tabs of the light window (*Portable lights*, *Scene lights*, or right-click a token → light bulb). Players don't see them: they light only what their heroes carry, with the profile the GM gave each item or spell.

**Token lights:** pick any token (hero, vestige, familiar) and a light, choose the look (Gentle, Balanced, Vivid: appearance only, the radius stays), **Apply**. Nothing is spent; for torches and lamps that burn out use *Carried items*. A burning carried item on that token is put out first.

| Light | Bright / total dim | Light | Bright / total dim |
|---|---|---|---|
| Candle | 5 / 10 ft | *Light* | 20 / 40 ft |
| Torch | 20 / 40 ft | *Continual Flame* | 20 / 40 ft |
| Oil Lamp | 15 / 45 ft | *Produce Flame* | 10 / 20 ft |
| Hooded Lantern open / shut | 30 / 60 · 0 / 5 ft | *Daylight* | 60 / 120 ft |
| Bullseye Lantern (60° cone) | 60 / 120 ft | Spectral Aura · Beacon | 0 / 15 · 10 / 30 ft |
| Moonlit Glow | 5 / 20 ft | No light | — |

**Scene lights (GM):** every ambient light and token light of the scene, with its state. **Turn off** (the original is kept), **Turn on / restore**, **Toggle each**, **Soften the look** (weaker colour and luminosity, same ranges) and **Restore the original look**, for the lights selected on the map, the ticked ones, or all (asks first). Magical darkness and Global Illumination are never changed, and "all" never reveals an ambient light you hid by hand. Lights switched off or softened by the old macro come back too. 

## Blind Death Saves — GM-only 2024 D&D death-save tracking (new in v0.6.0)

When a **character Actor reaches 0 HP and is dying**, Planar Homebrew can automatically make a GM-secret death save at the beginning of each of their combat turns. **A connected, primary GM is required.** If combat automation is not appropriate, the GM can use **Secret roll** manually. Both modes update a GM-restricted journal tally, never the Actor's player-readable death successes/failures. Native death-save rolls are suppressed for covered character Actors and replaced by this workflow.

### GM setup

1. Enable the module, open **Game Settings → Configure Settings → Module Settings**, and confirm **Blind Death Saves enabled**. The default is ON for *character* Actors; NPCs require the separate **Blind death saves for NPCs** setting. **Automatically roll on downed character turns** is ON by default.
2. Open **Planar Homebrew Manager → Death Saves (GM)**. Each character is listed with their current HP eligibility, **private** success/failure tally, and outcome.
3. Click **Configure** for an Actor to set **Enabled**, **Auto-roll on combat turns**, **Save modifier** (integer), and **Roll mode** (normal/advantage/disadvantage). Configuration is in the private journal; players cannot read the results or modify the private configuration.
4. For an Actor that already has public death-save successes/failures from before installation, click **Clear visible counters**. This writes zeros to the Actor and leaves the secret GM tally alone. Do this *before a player opens their character sheet* if old progress must be concealed.
5. When the Actor starts its turn at 0 HP, the primary GM's client rolls the death save and whispers it **only to GMs**. If you prefer manual control, turn off automatic rolling globally or for the Actor, and use **Secret roll** in the GM panel.
6. A hit at 0 HP counts as a failed death save. If dnd5e (or the GM clicking the sheet's pips on the main GM client) writes a failure on the sheet, the module removes it from the sheet and adds it to the secret tally instead. Otherwise press **+1 failure** (or **+2 failures (critical)**). These failures are confidential too.
7. **On a death** (three failures), the module hands the hero to **Planar Glitch** through its API (`recordDeath`, source *saves*) before setting the *Dead* status: Glitch hides the token, leaves the body and starts the Wheel as usual. Without Glitch, the hero just gets the *Dead* status.
8. The GM can use **Reset tally** to clear progress after a special recovery or correction. Recovering to positive HP resets the private tally automatically while the primary GM is connected. Any player-visible death counters should remain 0 under this rule.

**Save outcomes (2024 rules):** 10+ is one success; 9 or below one failure; natural 1 counts two failures; natural 20 restores 1 HP; three successes stabilizes the character and three failures means death. Only stabilization, death, and revival are announced publicly. A dead or stable Actor does not receive another automated roll. GM-only Journal persistence survives ordinary client refreshes/server restarts.

**Security/compatibility cautions:** The module uses a **GM-only JournalEntry** for state rather than a world setting or Actor flag readable by players. The normal D&D 5e death-save hook is canceled while the rule is enabled, and updates to visible `system.attributes.death.success` / `.failure` are suppressed except resets to zero. Keep the secret Journal restricted to GMs and do not export it to players. A module that bypasses the native `dnd5e.preRollDeathSave` hook, a custom character sheet that reads other sources, or a GM sharing their screen/chat can still reveal information. This is not a server-side access control extension; test with a separate player account. Per-Actor modifiers/advantage are configured manually rather than automatically reproducing all spell/feat Active Effect modifiers. This protects secrecy but means **native death-save rolling bonuses are not automatically applied**. Excluding an Actor from the GM-controlled rule does not re-enable its native button while the global privacy setting is on; disable the global rule to restore native rolling, which also restores public tracking.

**Important:** Do not enable other *blind death save*, *secret death save*, or *automatic death save* modules concurrently without checking conflicts. This feature has deterministic unit tests and mocked integration tests, **not live Foundry V14 multiplayer privacy verification**. See [full death-save test and limitations guide](docs/BLIND_DEATH_SAVES.md).

## Macro API

```js
const api = game.modules.get("planar-homebrew").api;   // also game.planarHomebrew (0.6.0 macros)
api.open();                                  // GM manager (openManager), api.openStatus()
api.openLights({tab: "token", tokenId});     // tabs: items | token | scene (GM)
await api.applyTokenLight(token.document, "aura", {strength: "gentle"});  // api.lightPresets() lists them
await api.switchLights([...api.sceneLightSources(canvas.scene).values()], "off", {scope: "all"});  // GM
await api.togglePortableLight(item);         // light or put out an owned light item
await api.performCompanionAction(actor, "recall");   // manifest | return | recall | dismiss | command | destroy (GM)
await api.performCompanionAction(actor, "manifest", {slotKey: "pact"});  // skip the slot question
await api.rollBlindDeathSave(actor, {manual: true});  // GM: one secret death save
await api.addPrivateDeathFailure(actor, 1);  // GM: a secret failure (1 or 2)
api.calculateResonance([4, 4], faces => 4);  // the pure dice chain
```

## Development

No build step: Foundry loads `scripts/main.mjs`. `npm test` checks syntax, the rules against mocked documents, the manifest, that `lang/en.json` and `lang/el.json` have the same keys and placeholders, and that every key used in the code exists. File map and the manual test checklist: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Releases: [docs/PUBLISHING.md](docs/PUBLISHING.md). Rules for coding agents (never commit): [AGENTS.md](AGENTS.md).

## Official API references

- [D&D 5e v6 roll and activity hooks](https://github.com/foundryvtt/dnd5e/wiki/Hooks)
- [D&D 5e Activities and consumption configuration](https://github.com/foundryvtt/dnd5e/wiki/Activities)
- [Foundry V14 targeted query API](https://foundryvtt.com/api/variables/CONFIG.queries.html)
- [Foundry V14 Roll API](https://foundryvtt.com/api/v14/classes/foundry.dice.Roll.html)
- [Foundry V14 chat HTML hook](https://foundryvtt.com/api/v14/functions/hookEvents.renderChatMessageHTML.html)

All homebrew features are registered as independent rules in the same module. To add another rule, create a file under `scripts/rules`, register it in `scripts/main.mjs`, give it a section in `scripts/ui/manager.mjs`, put its text in both language files, and add tests (see docs/DEVELOPMENT.md).

## License

MIT (code). No publisher text, art or audio is included.
