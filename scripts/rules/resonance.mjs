import {ID, RULES, DEFAULT_RESONANCE} from '../core/constants.mjs';
import {validateResonance} from '../core/validation.mjs';
import {isSupportedSystemVersion} from '../util.mjs';
import {t,fail,warn,error} from '../i18n.mjs';

export const resonanceRule = Object.freeze({
  id: RULES.RESONANCE,
  name: 'Rule.Resonance.Name',
  target: 'Rule.Resonance.Target',
  description: 'Rule.Resonance.Hint'
});

/** Pure algorithm: counts the first non-matching die and never applies flat modifiers twice. */
export function calculateResonance(initial, rollExtra, {faces=6, maxExtra=100}={}) {
  if (!Array.isArray(initial) || initial.length !== 2 || initial.some(n => !Number.isInteger(n) || n < 1 || n > faces))
    throw fail('Err.TwoDice');
  if (!Number.isInteger(maxExtra) || maxExtra < 1 || maxExtra > 1000)
    throw fail('Err.ExtraCap');
  const extra = [];
  let capped = false;
  if (initial[0] === initial[1]) {
    for (let i=0; i<maxExtra; i++) {
      const value = rollExtra(faces);
      if (!Number.isInteger(value) || value < 1 || value > faces) throw fail('Err.ExtraDie');
      extra.push(value);
      if (value !== initial[0]) break;
      if (i === maxExtra-1) capped = true;
    }
  }
  return {
    initial: [...initial], extra, matched: initial[0] === initial[1],
    total: [...initial, ...extra].reduce((sum,n) => sum+n, 0), capped
  };
}

function activeResults(term) {
  return (term?.results ?? []).filter(result => result?.active !== false && !result?.discarded && !result?.rerolled);
}

export function findWeaponDice(roll, faces=6) {
  const terms = (roll?.terms ?? []).filter(term => term?.faces === faces && term?.number === 2);
  if (terms.length !== 1) return null;
  const results = activeResults(terms[0]).map(result => result.result);
  return results.length === 2 ? results : null;
}

export async function assignResonance(item, values) {
  if (!game.user.isGM) throw fail('Err.GMOnly');
  if (!item || item.type !== 'weapon') throw fail('Err.SelectWeapon');
  const config = validateResonance({...DEFAULT_RESONANCE, ...values});
  if (config.activityId && !item.system?.activities?.get?.(config.activityId))
    throw fail('Err.ActivityGone');
  if (config.activityId) {
    const activity = item.system.activities.get(config.activityId);
    if (activity.type !== 'attack') throw fail('Err.NeedsAttack');
  }
  await item.setFlag(ID, 'resonance', config);
  return config;
}

export async function unassignResonance(item) {
  if (!game.user.isGM) throw fail('Err.GMOnly');
  await item.unsetFlag(ID, 'resonance');
}

export function assignmentFor(item, activityId='') {
  const config = item?.getFlag?.(ID, 'resonance');
  if (!config?.enabled || (config.activityId && config.activityId !== activityId)) return null;
  return config;
}

/**
 * Identify the weapon's base dice *only* if unambiguous. Roll terms are real
 * evaluated dice; no regex over a displayed formula and no accidentally
 * pulling in Smite dice from another damage part.
 *
 * In the normal case we expect 2dN. Under the native doubled-dice critical
 * rule we expect precisely 4dN in the *same* base term, and retain only the
 * first two faces. Other terms / independent damage rolls remain untouched.
 */
export function locateWeaponPart(rolls, {faces=6, damageType='slashing'}={}) {
  if (!Array.isArray(rolls)) return null;
  const candidates = [];
  for (let index=0; index<rolls.length; index++) {
    const roll = rolls[index];
    if (!roll || !Number.isFinite(roll.total)) continue;
    const rollType = roll.options?.type ?? roll.options?.damageType;
    if (rollType && rollType !== damageType) continue;
    const dice = (roll.terms ?? []).filter(term => term?.faces === faces && (term?.number === 2 || term?.number === 4));
    if (dice.length !== 1) continue;
    const term = dice[0];
    // Other identically-sized pools in the SAME roll are ambiguous (e.g. smite).
    if ((roll.terms ?? []).some(other => other !== term && other?.faces === faces && (other?.number === 2 || other?.number === 4))) continue;
    const results = activeResults(term);
    if (results.length !== term.number || results.some(r => !Number.isInteger(r.result) || r.result < 1 || r.result > faces)) continue;
    candidates.push({index, roll, term, results, initial: results.slice(0,2).map(r => r.result),
      criticalDice: term.number === 4 ? results.slice(2) : []});
  }
  return candidates.length === 1 ? candidates[0] : null;
}

/** Roll one real Foundry DamageRoll die synchronously while in a synchronous dnd5e hook. */
export function rollNativeBonus(faces, damageType, Dice=globalThis.CONFIG?.Dice) {
  const DamageRoll = Dice?.DamageRoll;
  if (!DamageRoll) throw fail('Err.NoDamageRoll');
  // The [type] annotation is important for the native damage-application tray.
  const roll = new DamageRoll(`1d${faces}[${damageType}]`);
  if (typeof roll.evaluateSync !== 'function') throw fail('Err.NoSyncRoll');
  roll.evaluateSync({strict:true});
  const dice = (roll.terms ?? []).filter(term => term.faces === faces && term.number === 1);
  const result = dice.length === 1 ? activeResults(dice[0])[0]?.result : undefined;
  if (!Number.isInteger(result) || result < 1 || result > faces || roll.total !== result)
    throw fail('Err.BonusDie');
  return {value:result, roll};
}

function criticalModeIsSupported(config) {
  return (config.criticalMode ?? 'no-base-doubling') === 'no-base-doubling';
}

/**
 * Modify a *single* evaluated native DamageRoll before dnd5e publishes it.
 * The mutation is intentionally isolated here because Foundry V14 Roll.total
 * has no public setter. We update the underlying term results and the private
 * _total cache in one guarded operation; failure rolls everything back.
 *
 * Crucially we never call Actor.applyDamage, never create a separate chat
 * message and never add a second independently applied DamageRoll.
 */
export function injectResonance(rolls, config, {
  rollBonus = (faces,type) => rollNativeBonus(faces,type),
  operatorFactory = () => new foundry.dice.terms.OperatorTerm({operator:'+'})
}={}) {
  if (!config?.enabled) return {status:'disabled'};
  if (!criticalModeIsSupported(config)) return {status:'unsupported-critical-mode'};
  const part = locateWeaponPart(rolls, config);
  if (!part) return {status:'ambiguous-or-unsupported-roll'};
  const {roll, term, initial, criticalDice} = part;
  if (roll.options?.[ID]?.resonance) return {status:'already-processed'};
  if (!Object.prototype.hasOwnProperty.call(roll,'_total') || !Number.isFinite(roll._total) ||
      !Array.isArray(roll.terms) || !Array.isArray(term.results) || typeof roll.resetFormula !== 'function')
    return {status:'unsupported-roll-shape'};
  // Critical dice are removed from *the weapon's term only*; independent
  // damage parts (e.g. smite) keep their native crit behavior.
  const removeAmount = criticalDice.reduce((total,die) => total+die.result, 0);
  const bonusRolls=[];
  const result = calculateResonance(initial, () => {
    const rolled=rollBonus(config.faces,config.damageType);
    if (!rolled?.roll || rolled.roll.terms?.length < 1) throw new Error('Bonus roll has no evaluated terms');
    bonusRolls.push(rolled.roll);
    return rolled.value;
  }, config);
  const extraTotal=result.extra.reduce((total,value)=>total+value,0);
  const before={terms:[...roll.terms], results:[...term.results], number:term.number,
    total:roll._total, formula:roll.formula, options:roll.options?.[ID],
    dice:Array.isArray(roll._dice)?[...roll._dice]:null};
  try {
    if (criticalDice.length) {
      // Extra critical dice always follow the first two normal faces in the
      // supported 4dN representation. Fail closed on unfamiliar layouts.
      const active=activeResults(term);
      if (active.length !== 4 || active[0] !== part.results[0] || active[1] !== part.results[1])
        throw new Error('Unsupported critical-dice representation');
      const removedSet = new Set(criticalDice);
      term.results = term.results.filter(entry => !removedSet.has(entry));
      term.number = 2;
    }
    for (const bonus of bonusRolls) {
      for (const term of bonus.terms) {
        // Rebind only pre-evaluated term references, not its result values.
        if ('_root' in term) term._root=roll;
      }
      roll.terms.push(operatorFactory(), ...bonus.terms);
      // Foundry caches the evaluated dice separately from Roll.terms.
      if (Array.isArray(roll._dice)) roll._dice.push(...bonus.dice ?? bonus.terms.filter(term => Number.isInteger(term.faces)));
    }
    roll._total = before.total - removeAmount + extraTotal;
    roll.resetFormula();
    if (!Number.isFinite(roll.total) || roll.total !== before.total - removeAmount + extraTotal)
      throw new Error('Native roll total was not updated');
    roll.options[ID] = {
      resonance: true, initial, extra:result.extra, matched:result.matched,
      capped:result.capped, critical:criticalDice.length>0,
      removedCriticalDice:criticalDice.map(d=>d.result),
      originalTotal:before.total, newTotal:roll.total,
      type:config.damageType
    };
    return {status:'applied', ...roll.options[ID]};
  } catch (error) {
    roll.terms.splice(0,roll.terms.length,...before.terms);
    term.results = before.results;
    term.number = before.number;
    roll._total = before.total;
    if (before.dice) roll._dice.splice(0,roll._dice.length,...before.dice);
    if (before.options === undefined) delete roll.options[ID];
    else roll.options[ID]=before.options;
    try {roll.resetFormula();} catch { /* best-effort rollback */ }
    return {status:'error', error};
  }
}

export function registerResonanceAutomation(record) {
  Hooks.on('dnd5e.rollDamage', (rolls, data) => {
    // Internal Roll caches were checked on Foundry 14 + dnd5e 6.0.x only; elsewhere leave the roll alone.
    if (game.release?.generation !== 14 || !isSupportedSystemVersion(game.system?.version)) return;
    const activity = data?.subject;
    if (activity?.type !== 'attack') return;
    const item = activity.item;
    const config = assignmentFor(item, activity.id);
    if (!config) return;
    try {
      const result = injectResonance(rolls, config);
      if (result.status === 'applied') {
        record(`${item.name}: ${result.initial.join('+')}, chain [${result.extra.join(',')}], total ${result.newTotal}${result.critical?' (custom critical)':''}`);
        if (result.capped && game.user.isGM) warn('Note.ResonanceCap',{item:item.name});
      } else if (result.status !== 'already-processed') {
        record(`Skipped ${item.name}: ${result.status}${result.error ? ` (${result.error.message})` : ''}`);
        if (result.status !== 'disabled')
          warn('Note.ResonanceSkipped',{item:item.name,status:result.status});
      }
    } catch(error) {
      record(`Resonance failure on ${item.name}: ${error.message}`);
      console.error(`${ID}:`,error);
      error('Note.ResonanceFailed',{item:item.name});
    }
  });

  Hooks.on('renderChatMessageHTML', (message, html) => {
    for (const roll of message.rolls ?? []) {
      const info=roll?.options?.[ID];
      if (!info?.resonance) continue;
      if (html.querySelector('.planar-resonance-result')) return;
      const box=document.createElement('div');
      box.className='planar-resonance-result';
      // Each viewer reads the breakdown in their own module language.
      const label=t(info.matched?'Chat.ResonanceMatched':'Chat.Resonance');
      const details=[t('Chat.ResonanceInitial',{dice:info.initial.join(' + ')}),
        t('Chat.ResonanceExtra',{dice:info.extra.length?info.extra.join(' + '):t('Chat.None')}),
        t('Chat.ResonanceTotal',{from:info.originalTotal,to:info.newTotal,type:info.type})];
      if (info.critical) details.push(t('Chat.ResonanceCritical',{dice:info.removedCriticalDice.join(' + ')}));
      if (info.capped) details.push(t('Chat.ResonanceCapped'));
      const heading=document.createElement('strong'); heading.textContent=label;
      const body=document.createElement('div'); body.textContent=details.join(' · ');
      box.append(heading,body);
      html.querySelector('.message-content')?.append(box);
      break;
    }
  });
}
