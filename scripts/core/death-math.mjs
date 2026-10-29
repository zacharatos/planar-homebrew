import {fail} from '../i18n.mjs';
/** Pure, deterministic 2024-style death-save math. No public Actor death counters are used. */
export const DEFAULT_DEATH_CONFIG = Object.freeze({ enabled: true, modifier: 0, advantage: 'normal', autoRoll: true });

export function normalizeDeathConfig(input = {}) {
  const cfg = {...DEFAULT_DEATH_CONFIG, ...input};
  if (typeof cfg.enabled !== 'boolean' || typeof cfg.autoRoll !== 'boolean') throw fail('Err.DeathToggles');
  if (!Number.isInteger(Number(cfg.modifier)) || Number(cfg.modifier) < -30 || Number(cfg.modifier) > 30) throw fail('Err.DeathModifier');
  if (!['normal', 'advantage', 'disadvantage'].includes(cfg.advantage)) throw fail('Err.DeathAdvantage');
  cfg.modifier = Number(cfg.modifier);
  return cfg;
}
export function isDeathSaveEligible(actor, {enabled = true, includeNPCs = false} = {}) {
  if (!enabled || !actor || !['character', 'npc'].includes(actor.type)) return false;
  if (actor.type === 'npc' && !includeNPCs) return false;
  if (actor.statuses?.has?.('stable') || actor.statuses?.has?.('dead')) return false;
  return Number(actor.system?.attributes?.hp?.value) === 0;
}
export function applyDeathSave(previous = {}, {natural, total}) {
  if (!Number.isInteger(natural) || natural < 1 || natural > 20 || !Number.isFinite(total)) throw fail('Err.DeathRoll');
  if (['dead', 'stable', 'revived'].includes(previous.outcome)) throw fail('Err.DeathResolved');
  const successes = Math.max(0, Math.min(3, Number(previous.successes) || 0));
  const failures = Math.max(0, Math.min(3, Number(previous.failures) || 0));
  if (natural === 20) return {successes, failures, outcome: 'revived', natural, total};
  const addSuccess = total >= 10 ? 1 : 0;
  const addFailure = natural === 1 ? 2 : (addSuccess ? 0 : 1);
  const nextSuccess = Math.min(3, successes + addSuccess);
  const nextFailure = Math.min(3, failures + addFailure);
  return {
    successes: nextSuccess, failures: nextFailure,
    outcome: nextFailure >= 3 ? 'dead' : (nextSuccess >= 3 ? 'stable' : 'pending'),
    natural, total
  };
}
export function deathFormula({advantage = 'normal', modifier = 0} = {}) {
  const mod = Number(modifier);
  if (!Number.isInteger(mod) || mod < -30 || mod > 30) throw fail('Err.DeathModifier');
  const dice = advantage === 'advantage' ? '2d20kh' : advantage === 'disadvantage' ? '2d20kl' : '1d20';
  if (!['normal', 'advantage', 'disadvantage'].includes(advantage)) throw fail('Err.DeathAdvantage');
  return `${dice}${mod < 0 ? '' : '+'}${mod}`;
}
export function naturalFromEvaluatedRoll(roll) {
  const dice = roll?.dice?.find(d=>Number(d.faces)===20 && Array.isArray(d.results));
  if (!dice) throw fail('Err.NoD20');
  const selected = dice.results.filter(r=>r.active !== false && r.discarded !== true);
  if (selected.length !== 1 || !Number.isInteger(Number(selected[0].result))) throw fail('Err.D20Ambiguous');
  return Number(selected[0].result);
}
export function combatTurnKey(combat) {
  if (!combat?.combatant?.id || !Number.isInteger(Number(combat.round)) || !Number.isInteger(Number(combat.turn))) return null;
  return `${combat.uuid ?? combat.id}:${combat.round}:${combat.turn}:${combat.combatant.id}`;
}
