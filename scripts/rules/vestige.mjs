import {ID,RULES,DEFAULT_VESTIGE} from '../core/constants.mjs';
import {t,tw,fail} from '../i18n.mjs';
import {validateVestige,nearestVacant,isCombatActive,companionCostMode} from '../core/validation.mjs';
import {transition} from '../core/state.mjs';
import {ALLOWED_ACTIONS,slotSnapshot,consumedExactlyOneSlot,isAuthorizedOwner,validateRequestShape,
  validateTokenPosition,commandKey,vestigeMaxHP,classLevel,availableSlots} from '../core/companion-helpers.mjs';
import {buildTokenLight,isTokenLightPreset} from '../core/token-lights.mjs';

/**
 * Bound Companion (0.8.0): a world actor (Marigia's vestige, a familiar) bound to a hero.
 * - Manifest is paid on the player's own client (one Pact/spell slot they pick, the hero's spell, or free);
 *   the token is placed by the GM's client next to the hero, automatically. If placing fails, a slot paid
 *   by the module is given back.
 * - Players' Manifest / Return / Recall / Dismiss go to the active GM's client through CONFIG.queries.
 *   GM approval is a world setting ("companionApproval", off by default): the binding itself is the GM's
 *   permission. Command is local (a flag and a chat line).
 */
export const vestigeRule=Object.freeze({id:RULES.VESTIGE,name:'Rule.Companion.Name',target:'Rule.Companion.Target',description:'Rule.Companion.Hint'});
const pending=new Set();
const expectedDeletes=new Set();
const GM_QUERY=`${ID}.companionRequest`;
const PLAYER_ACTIONS=['manifest','return','recall','dismiss'];
const cleanError=error=>String(error?.message??error);
const gmOnly=()=>{if(!game.user.isGM)throw fail('Err.GMAuthorize');};
const coordinator=()=>game.users.activeGM?.id===game.user.id;
const approvalRequired=()=>{try{return Boolean(game.settings.get(ID,'companionApproval'));}catch{return false;}};
/** The binding, with defaults and the 0.8.0 cost mode worked out for older bindings. */
export const companionConfig=actor=>{
  const stored=actor?.getFlag?.(ID,'vestige')??{};
  return {...DEFAULT_VESTIGE,...stored,costMode:companionCostMode(stored)};
};
const flags=companionConfig;
const worldActor=a=>a && a.parent==null && game.actors.get(a.id)===a;
const currentScene=()=>{if(!canvas?.scene)throw fail('Err.OpenScene');return canvas.scene;};
const companionOf=config=>game.actors.get(String(config.companionUuid??'').split('.')[1]);
const validBound=(summoner,config,companion)=>{
  if(!worldActor(summoner))throw fail('Err.SummonerRequired');
  if(!config.enabled)throw fail('Err.BindingDisabled');
  if(!worldActor(companion) || config.companionUuid!==companion.uuid)throw fail('Err.CompanionMissing');
};
function combatOn(sceneId){return [...game.combats].find(c=>c.scene?.id===sceneId&&c.started);}
function findTokens(summoner) {
  const tokens=[];
  for(const scene of game.scenes)for(const token of scene.tokens){
    if(token.getFlag(ID,'summonerUuid')===summoner.uuid)tokens.push({scene,token});
  }
  return tokens;
}
function linkedTokens(companion){
  const output=[];
  for(const scene of game.scenes)for(const token of scene.tokens){
    if(token.actorId===companion.id)output.push({scene,token});
  }
  return output;
}
function getAnchor(summoner,scene) {
  return (canvas?.scene?.id===scene.id ? canvas.tokens?.controlled?.map(tok=>tok.document).find(tok=>tok.actorId===summoner.id) : null)??
    [...scene.tokens].find(tok=>tok.actorId===summoner.id);
}
export function resolveCastingActivity(summoner, config) {
  if (config.costMode!=='spell') return null;
  const item=summoner.items.find(i=>i.uuid===config.castingItemUuid);
  if(!item || item.type!=='spell')throw fail('Err.ChooseSpell');
  const activity=item.system?.activities?.get?.(config.castingActivityId);
  if(!activity || typeof activity.use!=='function')throw fail('Err.ActivityUnusable');
  if(activity.type==='summon')throw fail('Err.NoSummonActivity');
  return activity;
}
/** Checks before anything is paid or placed. Without a point, the nearest free square next to the hero is used. */
function preflight(summoner,sceneId,point,stateExpected) {
  const config=flags(summoner);
  const companion=companionOf(config);
  validBound(summoner,config,companion);
  if(stateExpected==='dormant'&&Number(companion.system?.attributes?.hp?.value)<=0)throw fail('Err.ZeroHPReturn');
  if(config.state!==stateExpected)throw fail('Err.WrongState',{state:t(`State.${config.state}`),expected:t(`State.${stateExpected}`)});
  const existing=[...findTokens(summoner),...linkedTokens(companion)];
  if(existing.length)throw fail('Err.CompanionTokenExists',{companion:companion.name,scene:existing[0].scene.name});
  const scene=game.scenes.get(sceneId);
  if(!scene)throw fail('Err.SceneMissing');
  const anchor=getAnchor(summoner,scene);
  if(!anchor)throw fail('Err.PlaceNamed',{name:summoner.name});
  if(stateExpected==='dormant'&&config.requireOutsideCombatRecall&&combatOn(scene.id))throw fail('Err.ReturnInCombat');
  const step=Number(scene.grid?.size),feet=Number(scene.grid?.distance);
  const width=(Number(companion.prototypeToken?.width)||1)*step;
  const height=(Number(companion.prototypeToken?.height)||1)*step;
  const occupied=[...scene.tokens].map(tok=>({x:tok.x,y:tok.y,w:(tok.width||1)*step,h:(tok.height||1)*step}));
  const bounds=scene.dimensions;
  const target=point??nearestVacant({anchor,occupied,width,height,step,maxDistancePixels:config.range/feet*step});
  if(!target)throw fail('Err.NoFreeSpace');
  const chosen=validateTokenPosition({point:target,anchor,width,height,step,gridFeet:feet,rangeFeet:config.range,
    sceneWidth:Number(bounds?.width),sceneHeight:Number(bounds?.height),occupied});
  return {config,companion,scene,point:chosen};
}
async function withLock(summoner,action){
  if(pending.has(summoner.uuid))throw fail('Err.CompanionBusy');
  pending.add(summoner.uuid);
  try{return await action();}finally{pending.delete(summoner.uuid);}
}
export async function inspectVestige(summoner){
  const config=flags(summoner);
  const companion=config.companionUuid ? await fromUuid(config.companionUuid):null;
  const tokens=findTokens(summoner);
  const errors=[];
  if(config.companionUuid&&!worldActor(companion))errors.push(t('Err.CompanionMissing'));
  if(config.state==='manifested'&&tokens.length!==1)errors.push(t('Companion.TokenCount',{count:tokens.length}));
  if(config.state!=='manifested'&&tokens.length)errors.push(t('Companion.StrayToken'));
  if(companion&&linkedTokens(companion).length>1)errors.push(t('Companion.DuplicateTokens'));
  if(config.costMode==='spell'){try{resolveCastingActivity(summoner,config);}catch(e){errors.push(e.message);}}
  return {config,companion,tokens,errors};
}
/** The hero's players get OWNER of the companion actor, so they can move it and use its actions. */
async function shareCompanion(summoner,companion){
  const OWNER=globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER??3;
  const ownership={...(companion.ownership??{})};
  let changed=false;
  for(const user of game.users){
    if(user.isGM||!summoner.testUserPermission(user,'OWNER'))continue;
    if(ownership[user.id]!==OWNER){ownership[user.id]=OWNER;changed=true;}
  }
  if(changed)await companion.update({ownership});
  return changed;
}
/**
 * GM: bind a companion to a hero. If the companion already stands on a scene (placed by hand), that
 * token is adopted: the binding starts as manifested instead of refusing.
 */
export async function bindVestige(summoner,companion,options={}){
  gmOnly();
  if(!worldActor(summoner)||!worldActor(companion))throw fail('Err.SelectWorldActors');
  if(summoner.id===companion.id)throw fail('Err.SameActor');
  const original=await inspectVestige(summoner);
  const sameCompanion=original.config.companionUuid===companion.uuid;
  if(!sameCompanion&&(original.tokens.length||original.config.state==='manifested'))throw fail('Err.DismissFirst');
  const other=game.actors.contents.find(a=>a.id!==summoner.id&&a.getFlag(ID,'vestige')?.companionUuid===companion.uuid);
  if(other)throw fail('Err.AlreadyBound',{name:other.name});
  const linked=linkedTokens(companion);
  if(linked.length>1)throw fail('Err.CompanionHasToken');
  const keepState=sameCompanion&&original.config.state!=='unbound'?original.config.state:null;
  const state=linked.length===1?'manifested':keepState&&keepState!=='manifested'?keepState:'dismissed';
  const newConfig=validateVestige({...DEFAULT_VESTIGE,...options,companionUuid:companion.uuid,state});
  if(newConfig.costMode==='spell')resolveCastingActivity(summoner,newConfig);
  if(linked.length===1&&linked[0].token.getFlag(ID,'summonerUuid')!==summoner.uuid)
    await linked[0].token.update({[`flags.${ID}.summonerUuid`]:summoner.uuid});
  await summoner.setFlag(ID,'vestige',newConfig);
  if(newConfig.grantOwnership)await shareCompanion(summoner,companion);
  return newConfig;
}
export async function unbindVestige(summoner){
  gmOnly();const inspection=await inspectVestige(summoner);
  if(inspection.tokens.length||inspection.config.state==='manifested'||inspection.config.state==='dormant')throw fail('Err.DismissFirst');
  await summoner.unsetFlag(ID,'vestige');
}
export function suggestCompanionPosition(summoner) {
  const scene=currentScene(),config=flags(summoner);
  return preflight(summoner,scene.id,undefined,config.state==='dormant'?'dormant':config.state).point;
}
async function placeToken(summoner,sceneId,point,expectedState){
  const {config,companion,scene,point:chosen}=preflight(summoner,sceneId,point,expectedState);
  transition(config.state,'manifested');
  if(expectedState!=='dormant'){
    // A new casting: the companion comes back at full HP (house rule). In 'vestige' mode its maximum
    // is the AU Vestige Companion's 4 + 4 × Warlock level.
    const max=config.hpMode==='vestige'?vestigeMaxHP(classLevel(summoner,'warlock')):Number(companion.system?.attributes?.hp?.max);
    if(!Number.isFinite(max)||max<1)throw fail('Err.MaxHP');
    await companion.update(config.hpMode==='vestige'?{'system.attributes.hp.max':max,'system.attributes.hp.value':max}:{'system.attributes.hp.value':max});
  }
  const doc=await companion.getTokenDocument({...chosen,actorLink:true});
  const data=doc.toObject();
  data.flags={...(data.flags??{}),[ID]:{...(data.flags?.[ID]??{}),summonerUuid:summoner.uuid}};
  if(config.lightPreset!=='none'&&isTokenLightPreset(config.lightPreset)){
    data.light=buildTokenLight(config.lightPreset,{units:scene.grid?.units,current:data.light??{},animations:globalThis.CONFIG?.Canvas?.lightAnimations});
    data.flags[ID].tokenLight=config.lightPreset;
  }
  const created=await scene.createEmbeddedDocuments('Token',[data]);
  if(created?.length!==1)throw fail('Err.TokenNotCreated');
  try{await summoner.setFlag(ID,'vestige',{...config,state:'manifested'});}
  catch(e){expectedDeletes.add(created[0].uuid);await scene.deleteEmbeddedDocuments('Token',[created[0].id]);throw e;}
  const kind=expectedState==='dormant'?'Return':'Manifest';
  try{await companionChat(summoner,companion,kind,expectedState==='dormant'?'Chat.CompanionReturns':'Chat.CompanionAppears',{companion:companion.name,scene:scene.name});}
  catch(error){console.warn(`${ID}: token created, but chat announcement failed`,error);}
  try{await syncCombat(summoner,created[0]);}catch(e){console.warn(`${ID} combat initiative:`,e);}
  return t(expectedState==='dormant'?'Companion.Returned':'Companion.Manifested',{companion:companion.name,scene:scene.name});
}
/** Public chat line: written in the world's text language, since everyone reads it. */
async function companionChat(summoner,companion,action,bodyKey,data){
  const title=tw('Chat.CompanionTitle',{action:tw(`Chat.CompanionAction.${action}`)});
  await ChatMessage.create({speaker:ChatMessage.getSpeaker({actor:summoner}),
    content:`<div class="planar-companion-chat"><strong>${foundry.utils.escapeHTML(title)}</strong><p>${foundry.utils.escapeHTML(tw(bodyKey,data))}</p></div>`});
}
async function removeTokens(tokens){
  for(const {scene,token} of tokens){expectedDeletes.add(token.uuid);
    try{await scene.deleteEmbeddedDocuments('Token',[token.id]);}
    catch(error){expectedDeletes.delete(token.uuid);throw error;}
  }
}
/** Carry out an action on this client (the GM's, except Command). The cost of Manifest is already paid. */
async function doAction(summoner,action,{point,sceneId}={}){
  return withLock(summoner,async()=>{
    const inspection=await inspectVestige(summoner),{config,companion,tokens}=inspection;
    validBound(summoner,config,companion);
    if(action==='manifest'){
      if(!['dismissed','destroyed'].includes(config.state))throw fail('Err.CannotManifest');
      return placeToken(summoner,sceneId??currentScene().id,point,config.state);
    }
    if(action==='return')return placeToken(summoner,sceneId??currentScene().id,point,'dormant');
    if(action==='recall'){
      transition(config.state,'dormant');
      if(tokens.length!==1)throw fail('Err.RecallOneToken');
      if(config.requireOutsideCombatRecall&&isCombatActive(game.combats,tokens[0].scene.id))throw fail('Err.RecallInCombat');
      await removeTokens(tokens);
      await summoner.setFlag(ID,'vestige',{...config,state:'dormant'});
      await companionChat(summoner,companion,'Recall','Chat.CompanionDormant',{companion:companion.name});
      return t('Companion.Recalled',{companion:companion.name});
    }
    if(action==='dismiss'||action==='destroy'){
      transition(config.state,action==='destroy'?'destroyed':'dismissed');
      await removeTokens(tokens);
      await summoner.setFlag(ID,'vestige',{...config,state:action==='destroy'?'destroyed':'dismissed'});
      await companionChat(summoner,companion,action==='destroy'?'Destroy':'Dismiss',
        action==='destroy'?'Chat.CompanionDestroyed':'Chat.CompanionDismissed',{companion:companion.name});
      return t(action==='destroy'?'Companion.Destroyed':'Companion.Dismissed',{companion:companion.name});
    }
    if(action==='command'){
      if(config.state!=='manifested')throw fail('Err.CommandNeedsManifest');
      const combat=combatOn(tokens[0]?.scene.id);
      const key=commandKey(combat),used=summoner.getFlag(ID,'companionCommand');
      if(key&&used===key)throw fail('Err.CommandUsed');
      if(key){
        const active=combat.combatant;
        if(active?.actor?.id!==summoner.id)throw fail('Err.CommandTurn');
        await summoner.setFlag(ID,'companionCommand',key);
      }
      await companionChat(summoner,companion,'Command','Chat.CompanionCommand',{summoner:summoner.name,companion:companion.name,cost:tw(`Cost.${config.commandCost}`)});
      return t('Companion.Commanded',{companion:companion.name,cost:t(`Cost.${config.commandCost}`)});
    }
    throw fail('Err.CompanionAction');
  });
}
async function syncCombat(summoner,token){
  if(!game.user.isGM)return;
  const combat=combatOn(token.parent?.id);
  if(!combat)return;
  const source=combat.combatants.find(c=>c.actor?.id===summoner.id);
  if(!source)return;
  const initiative=Number.isFinite(source.initiative)?source.initiative-0.01:null;
  let companionCombatant=combat.combatants.find(c=>c.tokenId===token.id);
  if(!companionCombatant){
    const created=await combat.createEmbeddedDocuments('Combatant',[{actorId:token.actorId,tokenId:token.id,sceneId:token.parent.id,initiative}]);
    companionCombatant=created?.[0];
  }else if(initiative!==null&&companionCombatant.initiative!==initiative){
    await companionCombatant.update({initiative});
  }
}

// ---- Paying for Manifest (on the caller's client) ----

/** Ask which slot to spend (Pact Magic first). Returns a slot key, or null if the player closed the dialog. */
async function chooseSlot(summoner,slots){
  const esc=v=>foundry.utils.escapeHTML(String(v));
  const label=s=>s.key==='pact'?t('Companion.SlotPact',{level:s.level,left:s.value,max:s.max}):t('Companion.SlotLevel',{level:s.level,left:s.value,max:s.max});
  const data=await foundry.applications.api.DialogV2.input({window:{title:t('Companion.PayTitle',{name:summoner.name})},
    content:`<div class="planar-form"><p>${t('Companion.PayHint')}</p><div class="form-group"><label>${esc(t('Companion.Slot'))}</label><select name="slot">${slots.map((s,i)=>`<option value="${esc(s.key)}" ${i===0?'selected':''}>${esc(label(s))}</option>`).join('')}</select></div></div>`,
    rejectClose:false,ok:{label:t('Companion.Action.manifest')}});
  const key=data?.slot??data?.get?.('slot');
  return key?String(key):null;
}
/**
 * Pay the cost of a new casting. Returns {key,value} for a slot the module spent (so it can be given back),
 * {} for a spell cast through the sheet or a free manifestation, or null if the player cancelled.
 */
async function payForManifest(summoner,config,{slotKey}={}){
  if(config.costMode==='free')return {};
  if(config.costMode==='spell'){
    const activity=resolveCastingActivity(summoner,config);
    const before=slotSnapshot(summoner);
    const used=await activity.use();
    if(!used)return null;
    if(!consumedExactlyOneSlot(before,slotSnapshot(summoner)))ui.notifications?.warn?.(t('Note.NoSlotSeen',{name:summoner.name}));
    return {};
  }
  const slots=availableSlots(summoner);
  if(!slots.length)throw fail('Err.NoSlotLeft',{name:summoner.name});
  const key=slotKey??await chooseSlot(summoner,slots);
  if(!key)return null;
  const slot=slots.find(s=>s.key===key);
  if(!slot)throw fail('Err.NoSlotLeft',{name:summoner.name});
  await summoner.update({[`system.spells.${key}.value`]:slot.value-1});
  return {key,value:slot.value};
}
async function refundSlot(summoner,paid){
  if(!paid?.key)return false;
  try{await summoner.update({[`system.spells.${paid.key}.value`]:paid.value});return true;}
  catch(error){console.error(`${ID}: could not give the slot back`,error);return false;}
}

// ---- Player → GM ----

function gmClient(){const gm=game.users.activeGM;if(!gm?.active)throw fail('Err.NeedActiveGM');return gm;}
async function askGM(data){
  const gm=gmClient();
  const result=await gm.query(GM_QUERY,{...data,userId:game.user.id},{timeout:120000});
  if(!result?.ok)throw new Error(result?.error||t('Err.GMPlaceFailed'));
  return result.message;
}
/**
 * The GM's side of a player's request. Foundry's query doesn't name the sender, so the request carries the
 * user id and the GM checks that this user owns the hero (fine for a table of friends; turn on
 * "companionApproval" to confirm every request by hand).
 */
async function handleGMRequest(request){
  gmOnly(); if(!coordinator())throw fail('Err.ActiveGMOnly');
  const {action,summonerUuid,userId,point,sceneId}=request??{};
  validateRequestShape({action,summonerUuid,...(point?{point}:{})});
  if(!PLAYER_ACTIONS.includes(action))throw fail('Err.PlayerActionDenied');
  const summoner=await fromUuid(summonerUuid);
  if(!worldActor(summoner))throw fail('Err.WorldActorMissing');
  const user=game.users.get?.(userId);
  if(!user||!isAuthorizedOwner(summoner,user))throw fail('Err.SummonerOwner');
  const config=flags(summoner);
  if(!config.enabled||!config.allowPlayerControls)throw fail('Err.PlayerControlsOff');
  if(approvalRequired()){
    const companion=companionOf(config);
    const esc=v=>foundry.utils.escapeHTML(String(v??'?'));
    const approved=await foundry.applications.api.DialogV2.confirm({window:{title:t('Companion.ApproveActionTitle')},
      content:`<p>${t('Companion.ApproveAction',{user:esc(user.name),action:t(`Companion.Action.${action}`),summoner:esc(summoner.name),companion:esc(companion?.name)})}</p>`,rejectClose:false,modal:true});
    if(!approved)return {ok:false,error:t('Err.GMDeclined')};
  }
  return {ok:true,message:await doAction(summoner,action,{point,sceneId})};
}
export function registerCompanionQueries(record){
  CONFIG.queries[GM_QUERY]=async(data)=>{try{return await handleGMRequest(data);}catch(error){record?.(`Companion query error: ${cleanError(error)}`);return {ok:false,error:cleanError(error)};}};
}

/**
 * The one entry point for windows, the Token HUD and macros: performCompanionAction(hero, action).
 * Actions: manifest, return, recall, dismiss, command (owner or GM); destroy (GM).
 * Options: point {x,y} (else the nearest free square by the hero), slotKey ('pact', 'spell1'…; else asked).
 */
export async function performCompanionAction(summoner,action,{point,slotKey}={}){
  if(!isAuthorizedOwner(summoner,game.user))throw fail('Err.SummonerOwner');
  if(!ALLOWED_ACTIONS.includes(action))throw fail('Err.CompanionAction');
  const config=flags(summoner);
  if(!config.companionUuid||!config.enabled)throw fail('Err.NoBinding');
  if(!game.user.isGM&&!config.allowPlayerControls)throw fail('Err.PlayerControlsOff');
  if(action==='destroy'&&!game.user.isGM)throw fail('Err.GMDestroy');
  if(action==='command')return doAction(summoner,'command');
  if(action==='manifest'||action==='return'){
    const scene=currentScene();
    const expected=action==='return'?'dormant':config.state;
    if(action==='manifest'&&!['dismissed','destroyed'].includes(config.state))throw fail('Err.CannotManifest');
    // Check placement before anything is paid.
    const checked=preflight(summoner,scene.id,point,expected);
    const paid=action==='manifest'?await payForManifest(summoner,config,{slotKey}):{};
    if(!paid)return '';
    try{
      if(game.user.isGM)return await doAction(summoner,action,{point:checked.point,sceneId:scene.id});
      return await askGM({action,summonerUuid:summoner.uuid,sceneId:scene.id,point:checked.point});
    }catch(error){
      if(await refundSlot(summoner,paid))throw new Error(cleanError(error)+' '+t('Companion.SlotRefunded'));
      throw error;
    }
  }
  if(game.user.isGM)return doAction(summoner,action);
  return askGM({action,summonerUuid:summoner.uuid});
}
/**
 * GM-only repair: a dormant companion at 0 HP becomes destroyed; a manifested one without a token becomes
 * dismissed; a companion standing on a scene without the module knowing it is adopted as manifested.
 */
export async function repairCompanionState(summoner){
  gmOnly();
  return withLock(summoner,async()=>{
    const {config,tokens,companion}=await inspectVestige(summoner);
    if(config.state==='dormant'&&Number(companion?.system?.attributes?.hp?.value)<=0){
      await summoner.setFlag(ID,'vestige',{...config,state:'destroyed'});
      return t('Companion.RepairedDestroyed');
    }
    if(config.state==='manifested'&&tokens.length===0){
      const linked=companion?linkedTokens(companion):[];
      if(linked.length===1){await linked[0].token.update({[`flags.${ID}.summonerUuid`]:summoner.uuid});return t('Companion.RepairedAdopted');}
      await summoner.setFlag(ID,'vestige',{...config,state:'dismissed'});
      return t('Companion.RepairedDismissed');
    }
    if(config.state!=='manifested'&&companion){
      const linked=linkedTokens(companion);
      if(linked.length===1){
        await linked[0].token.update({[`flags.${ID}.summonerUuid`]:summoner.uuid});
        await summoner.setFlag(ID,'vestige',{...config,state:'manifested'});
        return t('Companion.RepairedAdopted');
      }
    }
    throw fail('Err.NoRepair');
  });
}
/**
 * The summoner died: a companion bound with vanishOnDeath disappears (AU: "It vanishes if you die").
 * It needs a new casting afterwards. Runs on the coordinating GM only.
 */
export async function vanishWithSummoner(summoner){
  if(!coordinator()||!worldActor(summoner))return null;
  const config=flags(summoner);
  if(!config.companionUuid||!config.vanishOnDeath||!['manifested','dormant'].includes(config.state))return null;
  return withLock(summoner,async()=>{
    const companion=await fromUuid(config.companionUuid);
    transition(config.state,'dismissed');
    await removeTokens(findTokens(summoner));
    await summoner.setFlag(ID,'vestige',{...config,state:'dismissed'});
    await companionChat(summoner,companion,'Vanish','Chat.CompanionVanishes',{companion:companion?.name??'?',summoner:summoner.name});
    return t('Companion.Vanished',{companion:companion?.name??'?'});
  });
}
/** Heroes this user may control a companion for (GM: every bound hero). */
export function companionHeroes(user=game.user){
  return game.actors.contents.filter(a=>a.getFlag(ID,'vestige')?.companionUuid&&(user.isGM||a.testUserPermission(user,'OWNER')));
}
/** The hero a token belongs to as companion, or the token's own actor if it is a bound hero. */
export function heroForToken(tokenDoc){
  const summonerUuid=tokenDoc?.getFlag?.(ID,'summonerUuid');
  if(summonerUuid)return game.actors.get(String(summonerUuid).split('.')[1])??null;
  const actor=tokenDoc?.actor;
  return actor?.getFlag?.(ID,'vestige')?.companionUuid?game.actors.get(actor.id)??null:null;
}

/** Keep legacy GM API surface. */
export async function manifestVestige(summoner,options){gmOnly();return performCompanionAction(summoner,'manifest',options);}
export async function returnVestige(summoner){gmOnly();return performCompanionAction(summoner,'return');}
export async function recallVestige(summoner){gmOnly();return performCompanionAction(summoner,'recall');}
export async function dismissVestige(summoner){gmOnly();return performCompanionAction(summoner,'dismiss');}
export async function destroyVestige(summoner){gmOnly();return performCompanionAction(summoner,'destroy');}

export function watchCompanions(record){
  // Reconcile destruction once after the GM reconnects, including HP updates made while offline.
  if(coordinator()) Promise.resolve().then(async()=>{
    for(const summoner of game.actors){
      const config=flags(summoner);
      if(config.state!=='manifested')continue;
      const companion=await fromUuid(config.companionUuid);
      const hp=companion?.system?.attributes?.hp?.value;
      if(Number.isFinite(hp)&&hp<=0){
        try{record(await destroyVestige(summoner));}catch(e){record(`Reconciliation: ${cleanError(e)}`);}
      }
    }
  });
  Hooks.on('updateActor',async actor=>{
    const hp=actor.system?.attributes?.hp?.value;
    if(!coordinator()||!Number.isFinite(hp)||hp>0)return;
    for(const summoner of game.actors){
      if(flags(summoner).companionUuid!==actor.uuid||flags(summoner).state!=='manifested')continue;
      try{record(await destroyVestige(summoner));}catch(e){record(`Companion destruction: ${cleanError(e)}`);}
    }
  });
  Hooks.on('deleteToken',async token=>{
    if(!coordinator())return;
    if(expectedDeletes.has(token.uuid)){expectedDeletes.delete(token.uuid);return;}
    const summonerUuid=token.getFlag(ID,'summonerUuid');
    if(!summonerUuid)return;
    const summoner=await fromUuid(summonerUuid);
    if(!worldActor(summoner)||flags(summoner).state!=='manifested')return;
    try{await summoner.setFlag(ID,'vestige',{...flags(summoner),state:'dismissed'});
      record(`Token ${token.id} manually deleted; ${summoner.name} companion marked dismissed`);
    }catch(e){record(`Token deletion repair failed: ${cleanError(e)}`);}
  });
  // The summoner's death: Planar Glitch's record, or the Dead (defeated) status on the summoner.
  const onDeath=actor=>{if(actor)void vanishWithSummoner(actor).then(msg=>msg&&record(msg)).catch(e=>record(`Companion vanish: ${cleanError(e)}`));};
  Hooks.on('planar-glitch.death',rec=>onDeath(game.actors.get(rec?.actorId)));
  Hooks.on('createActiveEffect',effect=>{
    const actor=effect?.parent;
    if(actor?.documentName!=='Actor'||!effect.statuses?.has?.(globalThis.CONFIG?.specialStatusEffects?.DEFEATED??'dead'))return;
    onDeath(actor);
  });
  Hooks.on('updateCombatant',async combatant=>{
    if(!coordinator()||!Number.isFinite(combatant.initiative))return;
    for(const summoner of game.actors){
      if(combatant.actor?.id!==summoner.id||flags(summoner).state!=='manifested')continue;
      const companion=await fromUuid(flags(summoner).companionUuid);
      const found=findTokens(summoner).find(tok=>tok.scene.id===combatant.parent?.scene?.id);
      if(!companion||!found)return;
      try{await syncCombat(summoner,found.token);}catch(e){record(`Combat initiative sync: ${cleanError(e)}`);}
    }
  });
}
