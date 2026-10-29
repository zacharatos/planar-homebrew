import {ID,RULES,DEFAULT_VESTIGE} from '../core/constants.mjs';
import {t,tw,fail} from '../i18n.mjs';
import {validateVestige,nearestVacant,isCombatActive} from '../core/validation.mjs';
import {transition} from '../core/state.mjs';
import {ALLOWED_ACTIONS,LIGHT_PRESETS,slotSnapshot,consumedExactlyOneSlot,isAuthorizedOwner,validateRequestShape,
  validateTokenPosition,commandKey,vestigeMaxHP,classLevel} from '../core/companion-helpers.mjs';

/** Bound Companion: only explicitly configured world Actors; no arbitrary token creation API. */
export const vestigeRule=Object.freeze({id:RULES.VESTIGE,name:'Rule.Companion.Name',target:'Rule.Companion.Target',description:'Rule.Companion.Hint'});
const pending=new Set();
const expectedDeletes=new Set();
const reservations=new Map(); // Transient GM reservations for preflight → native cast → placement.
const GM_QUERY=`${ID}.companionRequest`;
const MAX_RESERVATION_AGE=120_000;
const cleanError=error=>String(error?.message??error);
const gmOnly=()=>{if(!game.user.isGM)throw fail('Err.GMAuthorize');};
const coordinator=()=>game.users.activeGM?.id===game.user.id;
const flags=actor=>({...DEFAULT_VESTIGE,...(actor?.getFlag(ID,'vestige')??{})});
const worldActor=a=>a && a.parent==null && game.actors.get(a.id)===a;
const currentScene=()=>{if(!canvas?.scene)throw fail('Err.OpenScene');return canvas.scene;};
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
  return (canvas.scene?.id===scene.id ? canvas.tokens?.controlled?.map(tok=>tok.document).find(tok=>tok.actorId===summoner.id) : null)??
    scene.tokens.find(tok=>tok.actorId===summoner.id);
}
export function resolveCastingActivity(summoner, config) {
  if (!config.requireCasting) return null;
  const item=summoner.items.find(i=>i.uuid===config.castingItemUuid);
  if(!item || item.type!=='spell')throw fail('Err.ChooseSpell');
  const activity=item.system?.activities?.get?.(config.castingActivityId);
  if(!activity || typeof activity.use!=='function')throw fail('Err.ActivityUnusable');
  if(activity.type==='summon')throw fail('Err.NoSummonActivity');
  return activity;
}
function preflight(summoner,sceneId,point,stateExpected) {
  const config=flags(summoner);
  const companion=game.actors.get(config.companionUuid?.split('.')[1]);
  validBound(summoner,config,companion);
  if(stateExpected==='dormant'&&Number(companion.system?.attributes?.hp?.value)<=0)throw fail('Err.ZeroHPReturn');
  // In 'vestige' mode every manifestation restores full HP, so a 0 HP vestige may be cast again.
  if(stateExpected==='dismissed'&&config.hpMode!=='vestige'&&Number(companion.system?.attributes?.hp?.value)<=0)throw fail('Err.ZeroHPCast');
  if(stateExpected==='destroyed'&&(!Number.isFinite(Number(companion.system?.attributes?.hp?.max))||Number(companion.system?.attributes?.hp?.max)<1))throw fail('Err.MaxHP');
  if(config.state!==stateExpected)throw fail('Err.WrongState',{state:t(`State.${config.state}`),expected:t(`State.${stateExpected}`)});
  if(findTokens(summoner).length||linkedTokens(companion).length)throw fail('Err.TokenExists');
  const scene=game.scenes.get(sceneId);
  if(!scene)throw fail('Err.SceneMissing');
  const anchor=getAnchor(summoner,scene);
  if(!anchor)throw fail('Err.PlaceNamed',{name:summoner.name});
  const step=Number(scene.grid?.size),feet=Number(scene.grid?.distance);
  const width=(Number(companion.prototypeToken?.width)||1)*step;
  const height=(Number(companion.prototypeToken?.height)||1)*step;
  const occupied=[...scene.tokens].map(tok=>({x:tok.x,y:tok.y,w:(tok.width||1)*step,h:(tok.height||1)*step}));
  const bounds=scene.dimensions;
  const chosen=validateTokenPosition({point,anchor,width,height,step,gridFeet:feet,rangeFeet:config.range,
    sceneWidth:Number(bounds?.width),sceneHeight:Number(bounds?.height),occupied});
  if(stateExpected==='dormant'&&config.requireOutsideCombatRecall&&combatOn(scene.id))throw fail('Err.ReturnInCombat');
  return {config,companion,scene,point:chosen};
}
function clearExpiredReservations(){
  for(const [key,r] of reservations)if(Date.now()-r.created>MAX_RESERVATION_AGE)reservations.delete(key);
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
  if(config.requireCasting){try{resolveCastingActivity(summoner,config);}catch(e){errors.push(e.message);}}
  return {config,companion,tokens,errors};
}
export async function bindVestige(summoner,companion,options={}){
  gmOnly();
  if(!worldActor(summoner)||!worldActor(companion))throw fail('Err.SelectWorldActors');
  if(summoner.id===companion.id)throw fail('Err.SameActor');
  const original=await inspectVestige(summoner);
  if(original.tokens.length||original.config.state==='manifested')throw fail('Err.DismissFirst');
  const other=game.actors.contents.find(a=>a.id!==summoner.id&&a.getFlag(ID,'vestige')?.companionUuid===companion.uuid);
  if(other)throw fail('Err.AlreadyBound',{name:other.name});
  if(linkedTokens(companion).length)throw fail('Err.CompanionHasToken');
  const newConfig=validateVestige({...DEFAULT_VESTIGE,...options,companionUuid:companion.uuid,state:'dismissed'});
  if(newConfig.requireCasting)resolveCastingActivity(summoner,newConfig);
  await summoner.setFlag(ID,'vestige',newConfig);
  return newConfig;
}
export async function unbindVestige(summoner){
  gmOnly();const inspection=await inspectVestige(summoner);
  if(inspection.tokens.length||inspection.config.state==='manifested'||inspection.config.state==='dormant')throw fail('Err.DismissFirst');
  await summoner.unsetFlag(ID,'vestige');
}
export function suggestCompanionPosition(summoner) {
  const scene=currentScene(),config=flags(summoner);
  const companion=game.actors.get(config.companionUuid?.split('.')[1]);
  validBound(summoner,config,companion);
  const anchor=getAnchor(summoner,scene);
  if(!anchor)throw fail('Err.PlaceSummoner');
  const step=Number(scene.grid.size),feet=Number(scene.grid.distance);
  const occupied=[...scene.tokens].map(tok=>({x:tok.x,y:tok.y,w:(tok.width||1)*step,h:(tok.height||1)*step}));
  const found=nearestVacant({anchor,occupied,width:(companion.prototypeToken.width||1)*step,
    height:(companion.prototypeToken.height||1)*step,step,maxDistancePixels:config.range/feet*step});
  if(!found)throw fail('Err.NoFreeSpace');
  return found;
}
async function placeToken(summoner,sceneId,point,expectedState){
  const {config,companion,scene,point:chosen}=preflight(summoner,sceneId,point,expectedState);
  transition(config.state,'manifested');
  if(config.hpMode==='vestige'&&expectedState!=='dormant'){
    // Manifest Vestige: the vestige comes out with the AU stat block's HP for the warlock's level, at full HP.
    const max=vestigeMaxHP(classLevel(summoner,'warlock'));
    await companion.update({'system.attributes.hp.max':max,'system.attributes.hp.value':max});
  }else if(expectedState==='destroyed'){
    const max=Number(companion.system?.attributes?.hp?.max);
    if(!Number.isFinite(max)||max<1)throw fail('Err.MaxHP');
    await companion.update({'system.attributes.hp.value':max});
  }
  const doc=await companion.getTokenDocument({ ...chosen,actorLink:true,
    light:LIGHT_PRESETS[config.lightPreset],flags:{[ID]:{summonerUuid:summoner.uuid}} });
  const created=await scene.createEmbeddedDocuments('Token',[doc.toObject()]);
  if(created?.length!==1)throw fail('Err.TokenNotCreated');
  try{await summoner.setFlag(ID,'vestige',{...config,state:'manifested'});}
  catch(e){expectedDeletes.add(created[0].uuid);await scene.deleteEmbeddedDocuments('Token',[created[0].id]);throw e;}
  try{await companionChat(summoner,companion,'Manifest','Chat.CompanionAppears',{companion:companion.name,scene:scene.name});}
  catch(error){console.warn(`${ID}: token created, but chat announcement failed`,error);}
  try{await syncCombat(summoner,created[0]);}catch(e){console.warn(`${ID} combat initiative:`,e);}
  return t('Companion.Manifested',{companion:companion.name,scene:scene.name});
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
async function actAsGM(summoner,action,point,sceneId){
  return withLock(summoner,async()=>{
    const inspection=await inspectVestige(summoner),{config,companion,tokens}=inspection;
    validBound(summoner,config,companion);
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
  const combat=combatOn(token.parent.id);
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
async function nativeCast(summoner,config){
  if(!config.requireCasting)return;
  const activity=resolveCastingActivity(summoner,config);
  const before=slotSnapshot(summoner);
  let consumptionHookSeen=false;
  const callback=(usedActivity)=>{
    if(usedActivity?.item?.uuid===activity.item.uuid && usedActivity?.id===activity.id) consumptionHookSeen=true;
  };
  Hooks.on('dnd5e.postActivityConsumption',callback);
  try{await activity.use();}
  finally{Hooks.off('dnd5e.postActivityConsumption',callback);}
  const after=slotSnapshot(summoner);
  if(!consumptionHookSeen || !consumedExactlyOneSlot(before,after)) {
    throw fail('Err.NoSlotSpent');
  }
}
function gmClient(){const gm=game.users.activeGM;if(!gm?.active)throw fail('Err.NeedActiveGM');return gm;}
async function queryGM(data){
  const gm=gmClient();
  if(game.user.id===gm.id)return handleGMRequest(data);
  return gm.query(GM_QUERY,data,{timeout:120000});
}
async function requestGMApproval(summoner,action,point){
  const gm=gmClient();
  if(game.user.id===gm.id)return;
  const ok=await queryGM({phase:'approval',action,summonerUuid:summoner.uuid,point});
  if(!ok?.approved)throw fail('Err.GMDeclined');
}
/** A user-query handler cannot authenticate the initiator. A GM must explicitly authorize requests. */
async function handleGMRequest(request){
  gmOnly(); if(!coordinator())throw fail('Err.ActiveGMOnly');
  clearExpiredReservations();
  const {phase,action,summonerUuid,point,nonce,sceneId}=request??{};
  if(phase==='cancel'){
    const entry=reservations.get(summonerUuid);
    if(entry?.nonce===nonce)reservations.delete(summonerUuid);
    return {cancelled:true};
  }
  validateRequestShape({action,summonerUuid,...(point?{point}:{})});
  const summoner=await fromUuid(summonerUuid);
  if(!worldActor(summoner))throw fail('Err.WorldActorMissing');
  const config=flags(summoner);
  if(!config.allowPlayerControls)throw fail('Err.PlayerControlsOff');
  // As Foundry's query API does not authenticate the requesting user, NO player request silently executes.
  // The GM authorizes this configured Actor/action explicitly, never an arbitrary target or document update.
  if(phase==='prepare'){
    if(action!=='manifest')throw fail('Err.QueryPhase');
    if(reservations.has(summonerUuid))throw fail('Err.AlreadyReserved');
    if(!['dismissed','destroyed'].includes(config.state))throw fail('Err.CannotManifest');
    const checked=preflight(summoner,sceneId,point,config.state);
    const approved=await foundry.applications.api.DialogV2.confirm({window:{title:t('Companion.ApproveManifestTitle')},
      content:`<p>${t('Companion.ApproveManifest',{companion:foundry.utils.escapeHTML(checked.companion.name),summoner:foundry.utils.escapeHTML(summoner.name),scene:foundry.utils.escapeHTML(checked.scene.name)})}</p><p>${t('Companion.ApproveManifestHint')}</p>`,rejectClose:false,modal:true});
    if(!approved)return {approved:false};
    const tokenNonce=foundry.utils.randomID();
    reservations.set(summonerUuid,{nonce:tokenNonce,created:Date.now(),sceneId,point:checked.point,
      before:slotSnapshot(summoner),expectedState:config.state,castingRequired:config.requireCasting});
    return {approved:true,nonce:tokenNonce};
  }
  if(phase==='commit'){
    if(action!=='manifest')throw fail('Err.QueryPhase');
    const reservation=reservations.get(summonerUuid);
    if(!reservation||reservation.nonce!==nonce)throw fail('Err.ReservationMissing');
    reservations.delete(summonerUuid);
    if(Date.now()-reservation.created>MAX_RESERVATION_AGE)throw fail('Err.ReservationMissing');
    if(reservation.castingRequired&&!consumedExactlyOneSlot(reservation.before,slotSnapshot(summoner))) {
      throw fail('Err.GMSlotCheck');
    }
    return {message:await withLock(summoner,()=>placeToken(summoner,reservation.sceneId,reservation.point,reservation.expectedState))};
  }
  if(phase==='approval'){
    if(action==='manifest')throw fail('Err.ManifestNative');
    if(!['return','recall','dismiss'].includes(action))throw fail('Err.PlayerActionDenied');
    if(!config.enabled || !config.allowPlayerControls)throw fail('Err.PlayerControlsOff');
    const checked=await inspectVestige(summoner);
    if(!checked.companion)throw fail('Err.CompanionMissing');
    // Permission-sensitive operations always require explicit GM approval, never trust claimed userIds.
    const approved=await foundry.applications.api.DialogV2.confirm({window:{title:t('Companion.ApproveActionTitle')},
      content:`<p>${t('Companion.ApproveAction',{action:t(`Companion.Action.${action}`),summoner:foundry.utils.escapeHTML(summoner.name),companion:foundry.utils.escapeHTML(checked.companion.name)})}</p><p>${t('Companion.ApproveActionHint')}</p>`,rejectClose:false,modal:true});
    if(!approved)return {approved:false};
    const message=await actAsGM(summoner,action,point,sceneId);
    return {approved:true,message};
  }
  throw fail('Err.QueryPhase');
}
export function registerCompanionQueries(record){
  CONFIG.queries[GM_QUERY]=async(data)=>{try{return await handleGMRequest(data);}catch(error){record?.(`Companion query error: ${cleanError(error)}`);return {approved:false,error:cleanError(error)};}};
}
/** Safe, player-facing entry point. Calls native dnd5e spell Activity for Manifest. */
export async function performCompanionAction(summoner,action,{point}={}){
  if(!isAuthorizedOwner(summoner,game.user))throw fail('Err.SummonerOwner');
  if(!ALLOWED_ACTIONS.includes(action))throw fail('Err.CompanionAction');
  const config=flags(summoner);
  if(!config.companionUuid||!config.enabled)throw fail('Err.NoBinding');
  if(!game.user.isGM&&!config.allowPlayerControls)throw fail('Err.PlayerControlsOff');
  if(action==='destroy'&&!game.user.isGM)throw fail('Err.GMDestroy');
  if(action==='manifest'){
    const scene=currentScene();
    const chosen=point??suggestCompanionPosition(summoner);
    if(!['destroyed','dismissed'].includes(config.state))throw fail('Err.CannotManifest');
    preflight(summoner,scene.id,chosen,config.state);
    if(game.user.isGM){
      return withLock(summoner,async()=>{
        if(config.requireCasting)await nativeCast(summoner,config);
        return placeToken(summoner,scene.id,chosen,config.state);
      });
    }
    const permissionGranted=await queryGM({phase:'prepare',action,summonerUuid:summoner.uuid,
      sceneId:scene.id,point:chosen});
    if(!permissionGranted?.approved)throw new Error(permissionGranted?.error||t('Err.GMDidNotAuthorize'));
    try{
      await nativeCast(summoner,config);
      const result=await queryGM({phase:'commit',action,summonerUuid:summoner.uuid,nonce:permissionGranted.nonce});
      if(!result?.message)throw new Error(result?.error||t('Err.GMPlaceFailed'));
      return result.message;
    }catch(error){
      try{await queryGM({phase:'cancel',summonerUuid:summoner.uuid,nonce:permissionGranted.nonce});}catch{ /* GM offline */ }
      throw error;
    }
  }
  // Command is an ordinary owner-authorized Actor flag/chat action, never a privileged token mutation.
  if(action==='command')return actAsGM(summoner,'command');
  if(action==='return'){
    const scene=currentScene(),chosen=point??suggestCompanionPosition(summoner);
    preflight(summoner,scene.id,chosen,'dormant');
    if(game.user.isGM)return actAsGM(summoner,'return',chosen,scene.id);
  }else if(game.user.isGM)return actAsGM(summoner,action,point);
  const result=await queryGM({phase:'approval',action,summonerUuid:summoner.uuid,point,sceneId:action==='return'?currentScene().id:undefined});
  if(!result?.approved)throw new Error(result?.error||t('Err.GMDeclined'));
  return result.message;
}
/** GM-only repair for the common stale-state case (token was deleted while no GM was online). */
export async function repairCompanionState(summoner){
  gmOnly();
  return withLock(summoner,async()=>{
    const {config,tokens,companion}=await inspectVestige(summoner);
    if(config.state==='dormant'&&Number(companion?.system?.attributes?.hp?.value)<=0){
      await summoner.setFlag(ID,'vestige',{...config,state:'destroyed'});
      return t('Companion.RepairedDestroyed');
    }
    if(config.state==='manifested'&&tokens.length===0){
      await summoner.setFlag(ID,'vestige',{...config,state:'dismissed'});
      return t('Companion.RepairedDismissed');
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

/** Keep legacy GM API surface. */
export async function manifestVestige(summoner){gmOnly();return performCompanionAction(summoner,'manifest');}
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
