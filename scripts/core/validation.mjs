import {isTokenLightPreset} from './token-lights.mjs';
import {t,fail} from '../i18n.mjs';
export const finiteRange = (value, min, max, label) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw fail('Err.Between',{label,min,max});
  return n;
};
export function validateResonance(input={}) {
  const faces = finiteRange(input.faces ?? 6, 2, 100, t('Label.DieFaces'));
  const maxExtra = finiteRange(input.maxExtra ?? 100, 1, 1000, t('Label.MaxExtra'));
  if (!Number.isInteger(faces) || !Number.isInteger(maxExtra)) throw fail('Err.WholeDice');
  if (Number(input.initialDice ?? 2) !== 2) throw fail('Err.TwoDiceOnly');
  const damageType = String(input.damageType ?? 'slashing').trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(damageType)) throw fail('Err.DamageType');
  return {
    enabled: Boolean(input.enabled ?? true),
    activityId: String(input.activityId ?? ''),
    faces, initialDice: 2, maxExtra,
    damageType,
    criticalMode: 'no-base-doubling',
    mode: input.mode === 'separate' ? 'separate' : 'inline'
  };
}
export function validateVestige(input={}) {
  const range = finiteRange(input.range ?? 60, 5, 500, t('Label.Range'));
  const lightPreset = input.lightPreset ?? 'aura';
  if (lightPreset !== 'none' && !isTokenLightPreset(lightPreset)) throw fail('Err.CompanionLight');
  const costMode = companionCostMode(input);
  if (!['bonus','action','free'].includes(input.commandCost ?? 'bonus')) throw fail('Err.CommandCost');
  return {
    companionUuid: String(input.companionUuid ?? ''),
    state: normalizedCompanionState(input.state),
    range, costMode, requireCasting: costMode === 'spell',
    castingItemUuid: String(input.castingItemUuid ?? ''),
    castingActivityId: String(input.castingActivityId ?? ''),
    lightPreset,
    grantOwnership: Boolean(input.grantOwnership ?? true),
    commandCost: input.commandCost ?? 'bonus',
    requireOutsideCombatRecall: Boolean(input.requireOutsideCombatRecall ?? true),
    allowPlayerControls: Boolean(input.allowPlayerControls ?? true),
    hpMode: ['keep','vestige'].includes(input.hpMode) ? input.hpMode : 'keep',
    vanishOnDeath: Boolean(input.vanishOnDeath ?? true),
    enabled: Boolean(input.enabled ?? true)
  };
}
/**
 * How Manifest is paid. Bindings saved before 0.8.0 have no costMode: a chosen spell keeps 'spell',
 * "no slot" becomes 'free', and "spell" without a spell chosen becomes 'slot'.
 */
export function companionCostMode(input = {}) {
  if (['slot','spell','free'].includes(input.costMode)) return input.costMode;
  if (input.requireCasting === false) return 'free';
  return input.castingItemUuid && input.castingActivityId ? 'spell' : 'slot';
}
function normalizedCompanionState(state) {
  return ['unbound','dismissed','manifested','dormant','destroyed'].includes(state) ? state : 'unbound';
}
export const isCombatActive = (combats, sceneId) => [...combats].some(c=>c.scene?.id===sceneId && c.started);
export const boxesOverlap = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
export function nearestVacant({anchor, occupied, width, height, step, maxDistancePixels}) {
  if (![width,height,step,maxDistancePixels].every(n=>Number.isFinite(n)&&n>0)) return null;
  const radii = Math.min(70, Math.ceil(maxDistancePixels/step));
  for (let radius=1; radius<=radii; radius++) {
    for (let dx=-radius; dx<=radius; dx++) for (let dy=-radius;dy<=radius;dy++) {
      if (Math.max(Math.abs(dx),Math.abs(dy))!==radius) continue;
      if (Math.hypot(dx*step,dy*step)>maxDistancePixels) continue;
      const rect={x:Math.round((anchor.x+dx*step)/step)*step,y:Math.round((anchor.y+dy*step)/step)*step,w:width,h:height};
      if(rect.x<0 || rect.y<0)continue;
      if(occupied.some(o=>boxesOverlap(rect,o)))continue;
      return {x:rect.x,y:rect.y};
    }
  }
  return null;
}
