import {fail} from '../i18n.mjs';
/** Pure helpers for Bound Companion. No Foundry globals, testable with Node. */
export const ALLOWED_ACTIONS = Object.freeze(['manifest','return','recall','dismiss','destroy','command']);

/**
 * Spell slots a hero could pay Manifest with: Pact Magic first, then spell levels low to high.
 * Each entry: {key: 'pact'|'spellN', level, value, max}. Only slots with at least one left.
 */
export function availableSlots(actor) {
  const spells = actor?.system?.spells ?? {};
  const out = [];
  const pact = spells.pact;
  if (Number(pact?.value) > 0 && Number(pact?.max ?? pact?.value) > 0) out.push({key: 'pact', level: Number(pact.level) || 1, value: Number(pact.value), max: Number(pact.max ?? pact.value)});
  for (let level = 1; level <= 9; level++) {
    const slot = spells[`spell${level}`];
    if (Number(slot?.value) > 0) out.push({key: `spell${level}`, level, value: Number(slot.value), max: Number(slot.max ?? slot.value)});
  }
  return out;
}

export function slotSnapshot(actor) {
  const spells = actor?.system?.spells ?? {};
  return Object.fromEntries(Object.entries(spells).filter(([key,slot]) =>
    /^(spell[1-9]|pact)$/.test(key) && typeof slot?.value === 'number'
  ).map(([key,slot]) => [key, slot.value]));
}

/** A native cast is accepted only if exactly ONE spell or pact slot decreased by one. */
export function consumedExactlyOneSlot(before, after) {
  let total = 0;
  for (const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    const first = before[key], last = after[key];
    if (!Number.isFinite(first) || !Number.isFinite(last)) return false;
    const difference = first-last;
    if (difference < 0 || difference > 1) return false;
    total += difference;
  }
  return total === 1;
}

export function isAuthorizedOwner(actor, user) {
  return Boolean(user && actor?.testUserPermission?.(user,'OWNER'));
}

export function validateRequestShape(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw fail('Err.CompanionRequest');
  if (!ALLOWED_ACTIONS.includes(request.action)) throw fail('Err.CompanionAction');
  if (typeof request.summonerUuid !== 'string' || !/^Actor\.[A-Za-z0-9]+$/.test(request.summonerUuid)) {
    throw fail('Err.WorldActorUuid');
  }
  if (request.point !== undefined) {
    const p = request.point;
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) throw fail('Err.TokenPosition');
  }
  return request;
}

export function validateTokenPosition({point, anchor, width, height, step, gridFeet, rangeFeet, sceneWidth, sceneHeight, occupied}) {
  if (![point?.x,point?.y,anchor?.x,anchor?.y,width,height,step,gridFeet,rangeFeet,sceneWidth,sceneHeight]
    .every(Number.isFinite)) throw fail('Err.SceneDimensions');
  if (width<=0 || height<=0 || step<=0 || gridFeet<=0 || rangeFeet<0) throw fail('Err.SceneGrid');
  const snapped={x:Math.round(point.x/step)*step,y:Math.round(point.y/step)*step};
  if (snapped.x<0 || snapped.y<0 || snapped.x+width>sceneWidth || snapped.y+height>sceneHeight) {
    throw fail('Err.OutsideScene');
  }
  const distance=Math.hypot(snapped.x-anchor.x,snapped.y-anchor.y)/step*gridFeet;
  if (distance > rangeFeet+1e-6) throw fail('Err.OutOfRange',{range:rangeFeet});
  for (const r of occupied) {
    if(snapped.x < r.x+r.w && snapped.x+width > r.x && snapped.y < r.y+r.h && snapped.y+height > r.y) {
      throw fail('Err.Overlaps');
    }
  }
  return snapped;
}

/** AU Vestige Companion: HP 4 + four times the Warlock level. */
export function vestigeMaxHP(warlockLevel) {
  const level = Math.max(0, Math.floor(Number(warlockLevel) || 0));
  return 4 + 4 * level;
}

/** A class level from dnd5e data: actor.classes[identifier] when present, else the class items. */
export function classLevel(actor, identifier) {
  const fromMap = actor?.classes?.[identifier]?.system?.levels;
  if (Number.isFinite(Number(fromMap))) return Number(fromMap);
  const item = [...(actor?.items ?? [])].find(i => i?.type === 'class' && (i.system?.identifier === identifier || String(i.name ?? '').toLowerCase() === identifier));
  return Number(item?.system?.levels) || 0;
}

export function commandKey(combat) { return combat ? `${combat.id}:${combat.round}` : null; }
