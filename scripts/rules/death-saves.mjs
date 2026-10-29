import {ID, RULES} from '../core/constants.mjs';
import {t,tw,fail} from '../i18n.mjs';
import {DEFAULT_DEATH_CONFIG, applyDeathSave, combatTurnKey, deathFormula, isDeathSaveEligible, naturalFromEvaluatedRoll, normalizeDeathConfig} from '../core/death-math.mjs';

export const deathSaveRule = Object.freeze({
  id: RULES.DEATH, name: 'Rule.Death.Name', target: 'Rule.Death.Target', description: 'Rule.Death.Hint'
});
/** Machine-readable reasons a roll was skipped (the manager shows them through Death.Skip.*). */
export const SKIP = Object.freeze({AUTO: 'auto disabled', TURN: 'already rolled for this turn'});

const LEDGER_MARKER = 'deathLedgerStore';
const LEDGER_KEY = 'deathLedger';
const inFlight = new Set();
let cachedJournal;
let logger = () => {};
const warn = e => { logger(`Blind Death Saves: ${e?.message ?? e}`); console.error(`${ID} death saves:`, e); if (game.user?.isGM) ui.notifications.error(t('Death.Error', {message: e?.message ?? e})); };
const getEnabled = () => Boolean(game.settings.get(ID, 'deathSavesEnabled'));
const includeNPCs = () => Boolean(game.settings.get(ID, 'deathSavesNPCs'));
const gmOnly = () => { if (!game.user?.isGM) throw fail('Err.LedgerGMOnly'); };
/** The status Foundry treats as defeated/dead (dnd5e: "dead"). */
const defeatedStatus = () => CONFIG.specialStatusEffects?.DEFEATED ?? 'dead';
const actorKey = actor => actor?.uuid;
const firstGM = () => game.users?.filter?.(u => u.active && u.isGM)?.sort?.((a,b)=>String(a.id).localeCompare(String(b.id)))[0]?.id;
const primaryGM = () => Boolean(game.user?.isGM && firstGM() === game.user.id);

/** A default-denied world Journal; unlike Actor flags, players cannot read its saved totals. */
export async function ensurePrivateDeathLedger() {
  gmOnly();
  if (cachedJournal && game.journal.get(cachedJournal.id) === cachedJournal) return cachedJournal;
  const matches = game.journal.contents.filter(j => j.getFlag(ID, LEDGER_MARKER) === true);
  if (matches.length > 1) throw fail('Err.LedgerDuplicate');
  if (matches.length) {
    const journal = matches[0];
    if (Number(journal.ownership?.default ?? 0) > 0) throw fail('Err.LedgerPublic');
    cachedJournal = journal; return journal;
  }
  cachedJournal = await JournalEntry.create({
    name: t('Death.LedgerName'),
    ownership: {default: 0},
    flags: {[ID]: {[LEDGER_MARKER]: true, [LEDGER_KEY]: {records: {}, configs: {}}}}
  });
  if (!cachedJournal) throw fail('Err.LedgerCreate');
  return cachedJournal;
}
async function readLedger() {
  const journal = await ensurePrivateDeathLedger();
  return {journal, data: structuredClone(journal.getFlag(ID, LEDGER_KEY) ?? {records:{},configs:{}})};
}
const ensureShape = data => { data.records ??= {}; data.configs ??= {}; return data; };
export async function getPrivateDeathState(actor) {
  gmOnly();
  const {data} = await readLedger(); ensureShape(data);
  return {config: normalizeDeathConfig(data.configs[actorKey(actor)]), record: data.records[actorKey(actor)] ?? null};
}
export async function configureBlindDeathSave(actor, values) {
  gmOnly();
  if (!actorKey(actor)) throw fail('Err.NoActor');
  const {journal,data} = await readLedger(); ensureShape(data);
  data.configs[actorKey(actor)] = normalizeDeathConfig({...data.configs[actorKey(actor)], ...values});
  await journal.setFlag(ID, LEDGER_KEY, data);
  return data.configs[actorKey(actor)];
}
/** GM adjudication for 0-HP damage, critical damage, or special effects. */
export async function addPrivateDeathFailure(actor, amount = 1) {
  gmOnly();
  if (!primaryGM()) throw fail('Err.PrimaryGM');
  if (!validManagedActor(actor)) throw fail('Err.NotEligible');
  if (![1,2].includes(amount)) throw fail('Err.FailureAmount');
  const uuid=actorKey(actor);
  if (inFlight.has(uuid)) throw fail('Err.DeathInProgress');
  inFlight.add(uuid);
  try {
    const {journal,data}=await readLedger();ensureShape(data);
    const current=data.records[uuid]??{successes:0,failures:0,outcome:'pending'};
    if (current.outcome !== 'pending') throw fail('Err.DeathResolved');
    const failures=Math.min(3, current.failures+amount);
    const outcome=failures>=3?'dead':'pending';
    const record={...current, failures, outcome, rolledAt:Date.now()};
    data.records[uuid]=record;
    await journal.setFlag(ID,LEDGER_KEY,data);
    const gms=game.users.filter(u=>u.isGM).map(u=>u.id);
    try {await ChatMessage.create({content:`<p>${t('Death.PrivateFailure',{name:foundry.utils.escapeHTML(actor.name),amount,successes:record.successes,failures})}</p>`,speaker:{alias:t('Death.GMAlias')},whisper:gms,blind:true});}catch(e){warn(fail('Err.PrivateChat',{message:e?.message??e}));}
    if (outcome==='dead') {try {await applyOutcome(actor,outcome);await announceOutcome(actor,outcome);}catch(e){warn(e);}}
    return record;
  } finally {inFlight.delete(uuid);}
}
export async function clearVisibleDeathCounters(actor) {
  gmOnly();
  if (!actor || !['character','npc'].includes(actor.type)) throw fail('Err.NoActor');
  await actor.update({'system.attributes.death.success':0,'system.attributes.death.failure':0});
  return t('Death.Cleared');
}
export async function resetBlindDeathSave(actor) {
  gmOnly();
  const {journal,data} = await readLedger(); ensureShape(data);
  delete data.records[actorKey(actor)];
  await journal.setFlag(ID, LEDGER_KEY, data);
  return t('Death.Reset');
}
async function announceOutcome(actor,outcome) {
  const keys={stable:'Chat.Stable',dead:'Chat.Dead',revived:'Chat.Revived'};
  if (!keys[outcome]) return;
  // Public final outcomes are intentional; intermediate saves and counters remain hidden.
  // Everyone reads this line, so it is written in the world's text language.
  const name=foundry.utils.escapeHTML(actor.name);
  await ChatMessage.create({content:`<p><strong>${tw('Chat.DeathTitle')}</strong></p><p>${tw(keys[outcome],{name})}</p>`, speaker:{alias:tw('Chat.DeathAlias')}});
}
async function applyOutcome(actor,outcome) {
  if (outcome === 'revived') {
    await actor.update({'system.attributes.hp.value': 1});
    return;
  }
  if (outcome !== 'stable' && outcome !== 'dead') return;
  // A blind death never shows three failures on the sheet, so Planar Glitch's own "third failed save"
  // detection can't see it. Hand the death to Glitch first (it hides the token, leaves the body and
  // starts the Wheel); its record is idempotent, so the Dead status below won't record it twice.
  if (outcome === 'dead') await handToGlitch(actor);
  const id = outcome === 'stable' ? 'stable' : defeatedStatus();
  if (!CONFIG.statusEffects?.some(s => s.id === id) || typeof actor.toggleStatusEffect !== 'function') {
    logger(`${actor.name} is ${outcome}; status ${id} could not be automatically set. GM should apply status manually.`);
    return;
  }
  await actor.toggleStatusEffect(id,{active:true});
}
/** Planar Glitch, when active: record the death through its API (dev guide § 3: APIs, never its settings). */
export async function handToGlitch(actor) {
  const glitch = game.modules?.get?.('planar-glitch');
  if (!glitch?.active || typeof glitch.api?.recordDeath !== 'function') return null;
  try { return await glitch.api.recordDeath(actor, {cause: tw('Death.GlitchCause'), source: 'saves'}); }
  catch (e) { warn(fail('Err.GlitchHandoff', {message: e?.message ?? e})); return null; }
}
function validManagedActor(actor) {
  return Boolean(isDeathSaveEligible(actor,{enabled:getEnabled(),includeNPCs:includeNPCs()}));
}
/** Privileged roll: natural d20 (with optional configured modifier/advantage), never a player-side roll. */
export async function rollBlindDeathSave(actor, {combat = null, manual = false} = {}) {
  gmOnly();
  if (!validManagedActor(actor)) throw fail('Err.NotEligible');
  if (!primaryGM()) throw fail('Err.PrimaryGM');
  const uuid = actorKey(actor);
  if (inFlight.has(uuid)) throw fail('Err.DeathInProgress');
  inFlight.add(uuid);
  try {
    const {journal,data} = await readLedger(); ensureShape(data);
    const cfg=normalizeDeathConfig(data.configs[uuid]);
    if (!cfg.enabled) throw fail('Err.DeathDisabled');
    if (!manual && (!cfg.autoRoll || !game.settings.get(ID,'deathSavesAuto'))) return {skipped:SKIP.AUTO};
    const turnKey=combat && combat.combatant?.actor?.uuid===uuid ? combatTurnKey(combat) : null;
    const existing=data.records[uuid] ?? {successes:0,failures:0,outcome:'pending'};
    if (existing.outcome && existing.outcome !== 'pending') return {skipped:`already ${existing.outcome}`};
    if (turnKey && existing.lastTurnKey === turnKey) return {skipped:SKIP.TURN};
    const roll=await (new Roll(deathFormula(cfg))).evaluate();
    const natural=naturalFromEvaluatedRoll(roll);
    const result=applyDeathSave(existing,{natural,total:Number(roll.total)});
    const record={...result,lastTurnKey:turnKey ?? existing.lastTurnKey ?? null,rolledAt:Date.now()};
    // Persist first. If persistence fails, do not publish or apply the result.
    data.records[uuid]=record;
    await journal.setFlag(ID,LEDGER_KEY,data);
    const gms=game.users.filter(u=>u.isGM).map(u=>u.id);
    if (!gms.length) throw fail('Err.NoGM');
    try {
      await roll.toMessage({speaker:{alias:t('Death.GMAlias')},flavor:t('Death.RollFlavor',{name:actor.name,successes:record.successes,failures:record.failures}),whisper:gms,blind:true},{rollMode:'blindroll'});
    } catch(e) {warn(fail('Err.PrivateChat',{message:e?.message??e}));}
    if (record.outcome !== 'pending') {
      try {await applyOutcome(actor,record.outcome); await announceOutcome(actor,record.outcome);}
      catch (e) {warn(fail('Err.FinalState',{message:e?.message??e}));}
    }
    logger(`Private death save for ${actor.name}: recorded (${record.outcome})`);
    return {record,roll};
  } finally {inFlight.delete(uuid);}
}
/** Stop native death-save usage before a player can see a local roll or the system can publish counters. */
export function cancelNativeDeathSave(...args) {
  if (!getEnabled()) return;
  const actor = args.find(a=>a?.documentName==='Actor') ?? args[0]?.subject ?? args[0]?.actor;
  // D&D5e 6.0.x currently passes a process configuration object. Block unknown shapes, too.
  if (!actor || actor.type === 'character' || (actor.type === 'npc' && includeNPCs())) {
    if (game.user?.isGM) ui.notifications?.warn?.(t('Death.NativeBlocked'));
    return false;
  }
}
function dropDeathCounters(changes) {
  const path='system.attributes.death';
  let failure=null;
  const note=value=>{const n=Number(value);if(Number.isFinite(n)&&n>0)failure=Math.max(failure??0,n);};
  for (const suffix of ['success','failure']) {
    const key=`${path}.${suffix}`;
    if (!Object.hasOwn(changes,key)) continue;
    if (suffix==='failure') note(changes[key]);
    if (Number(changes[key]) !== 0) delete changes[key];
  }
  const death=changes.system?.attributes?.death;
  if (death && typeof death==='object') {
    if (Object.hasOwn(death,'failure')) note(death.failure);
    if (Object.hasOwn(death,'success')&&Number(death.success) !== 0) delete death.success;
    if (Object.hasOwn(death,'failure')&&Number(death.failure) !== 0) delete death.failure;
  }
  return failure;
}
/**
 * Guard against leaking progress through normal Actor document updates. A failure that something
 * else tries to put on the sheet (dnd5e's damage-at-0-HP failure, or the GM clicking the pips) is
 * moved into the private tally instead of being lost, when it comes from the primary GM's client.
 */
export function protectPublicDeathCounters(actor, changes) {
  if (!getEnabled()) return;
  if (!(actor?.type === 'character' || (includeNPCs() && actor?.type === 'npc'))) return;
  const failure=dropDeathCounters(changes);
  if (failure===null || !primaryGM() || !validManagedActor(actor)) return;
  const visible=Math.max(0,Number(actor.system?.attributes?.death?.failure)||0);
  const added=Math.min(2,failure-visible);
  if (added>=1) queueMicrotask(()=>{void addPrivateDeathFailure(actor,added).catch(warn);});
}
async function rollActiveCombatant(combat, changes = {}) {
  if (!primaryGM() || !getEnabled() || !combat?.started) return;
  if (!('round' in changes) && !('turn' in changes)) return;
  const actor=combat.combatant?.actor;
  if (!validManagedActor(actor)) return;
  await rollBlindDeathSave(actor,{combat});
}
/** Recovery resets the private tally; others never see the previous tally. */
async function clearRecoveredActor(actor,changes) {
  if (!primaryGM() || !getEnabled() || !actorKey(actor)) return;
  const hpPath='system.attributes.hp.value';
  if (!Object.hasOwn(changes,hpPath) && changes?.system?.attributes?.hp?.value===undefined) return;
  if (Number(actor.system?.attributes?.hp?.value) <= 0) return;
  const {data} = await readLedger();
  if (data.records?.[actorKey(actor)]) await resetBlindDeathSave(actor);
}
export function registerBlindDeathSaves(record = ()=>{}) {
  logger=record;
  Hooks.on('dnd5e.preRollDeathSave',cancelNativeDeathSave);
  Hooks.on('preUpdateActor',protectPublicDeathCounters);
  Hooks.on('updateCombat',(combat,changes)=>{void rollActiveCombatant(combat,changes).catch(warn);});
  Hooks.on('updateActor',(actor,changes)=>{void clearRecoveredActor(actor,changes).catch(warn);});
  if (primaryGM() && getEnabled()) void ensurePrivateDeathLedger().catch(warn);
  logger('Blind Death Saves: GM-secret ledger and turn automation registered');
}
