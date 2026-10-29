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
  criticalMode: 'no-base-doubling'
});
export const DEFAULT_VESTIGE = Object.freeze({
  companionUuid: '',
  state: 'unbound',
  range: 60,
  requireCasting: true,
  lightPreset: 'aura',
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
