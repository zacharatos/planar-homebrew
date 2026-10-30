export const ID = 'planar-homebrew';
export const MODULE_ID = ID;
export const RULES = Object.freeze({
  RESONANCE: 'planar.resonance',
  VESTIGE: 'planar.bound-vestige',
  LIGHT: 'planar.portable-light',
  DEATH: 'planar.blind-death-saves'
});
export const DEFAULT_RESONANCE = Object.freeze({
  enabled: true,
  activityId: '',
  faces: 6,
  initialDice: 2,
  maxExtra: 100,
  damageType: 'slashing',
  criticalMode: 'no-base-doubling',
  // 'inline': the chain is added inside the weapon's damage roll (falls back to 'separate' if it can't).
  // 'separate': the tested macro's way: crit doubling off for this attack, chain rolled as its own damage card.
  mode: 'inline'
});
export const DEFAULT_VESTIGE = Object.freeze({
  companionUuid: '',
  state: 'unbound',
  range: 60,
  // How Manifest is paid: 'slot' (the module spends one Pact/spell slot the player picks),
  // 'spell' (cast the chosen spell activity on the sheet) or 'free'. requireCasting is kept for old bindings.
  costMode: 'slot',
  requireCasting: true,
  lightPreset: 'aura',
  // On binding, give the hero's players OWNER of the companion actor (so they can move it and use its actions).
  grantOwnership: true,
  castingActivityId: '',
  castingItemUuid: '',
  requireOutsideCombatRecall: true,
  commandCost: 'bonus',
  allowPlayerControls: true,
  // 'keep': the companion actor's own HP. 'vestige': AU Vestige Companion, max HP = 4 + 4 × Warlock level,
  // full HP on every manifestation (Manifest Vestige, our house rule).
  hpMode: 'keep',
  // AU: the vestige vanishes if its warlock dies. On by default for every binding.
  vanishOnDeath: true,
  enabled: true
});
export const COMPANION_STATES = Object.freeze(['unbound', 'dismissed', 'manifested', 'dormant', 'destroyed']);
