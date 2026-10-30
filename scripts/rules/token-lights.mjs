// Token light presets (any owned token: heroes, the vestige, a familiar) and the GM's scene light
// switchboard. Ported from Timos's tested "Player & GM Light Controller" macros (v2/v3); the flags now
// live under planar-homebrew, and lights switched off or softened by the old macros (world flags) are
// still restored.
import {ID} from '../core/constants.mjs';
import {t,fail} from '../i18n.mjs';
import {TOKEN_LIGHT_PRESETS,buildTokenLight,emitsLight,resolveSwitchAction,softenedLook,savedLook,SOFT_FIELDS,isTokenLightPreset} from '../core/token-lights.mjs';
import {extinguishPortableLight} from './light.mjs';

const SWITCH='lightSwitch', LOOK='lightLook';
const LEGACY_SWITCH='nytherisLightSwitchV2', LEGACY_LOOK='nytherisLightOriginalAppearanceV3';
const clone=x=>foundry.utils.deepClone(x?.toObject?.()??x??{});
const safeFlag=(doc,scope,key)=>{try{return doc?.getFlag?.(scope,key);}catch{return undefined;}};

/** The switch backup (off by this module, or by the old macro). */
export const switchBackup=doc=>safeFlag(doc,ID,SWITCH)??safeFlag(doc,'world',LEGACY_SWITCH);
/** The saved look before softening. */
export const lookBackup=doc=>safeFlag(doc,ID,LOOK)??safeFlag(doc,'world',LEGACY_LOOK);
const clearSwitch=async doc=>{
  if(safeFlag(doc,ID,SWITCH)!==undefined)await doc.unsetFlag(ID,SWITCH);
  if(safeFlag(doc,'world',LEGACY_SWITCH)!==undefined)await doc.unsetFlag('world',LEGACY_SWITCH);
};
const clearLook=async doc=>{
  if(safeFlag(doc,ID,LOOK)!==undefined)await doc.unsetFlag(ID,LOOK);
  if(safeFlag(doc,'world',LEGACY_LOOK)!==undefined)await doc.unsetFlag('world',LEGACY_LOOK);
};

/** Tokens on a scene this user may light: every token with an actor for the GM, owned ones for players. */
export function lightableTokens(scene=canvas?.scene,user=game.user){
  if(!scene)return [];
  return [...scene.tokens].filter(doc=>doc.actor&&(user.isGM||doc.isOwner)).sort((a,b)=>a.name.localeCompare(b.name));
}

/** The preset this module last put on a token ('' when unknown or changed by hand). */
export const tokenPreset=doc=>safeFlag(doc,ID,'tokenLight')??'';

/** Put a light preset on a token (player: own tokens; GM: any). The token's portable item light goes out first. */
export async function applyTokenLight(doc,key,{strength='gentle'}={}){
  if(!doc)throw fail('Err.SelectToken');
  if(!isTokenLightPreset(key))throw fail('Err.LightPreset');
  if(!game.user.isGM&&!doc.isOwner)throw fail('Err.TokenPermission');
  if(switchBackup(doc))throw fail('Err.LightBlackout');
  // A lit torch or lantern owns the token's light: put it out (restoring the earlier light) before replacing it.
  const active=safeFlag(doc,ID,'activePortableLight');
  if(active?.itemUuid){
    const item=await fromUuid(active.itemUuid).catch(()=>null);
    if(item)await extinguishPortableLight(item,{token:doc,quiet:true});
    else await doc.unsetFlag(ID,'activePortableLight');
  }
  const light=buildTokenLight(key,{strength,units:doc.parent?.grid?.units??'ft',current:clone(doc.light),animations:CONFIG.Canvas?.lightAnimations});
  await doc.update({light,[`flags.${ID}.tokenLight`]:key==='off'?'':key});
  return t(key==='off'?'TokenLight.Cleared':'TokenLight.Applied',{preset:t(`TokenLight.Preset.${key}`),token:doc.name});
}

/** Every light source of a scene the switchboard can work on (magical darkness is left out). */
export function sceneLightSources(scene=canvas?.scene){
  const sources=new Map();
  if(!scene)return sources;
  for(const doc of scene.lights){
    if(doc.config?.negative)continue;
    sources.set(`A:${doc.id}`,{id:`A:${doc.id}`,kind:'ambient',doc,label:t('TokenLight.Ambient',{name:doc.name||doc.id.slice(0,8)})});
  }
  for(const doc of scene.tokens){
    if(doc.light?.negative)continue;
    if(!emitsLight(doc.light)&&!switchBackup(doc)&&!lookBackup(doc))continue;
    sources.set(`T:${doc.id}`,{id:`T:${doc.id}`,kind:'token',doc,label:t('TokenLight.Token',{name:doc.name})});
  }
  return sources;
}
export const sourceLit=source=>source.kind==='ambient'?!source.doc.hidden:emitsLight(source.doc.light);

/** The ids of sources that are selected on the canvas right now. */
export function selectedSourceIds(sources){
  const ids=[];
  for(const tok of canvas?.tokens?.controlled??[])if(sources.has(`T:${tok.id}`))ids.push(`T:${tok.id}`);
  for(const light of canvas?.lighting?.controlled??[])if(sources.has(`A:${light.id}`))ids.push(`A:${light.id}`);
  return ids;
}

/** GM: switch, soften or restore a set of sources. Returns {changed, skipped, failed[]}. */
export async function switchLights(sources,requested,{scope='manual'}={}){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  let changed=0,skipped=0;const failed=[];
  for(const source of sources){
    const {doc,kind,label}=source;
    try{
      const backup=switchBackup(doc),lit=sourceLit(source);
      const action=resolveSwitchAction(requested,{lit,saved:Boolean(backup)});
      const path=kind==='ambient'?'config':'light';
      const model=kind==='ambient'?doc.config:doc.light;
      if(action==='soften'){
        if(!lit||backup||lookBackup(doc)){skipped++;continue;}
        const look=softenedLook(model);
        await doc.update({[`flags.${ID}.${LOOK}`]:savedLook(model),...Object.fromEntries(Object.entries(look).map(([k,v])=>[`${path}.${k}`,v]))});
        changed++;continue;
      }
      if(action==='lookrestore'){
        const saved=lookBackup(doc);
        if(!saved||backup){skipped++;continue;}
        const update={};
        for(const key of SOFT_FIELDS)if(saved[key]!==undefined&&saved[key]!==null)update[`${path}.${key}`]=saved[key];
        await doc.update(update);await clearLook(doc);
        changed++;continue;
      }
      if(action==='off'){
        if(!lit||backup){skipped++;continue;}
        if(kind==='ambient')await doc.update({hidden:true,[`flags.${ID}.${SWITCH}`]:{kind,hidden:Boolean(doc.hidden)}});
        else await doc.update({'light.bright':0,'light.dim':0,[`flags.${ID}.${SWITCH}`]:{kind,light:clone(doc.light)}});
        changed++;continue;
      }
      if(action==='on'){
        if(backup?.kind==='ambient'&&kind==='ambient'){await doc.update({hidden:Boolean(backup.hidden)});await clearSwitch(doc);changed++;}
        else if(backup?.kind==='token'&&kind==='token'&&backup.light){await doc.update({light:backup.light});await clearSwitch(doc);changed++;}
        // An ambient light that was hidden by hand comes on only when picked explicitly, never with "all".
        else if(kind==='ambient'&&doc.hidden&&scope!=='all'){await doc.update({hidden:false});changed++;}
        else skipped++;
      }
    }catch(error){console.error(`${ID} lights: ${label}`,error);failed.push(label);}
  }
  return {changed,skipped,failed};
}
export {TOKEN_LIGHT_PRESETS};
