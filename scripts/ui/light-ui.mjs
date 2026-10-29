import {ID} from '../core/constants.mjs';
import {LIGHT_PRESETS,classifyLightItem} from '../core/light-presets.mjs';
import {t,fail,language,toggleLanguage} from '../i18n.mjs';
import {assignPortableLight,removePortableLight,getLightAssignment,togglePortableLight,refuelPortableLight,repairPortableLight,resetPortableLight,setHood,summarizeLight} from '../rules/light.mjs';

const safe=v=>foundry.utils.escapeHTML(String(v??''));
const option=(value,label,selected=false)=>`<option value="${safe(value)}" ${selected?'selected':''}>${safe(label)}</option>`;
const get=(data,key)=>data?.get?.(key)??data?.[key];
const field=(label,control)=>`<div class="form-group"><label>${safe(label)}</label>${control}</div>`;
const DialogV2=()=>foundry.applications.api.DialogV2;
const notify=e=>{console.error(`${ID} lights:`,e);ui.notifications.error(t('Note.Error',{message:e?.message??e}));};
const worldActors=()=>game.actors.contents.toSorted((a,b)=>a.name.localeCompare(b.name));
const lightItems=actor=>actor.items.filter(i=>Boolean(i.getFlag(ID,'portableLight'))||Boolean(classifyLightItem(i.name)));
const presetLabel=key=>LIGHT_PRESETS[key]?t(`Preset.${key}`):'?';
const ANIMATIONS=['none','torch','flame','pulse','ghost','chroma','emanation','energy','fairy','fog','hexa','lightning','radialrainbow','revolving','siren','smokepatch','starlight','sunburst','swirlingrainbow','vortex','wave'];
async function prompt(title,content){return DialogV2().input({window:{title},content:`<div class="planar-form">${content}</div>`,rejectClose:false,ok:{label:t('Common.Save')}});}
async function confirm(text){return Boolean(await DialogV2().confirm({content:`<p>${safe(text)}</p>`,rejectClose:false,modal:true}));}
async function chooseLightItem(){
  const actors=worldActors().filter(a=>a.items.size>0);
  if(!actors.length)throw fail('Err.NoInventory');
  const selected=await prompt(t('Light.ChooseActorTitle'),field(t('Common.Actor'),`<select name="actor">${actors.map(a=>option(a.id,a.name)).join('')}</select>`));
  const actor=selected&&game.actors.get(String(get(selected,'actor')));
  if(!actor)return null;
  const data=await prompt(t('Light.ChooseItemTitle'),field(t('Light.Item'),`<select name="item">${[...actor.items].toSorted((a,b)=>a.name.localeCompare(b.name)).map(i=>option(i.id,`${i.name} (${i.type})`)).join('')}</select>`));
  return data?actor.items.get(String(get(data,'item'))):null;
}
export async function configurePortableLight(item){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  const existing=summarizeLight(item);
  if(existing?.state.litTokenUuid)throw fail('Err.ExtinguishFirst');
  const detected=classifyLightItem(item.name)??'magic';
  const presetChoice=await prompt(t('Light.PresetTitle',{item:item.name}),`<p>${t('Light.PresetHint')}</p>${field(t('Light.Preset'),`<select name="preset">${Object.keys(LIGHT_PRESETS).map(key=>option(key,presetLabel(key),key===(existing?.config.preset??detected))).join('')}</select>`)}`);
  if(!presetChoice)return;
  const preset=String(get(presetChoice,'preset'));
  const source=existing?.config.preset===preset?existing.config:LIGHT_PRESETS[preset];
  const fuels=[...item.parent.items].filter(i=>i.id!==item.id);
  const currentOil=fuels.find(i=>i.uuid===source.fuelItemUuid)?.id??'';
  const fields=[
    ['bright','number','0','1000','1'],['dim','number','0','2000','1'],['color','text','','',''],
    ['alpha','number','0','1','0.01'],['luminosity','number','-1','1','0.01'],['angle','number','1','360','1'],
    ['speed','number','0','10','1'],['intensity','number','0','10','1'],
    ['maxIgnitions','number','0','1000','1'],['burnSeconds','number','0','2592000','1']
  ];
  const inputs=fields.map(([key,type,min,max,step])=>field(t(`Light.Field.${key}`),`<input name="${key}" type="${type}" ${min!==''?`min="${min}" max="${max}" step="${step}"`:''} value="${safe(source[key])}">`)).join('');
  const activities=[...(item.system?.activities?.values?.()??[])].filter(a=>a.type==='utility');
  const form=await prompt(t('Light.ConfigureTitle',{item:item.name,preset:presetLabel(preset)}),`
    <p>${t('Light.ConfigureHint')}</p>
    ${field(t('Common.Status'),`<select name="enabled">${option('true',t('Common.Enabled'),source.enabled!==false)}${option('false',t('Common.Disabled'),source.enabled===false)}</select>`)}
    ${inputs}
    ${field(t('Light.Field.animation'),`<select name="animation">${ANIMATIONS.map(k=>option(k,k,k===source.animation)).join('')}</select>`)}
    ${field(t('Light.Field.fuelMode'),`<select name="fuelMode">${['oil','replace','none'].map(k=>option(k,t(`Light.Fuel.${k}`),source.fuelMode===k)).join('')}</select>`)}
    ${field(t('Light.Field.oil'),`<select name="oil">${option('',t('Common.None'),!currentOil)}${fuels.map(i=>option(i.id,`${i.name} (${i.system?.quantity??'?'})`,i.id===currentOil)).join('')}</select>`)}
    ${field(t('Light.Field.activity'),`<select name="activityId">${option('',t('Light.AnyUtility'),!source.activityId)}${activities.map(a=>option(a.id,a.name??'Utility',a.id===source.activityId)).join('')}</select>`)}
    ${field(t('Light.Field.preserve'),`<select name="preserveState">${option('true',t('Common.Yes'),!!existing)}${option('false',t('Light.ResetToMax'),!existing)}</select>`)}
  `);
  if(!form)return;
  const fieldsData=Object.fromEntries(fields.map(([key])=>[key,get(form,key)]));
  const oil=item.parent.items.get(String(get(form,'oil')));
  await assignPortableLight(item,{...fieldsData,preset,enabled:get(form,'enabled')==='true',fuelMode:get(form,'fuelMode'),animation:get(form,'animation'),activityId:get(form,'activityId'),fuelItemUuid:oil?.uuid??'',preserveState:get(form,'preserveState')==='true'});
  ui.notifications.info(t('Light.Configured',{actor:item.parent.name,item:item.name}));
}
export async function assignDetectedLights(){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  if(!await confirm(t('Light.ConfirmBulk')))return 0;
  let count=0;
  for(const actor of worldActors())for(const item of actor.items){
    const preset=classifyLightItem(item.name);
    if(!preset||item.getFlag(ID,'portableLight'))continue;
    try{await assignPortableLight(item,{preset});count++;}
    catch(error){console.warn(`${ID}: Cannot auto-assign ${item.uuid}`,error);}
  }
  return count;
}
const status=(item,entry)=>{
  if(!entry)return t('Light.NotConfigured');
  const {config,state}=entry;
  const ignitions=config.maxIgnitions===0?'∞':`${state.remainingIgnitions}/${config.maxIgnitions}`;
  const minutes=config.burnSeconds===0?'∞':`${Math.ceil(state.remainingSeconds/60)}/${Math.ceil(config.burnSeconds/60)}`;
  return t('Light.Status',{state:t(state.litTokenUuid?'Light.Lit':'Light.Unlit'),ignitions,minutes});
};
const button=(action,key,uuid)=>`<button type="button" data-light-action="${safe(action)}" data-light-uuid="${safe(uuid)}">${safe(t(key))}</button>`;
export function lightManagementHTML(){
  const rows=[];
  for(const actor of worldActors())for(const item of lightItems(actor)){
    const entry=summarizeLight(item),preset=entry?.config.preset??classifyLightItem(item.name);
    rows.push(`<tr><td>${safe(actor.name)}</td><td>${safe(item.name)}</td><td>${safe(presetLabel(preset))}</td><td>${safe(status(item,entry))}</td><td>${button('light-configure','Common.Edit',item.uuid)} ${entry?button('light-reset','Common.Reset',item.uuid)+button('light-repair','Common.Repair',item.uuid)+button('light-remove','Common.Remove',item.uuid):''}</td></tr>`);
  }
  return `<section id="planar-lights"><h3>${t('Light.Title')}</h3><p>${t('Light.ManagerIntro')}</p>
    ${button('light-new','Light.ConfigureNew','')} ${button('light-all','Light.AssignAll','')}
    <table><thead><tr><th>${t('Common.Actor')}</th><th>${t('Light.Item')}</th><th>${t('Light.Preset')}</th><th>${t('Light.Fuel.Title')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${rows.join('')||`<tr><td colspan="5">${safe(t('Light.NoneFound'))}</td></tr>`}</tbody></table></section>`;
}
export async function handleLightManagerAction(action,uuid,refresh){
  const item=uuid?await fromUuid(uuid):null;
  if(action==='light-new'){const selected=await chooseLightItem();if(selected)await configurePortableLight(selected);}
  else if(action==='light-all'){const total=await assignDetectedLights();ui.notifications.info(t('Light.BulkDone',{count:total}));}
  else if(action==='light-configure'&&item)await configurePortableLight(item);
  else if(action==='light-remove'&&item){if(await confirm(t('Light.ConfirmRemove',{item:item.name})))await removePortableLight(item);}
  else if(action==='light-reset'&&item){if(await confirm(t('Light.ConfirmReset',{item:item.name})))ui.notifications.info(await resetPortableLight(item));}
  else if(action==='light-repair'&&item){ui.notifications.info(await repairPortableLight(item));}
  if(refresh)await refresh();
}
export class PlanarLightController extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={id:'planar-homebrew-light-controller',window:{title:'PLANAR_HOMEBREW.Light.ControllerTitle',resizable:true},position:{width:860,height:560}};
  get title(){return t('Light.ControllerTitle');}
  async _renderHTML(){
    const root=document.createElement('div');root.className='planar-manager';
    const rows=[];
    for(const actor of worldActors()){
      if(!actor.testUserPermission(game.user,'OWNER')&&!game.user.isGM)continue;
      for(const item of lightItems(actor)){
        const entry=summarizeLight(item)??await getLightAssignment(item,{discover:true});
        if(!entry||!entry.config.enabled)continue;
        const lit=Boolean(entry.state.litTokenUuid);
        rows.push(`<tr><td>${safe(actor.name)}</td><td>${safe(item.name)}</td><td>${safe(presetLabel(entry.config.preset))}</td><td>${safe(status(item,entry))}</td><td class="planar-actions">
          ${button('light-toggle',lit?'Light.Extinguish':'Light.Ignite',item.uuid)}
          ${!lit&&entry.config.fuelMode!=='none'&&item.getFlag(ID,'portableLight')?button('light-refuel',entry.config.fuelMode==='oil'?'Light.Refill':'Light.Replace',item.uuid):''}
          ${entry.config.preset==='hooded'&&lit?button('light-hood',entry.config.hoodClosed?'Light.RaiseHood':'Light.LowerHood',item.uuid):''}
        </td></tr>`);
      }
    }
    const langButton=`<button type="button" class="planar-lang" data-planar-lang title="${safe(t('Common.LanguageHint'))}">${language()==='el'?'EN':'ΕΛ'}</button>`;
    root.innerHTML=`<header class="planar-head"><div><h2>${t('Light.ControllerTitle')}</h2><p>${t('Light.ControllerIntro')}</p></div>${langButton}</header>
      <table><thead><tr><th>${t('Common.Actor')}</th><th>${t('Light.Item')}</th><th>${t('Light.Preset')}</th><th>${t('Light.Fuel.Title')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${rows.join('')||`<tr><td colspan="5">${safe(t('Light.NoneOwned'))}</td></tr>`}</tbody></table>
      <p class="notes">${t('Light.ControllerNotes')}</p>`;
    return root;
  }
  _replaceHTML(result,content){content.replaceChildren(result);}
  _onRender(context,options){
    super._onRender(context,options);
    this.element.querySelector('[data-planar-lang]')?.addEventListener('click',()=>void toggleLanguage());
    this.element.querySelectorAll('[data-light-action]').forEach(el=>el.addEventListener('click',async()=>{
      el.disabled=true;
      try{
        const item=await fromUuid(el.dataset.lightUuid);
        if(!item)throw fail('Err.ItemGone');
        let result='';
        if(el.dataset.lightAction==='light-toggle')result=await togglePortableLight(item);
        if(el.dataset.lightAction==='light-refuel')result=await refuelPortableLight(item);
        if(el.dataset.lightAction==='light-hood')result=await setHood(item,!summarizeLight(item)?.config.hoodClosed);
        if(result)ui.notifications.info(result);
        await this.render();
      }catch(error){notify(error);el.disabled=false;}
    }));
  }
}
