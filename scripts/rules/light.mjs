import {ID,RULES} from '../core/constants.mjs';
import {t,fail} from '../i18n.mjs';
import {LIGHT_PRESETS,classifyLightItem,classifyLightSource,validateLightConfig,createLightState,burnElapsed,canIgnite,decrementIgnition,renderTokenLight} from '../core/light-presets.mjs';

export const lightRule=Object.freeze({id:RULES.LIGHT,name:'Rule.Light.Name',target:'Rule.Light.Target',description:'Rule.Light.Hint'});
export {LIGHT_PRESETS,classifyLightItem,classifyLightSource,validateLightConfig};
const inflight=new Set();
const report=(message)=>ui.notifications?.warn?.(message);
const currentTime=()=>Number(game.time?.worldTime??0);
const fromUuidSafe=async uuid=>uuid?fromUuid(uuid).catch(()=>null):null;
const flag=item=>item.getFlag(ID,'portableLight');
const stored=item=>{const record=flag(item);if(!record)return null;const config=validateLightConfig(record.config??{});return {config,state:createLightState(config,record.state??{})};};
const owned=(doc)=>Boolean(game.user?.isGM||doc?.testUserPermission?.(game.user,'OWNER'));
const tokenCanUpdate=token=>Boolean(game.user?.isGM||token?.canUserModify?.(game.user,'update'));
const findItem=(uuid)=>fromUuidSafe(uuid);
const getToken=async uuid=>{const token=await fromUuidSafe(uuid);return token?.documentName==='Token'?token:null;};
const lightObject=token=>token?.light?.toObject?.()??token?.toObject?.()?.light??{};
const matchingLight=(a,b)=>{
  if(!a||!b)return false;
  const approximate=(x,y)=>Math.abs(Number(x??0)-Number(y??0))<0.001;
  return ['bright','dim','angle','luminosity','alpha'].every(k=>approximate(a[k],b[k]))&&String(a.color??'').toLowerCase()===String(b.color??'').toLowerCase()&&String(a.animation?.type??'none')===String(b.animation?.type??'none');
};

/** GM-assigned or self-provisioned compatible item. Never interpret arbitrary item names as rules. */
export async function getLightAssignment(item,{discover=false}={}){
  const existing=stored(item);if(existing)return existing;
  if(!discover||!item?.parent||!['equipment','consumable','loot','tool','weapon','spell'].includes(item.type))return null;
  const preset=classifyLightSource(item);
  if(!preset)return null;
  const config=validateLightConfig({preset});
  return {config,state:createLightState(config)};
}
export async function assignPortableLight(item,options={}){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  if(!item?.parent?.items)throw fail('Err.OwnedItem');
  const previous=stored(item),config=validateLightConfig(options);
  if(previous?.state.litTokenUuid)throw fail('Err.ExtinguishFirst');
  const state=createLightState(config,options.preserveState?previous?.state??{}:{});
  await item.setFlag(ID,'portableLight',{config,state});
  return config;
}
export async function removePortableLight(item){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  if(stored(item)?.state.litTokenUuid)throw fail('Err.ExtinguishFirst');
  await item.unsetFlag(ID,'portableLight');
}
const localLocks=async (key,fn)=>{if(inflight.has(key))throw fail('Err.LightBusy');inflight.add(key);try{return await fn();}finally{inflight.delete(key);}};
const ensureItem=(item)=>{
  if(!item?.parent?.items)throw fail('Err.OwnedItem');
  if(!owned(item.parent))throw fail('Err.NotOwner');
};
function findTokenForActor(actor,requested){
  const scene=canvas?.scene;
  if(!scene)throw fail('Err.OpenScene');
  const candidates=[...scene.tokens].filter(tok=>tok.actorId===actor.id);
  let token;
  if(requested){token=candidates.find(tok=>tok.uuid===requested||tok.id===requested);if(!token)throw fail('Err.TokenNotHere');}
  else {
    const selected=(canvas.tokens?.controlled??[]).map(tok=>tok.document).filter(tok=>tok.actorId===actor.id);
    if(selected.length>1)throw fail('Err.OneToken');
    token=selected[0]??(candidates.length===1?candidates[0]:null);
  }
  if(!token)throw fail('Err.SelectToken');
  if(!tokenCanUpdate(token))throw fail('Err.TokenPermission');
  return token;
}
async function commit(item,config,state){await item.setFlag(ID,'portableLight',{config,state});}
async function activeLightOfToken(token){return token.getFlag(ID,'activePortableLight');}
async function turnOff(item,{token=null,quiet=false}={}){
  const entry=stored(item);if(!entry)return t('Light.NotAssigned');
  const {config}=entry;let state=entry.state;
  if(!state.litTokenUuid)return t('Light.AlreadyOff',{item:item.name});
  token??=await getToken(state.litTokenUuid);
  if(!token){state={...burnElapsed(state,currentTime()),litTokenUuid:'',startedAt:null};await commit(item,config,state);return t('Light.OffMissingToken',{item:item.name});}
  if(!tokenCanUpdate(token))throw fail('Err.TokenPermission');
  const active=await activeLightOfToken(token);
  if(active?.itemUuid!==item.uuid)throw fail('Err.OtherLight');
  const now=currentTime();state=burnElapsed(state,now);
  const changedExternally=!matchingLight(lightObject(token),active.applied);
  if(changedExternally){
    await token.unsetFlag(ID,'activePortableLight');
  }else{
    // Full replacement restores even zero/removed light fields, without preserving animation from this item.
    await token.update({light:foundry.utils.deepClone(active.original)});
    await token.unsetFlag(ID,'activePortableLight');
  }
  state={...state,litTokenUuid:'',startedAt:null};
  await commit(item,config,state);
  if(changedExternally&&!quiet)report(t('Light.ChangedExternally'));
  return t('Light.Off',{item:item.name,left:config.maxIgnitions===0?'∞':state.remainingIgnitions});
}
export async function extinguishPortableLight(item,options={}){
  ensureItem(item);
  return localLocks(item.uuid,()=>turnOff(item,options));
}
export async function ignitePortableLight(item,{tokenUuid='',automatic=false}={}){
  ensureItem(item);
  return localLocks(item.uuid,async()=>{
    let assignment=await getLightAssignment(item,{discover:true});
    if(!assignment)throw fail('Err.NoLightRule');
    let {config,state}=assignment;
    if(!config.enabled)throw fail('Err.LightDisabled');
    const token=findTokenForActor(item.parent,tokenUuid);
    if(state.litTokenUuid){
      const old=await getToken(state.litTokenUuid);
      if(old){if(old.uuid===token.uuid)return automatic?t('Light.AlreadyLit',{item:item.name}):turnOff(item,{token});
        throw fail('Err.LitElsewhere');}
      state={...burnElapsed(state,currentTime()),litTokenUuid:'',startedAt:null};
    }
    if(!canIgnite(config,state))throw fail('Err.Exhausted',{item:item.name});
    const previous=await activeLightOfToken(token);
    if(previous?.itemUuid&&previous.itemUuid!==item.uuid){
      const oldItem=await findItem(previous.itemUuid);
      if(!oldItem||oldItem.parent?.uuid!==item.parent.uuid)throw fail('Err.OtherLight');
      await extinguishPortableLight(oldItem,{token,quiet:true});
    }
    const original=lightObject(token);
    const applied=renderTokenLight(config,canvas.scene?.grid?.units??'ft');
    const next=decrementIgnition(config,state);
    next.litTokenUuid=token.uuid;
    next.startedAt=currentTime();
    await token.update({light:applied,[`flags.${ID}.activePortableLight`]:{itemUuid:item.uuid,original:foundry.utils.deepClone(original),applied}});
    try{await commit(item,config,next);}catch(error){
      // Best-effort rollback: never pretend the charge was recorded if it failed.
      try{await token.update({light:foundry.utils.deepClone(original)});await token.unsetFlag(ID,'activePortableLight');}catch(rollbackError){console.error(`${ID} light rollback failed`,rollbackError);}
      throw error;
    }
    return t('Light.On',{item:item.name,left:config.maxIgnitions?`${next.remainingIgnitions}/${config.maxIgnitions}`:'∞'});
  });
}
export async function togglePortableLight(item,options={}){
  ensureItem(item);
  const entry=stored(item);
  if(entry?.state.litTokenUuid)return extinguishPortableLight(item,options);
  return ignitePortableLight(item,options);
}
export async function setHood(item,closed){
  ensureItem(item);
  return localLocks(item.uuid,async()=>{
    const entry=stored(item);if(entry?.config.preset!=='hooded')throw fail('Err.HoodOnly');
    const {config,state}=entry;config.hoodClosed=Boolean(closed);
    if(state.litTokenUuid){
      const token=await getToken(state.litTokenUuid);
      if(!token||!tokenCanUpdate(token))throw fail('Err.TokenPermission');
      const active=token.getFlag(ID,'activePortableLight');
      if(active?.itemUuid!==item.uuid||!matchingLight(lightObject(token),active.applied))throw fail('Err.LightExternal');
      const applied=renderTokenLight(config,token.parent?.grid?.units??'ft');
      await token.update({light:applied,[`flags.${ID}.activePortableLight`]:{...active,applied}});
    }
    await commit(item,config,state);
    return t(closed?'Light.HoodLowered':'Light.HoodRaised',{item:item.name});
  });
}
/** An oil flask in the same inventory: name contains "oil" (or "λάδι"), at least one left, not the lamp itself. */
export function findOil(item){
  return [...(item?.parent?.items??[])].find(i=>i.id!==item.id&&/\boil\b|λάδι/i.test(i.name??'')&&!/lamp|lantern|λάμπα|φανάρι/i.test(i.name??'')&&Number(i.system?.quantity??0)>=1)??null;
}
/** Explicit refuel: consumes exactly one referenced Oil item from this Actor; torch replacements consume one additional unit from an inventory stack. */
export async function refuelPortableLight(item){
  ensureItem(item);
  return localLocks(item.uuid,async()=>{
    const entry=stored(item);if(!entry)throw fail('Err.NoLightRule');
    const {config,state}=entry;
    if(state.litTokenUuid)throw fail('Err.ExtinguishFirst');
    if(config.fuelMode==='none')throw fail('Err.NoFuel');
    if(config.fuelMode==='oil'){
      let oil=await fromUuidSafe(config.fuelItemUuid);
      // No oil item set up (or it ran out): use any "Oil" / "Oil Flask" this actor carries, and remember it.
      if(!oil||oil.parent?.uuid!==item.parent.uuid||Number(oil.system?.quantity??0)<1){
        const found=findOil(item);
        if(found){oil=found;config.fuelItemUuid=found.uuid;}
      }
      if(!oil||oil.parent?.uuid!==item.parent.uuid||Number(oil.system?.quantity??0)<1)throw fail('Err.NoOil');
      if(oil.id===item.id)throw fail('Err.SelfFuel');
      await oil.update({'system.quantity':Number(oil.system.quantity)-1});
    }else{
      const quantity=Number(item.system?.quantity??0);
      if(quantity<=1)throw fail('Err.NoReplacement');
      await item.update({'system.quantity':quantity-1});
    }
    try{await commit(item,config,createLightState(config));}catch(error){
      report(t('Light.RefuelSaveFailed',{item:item.name}));throw error;
    }
    return t(config.fuelMode==='oil'?'Light.Refilled':'Light.Replaced',{item:item.name});
  });
}
/** When advancing world time, expire burning lights at zero. Only one GM writes. */
export async function reconcilePortableLight(item){
  const entry=stored(item);if(!entry||!entry.state.litTokenUuid||entry.config.burnSeconds===0)return false;
  const state=burnElapsed(entry.state,currentTime());
  if(state.remainingSeconds>0){await commit(item,entry.config,state);return false;}
  await turnOff(item,{quiet:true});
  return true;
}
export async function repairPortableLight(item){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  const entry=stored(item);if(!entry)throw fail('Err.NoLightRule');
  if(entry.state.litTokenUuid){
    const token=await getToken(entry.state.litTokenUuid);
    if(token?.getFlag(ID,'activePortableLight')?.itemUuid===item.uuid){await turnOff(item,{token});return t('Light.Repaired');}
  }
  await commit(item,entry.config,{...burnElapsed(entry.state,currentTime()),litTokenUuid:'',startedAt:null});
  return t('Light.StaleCleared');
}
export async function resetPortableLight(item){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  const entry=stored(item);if(!entry)throw fail('Err.NoLightRule');
  if(entry.state.litTokenUuid)throw fail('Err.ExtinguishFirst');
  await commit(item,entry.config,createLightState(entry.config));
  return t('Light.ResetDone');
}
export function registerPortableLightAutomation(record=()=>{}){
  Hooks.on('dnd5e.postUseActivity',(activity,_usageConfig,_results)=>{
    const item=activity?.item;
    if(!item?.parent?.items||!owned(item.parent))return;
    // An Attack Activity (using a torch as a weapon, hurling Produce Flame) must not ignite the light.
    // Items light from a Utility activity; spells from any activity that isn't an attack.
    if(item.type==='spell'?activity.type==='attack':activity.type!=='utility')return;
    const explicit=stored(item),preset=classifyLightSource(item);
    if(!explicit&&!preset)return;
    if(explicit?.config.activityId&&explicit.config.activityId!==activity.id)return;
    if(explicit?.config.enabled===false)return;
    void ignitePortableLight(item,{automatic:true}).then(message=>record(`Automatic light activation: ${message}`))
      .catch(error=>{record(`Portable light activation failed: ${error.message}`);report(error.message);});
  });
  Hooks.on('updateWorldTime',()=>{
    // GM only to avoid multiple clients decrementing the same document concurrently.
    if(!game.user.isGM||(game.users.activeGM?.id&&game.users.activeGM.id!==game.user.id))return;
    for(const actor of game.actors.contents)for(const item of actor.items){
      if(!stored(item)?.state.litTokenUuid)continue;
      void reconcilePortableLight(item).catch(error=>record(`Burn-time reconciliation: ${error.message}`));
    }
  });
  Hooks.on('deleteToken',(token)=>{
    const active=token.getFlag(ID,'activePortableLight');if(!active)return;
    const owner=token.actor;
    if(!owner||!game.user.isGM)return;
    const item=owner.items.find(i=>i.uuid===active.itemUuid);
    if(item)void repairPortableLight(item).catch(error=>record(`Missing lit token: ${error.message}`));
  });
  record('Portable light source controller and activity automation initialized');
}
export function summarizeLight(item){
  const assignment=stored(item);if(!assignment)return null;
  return {...assignment,state:burnElapsed(assignment.state,currentTime())};
}
