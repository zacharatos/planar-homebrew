import {ID} from '../core/constants.mjs';
import {LIGHT_PRESETS,classifyLightItem} from '../core/light-presets.mjs';
import {t,fail,language,toggleLanguage} from '../i18n.mjs';
import {TOKEN_LIGHT_GROUPS,LIGHT_STRENGTHS,pickTargets} from '../core/token-lights.mjs';
import {lightableTokens,applyTokenLight,tokenPreset,sceneLightSources,sourceLit,selectedSourceIds,switchBackup,lookBackup,switchLights} from '../rules/token-lights.mjs';
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
const TABS=['items','token','scene'];
/** The preset menu, grouped: mundane lights, spells, vestige lights, none. */
export function tokenPresetOptions(selected=''){
  return Object.entries(TOKEN_LIGHT_GROUPS).map(([group,keys])=>`<optgroup label="${safe(t(`TokenLight.Group.${group}`))}">${keys.map(k=>option(k,t(`TokenLight.Preset.${k}`),k===selected)).join('')}</optgroup>`).join('');
}
/**
 * Lights window, for everyone: carried items (torches, lamps…), token lights (any owned token, including a
 * vestige or familiar) and, for the GM, the scene switchboard (ambient + token lights: off/on/toggle,
 * soften/restore look). Open on a tab with options {tab, tokenId}.
 */
export class PlanarLightController extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={id:'planar-homebrew-light-controller',window:{title:'PLANAR_HOMEBREW.Light.ControllerTitle',resizable:true},position:{width:780,height:600}};
  tab='items';
  /** Remembered choices, so a redraw (another user's change) doesn't lose what the user picked. */
  choice={tokenId:'',preset:'torch',strength:'gentle',action:'off',scope:'',checked:null};
  get title(){return t('Light.ControllerTitle');}
  /** Open on a tab and/or with a token picked (Token HUD button). */
  configure({tab,tokenId}={}){
    if(TABS.includes(tab)&&(tab!=='scene'||game.user.isGM))this.tab=tab;
    if(tokenId)this.choice.tokenId=tokenId;
    return this;
  }
  async _renderHTML(){
    const root=document.createElement('div');root.className='planar-manager planar-lights';
    if(this.tab==='scene'&&!game.user.isGM)this.tab='items';
    const tabs=TABS.filter(k=>k!=='scene'||game.user.isGM).map(k=>`<button type="button" class="planar-tab ${this.tab===k?'active':''}" data-planar-tab="${k}">${safe(t(`TokenLight.Tab.${k}`))}</button>`).join('');
    const body=this.tab==='token'?this._tokenTab():this.tab==='scene'?this._sceneTab():await this._itemsTab();
    const langButton=`<button type="button" class="planar-lang" data-planar-lang title="${safe(t('Common.LanguageHint'))}">${language()==='el'?'EN':'ΕΛ'}</button>`;
    root.innerHTML=`<header class="planar-head"><div><h2>${t('Light.ControllerTitle')}</h2></div>${langButton}</header>
      <nav class="planar-tabbar">${tabs}</nav>${body}`;
    return root;
  }
  async _itemsTab(){
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
    return `<p>${t('Light.ControllerIntro')}</p>
      <table><thead><tr><th>${t('Common.Actor')}</th><th>${t('Light.Item')}</th><th>${t('Light.Preset')}</th><th>${t('Light.Fuel.Title')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${rows.join('')||`<tr><td colspan="5">${safe(t('Light.NoneOwned'))}</td></tr>`}</tbody></table>
      <p class="notes">${t('Light.ControllerNotes')}</p>`;
  }
  _tokenTab(){
    const scene=canvas?.scene;
    if(!scene)return `<p>${safe(t('Err.OpenScene'))}</p>`;
    const tokens=lightableTokens(scene);
    if(!tokens.length)return `<p>${safe(t('TokenLight.NoTokens'))}</p>`;
    const controlled=new Set((canvas.tokens?.controlled??[]).map(tok=>tok.id));
    const picked=tokens.find(d=>d.id===this.choice.tokenId)??tokens.find(d=>controlled.has(d.id))??tokens[0];
    this.choice.tokenId=picked.id;
    const lightText=doc=>{
      if(switchBackup(doc))return t('TokenLight.SwitchedOff');
      const preset=tokenPreset(doc);
      const radius=`${Number(doc.light?.bright)||0}/${Number(doc.light?.dim)||0}`;
      return Number(doc.light?.dim)>0||Number(doc.light?.bright)>0?`${preset?t(`TokenLight.Preset.${preset}`)+' · ':''}${radius}`:t('TokenLight.Dark');
    };
    const list=tokens.map(doc=>`<tr class="${doc.id===picked.id?'planar-picked':''}"><td>${safe(doc.name)}</td><td>${safe(lightText(doc))}</td>
      <td class="planar-actions"><button type="button" data-token-pick="${safe(doc.id)}">${safe(t('TokenLight.Pick'))}</button><button type="button" data-token-off="${safe(doc.id)}">${safe(t('TokenLight.TurnOff'))}</button></td></tr>`).join('');
    return `<p>${t('TokenLight.Intro')}</p>
      <div class="planar-form planar-token-form">
        ${field(t('TokenLight.Token'),`<select name="tokenId">${tokens.map(d=>option(d.id,d.name,d.id===picked.id)).join('')}</select>`)}
        ${field(t('TokenLight.Source'),`<select name="preset">${tokenPresetOptions(this.choice.preset)}</select>`)}
        ${field(t('TokenLight.Strength'),`<select name="strength">${Object.keys(LIGHT_STRENGTHS).map(k=>option(k,t(`TokenLight.StrengthLevel.${k}`),k===this.choice.strength)).join('')}</select>`)}
        <div class="planar-buttons"><button type="button" data-token-apply><i class="fa-solid fa-lightbulb"></i> ${safe(t('TokenLight.Apply'))}</button></div>
      </div>
      <table><thead><tr><th>${t('TokenLight.Token')}</th><th>${t('TokenLight.Now')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${list}</tbody></table>
      <p class="notes">${t('TokenLight.Notes')}</p>`;
  }
  _sceneTab(){
    const scene=canvas?.scene;
    if(!scene)return `<p>${safe(t('Err.OpenScene'))}</p>`;
    const sources=sceneLightSources(scene);
    const selected=new Set(selectedSourceIds(sources));
    const checked=new Set(this.choice.checked??selected);
    const scope=this.choice.scope||(selected.size?'selected':'manual');
    const rows=[...sources.values()].map(s=>{
      const state=switchBackup(s.doc)?t('TokenLight.OffSaved'):t(sourceLit(s)?'TokenLight.On':'TokenLight.Off');
      return `<label class="planar-source"><input type="checkbox" name="sourceIds" value="${safe(s.id)}" ${checked.has(s.id)?'checked':''}><span>${safe(s.label)}</span><small>${safe(state)}${lookBackup(s.doc)?' · '+safe(t('TokenLight.Softened')):''}</small></label>`;
    }).join('');
    return `<p>${t('TokenLight.SceneIntro',{scene:safe(scene.name)})}</p>
      <div class="planar-form">
        ${field(t('TokenLight.Action'),`<select name="action">${['off','on','toggle','soften','lookrestore'].map(k=>option(k,t(`TokenLight.SwitchAction.${k}`),k===this.choice.action)).join('')}</select>`)}
        ${field(t('TokenLight.Targets'),`<select name="scope">${option('selected',t('TokenLight.Scope.selected',{count:selected.size}),scope==='selected')}${option('manual',t('TokenLight.Scope.manual'),scope==='manual')}${option('all',t('TokenLight.Scope.all'),scope==='all')}</select>`)}
      </div>
      <div class="planar-buttons"><button type="button" data-check="all">${safe(t('TokenLight.CheckAll'))}</button><button type="button" data-check="none">${safe(t('TokenLight.CheckNone'))}</button></div>
      <div class="planar-sources">${rows||`<p>${safe(t('TokenLight.NoSources'))}</p>`}</div>
      <div class="planar-buttons"><button type="button" data-scene-apply><i class="fa-solid fa-power-off"></i> ${safe(t('TokenLight.ApplyScene'))}</button></div>
      <p class="notes">${t('TokenLight.SceneNotes')}</p>`;
  }
  _replaceHTML(result,content){content.replaceChildren(result);}
  /** Read the form into this.choice before any redraw. */
  _remember(){
    const el=this.element;if(!el)return;
    for(const key of ['tokenId','preset','strength','action','scope']){const input=el.querySelector(`[name="${key}"]`);if(input)this.choice[key]=input.value;}
    const boxes=el.querySelectorAll('[name="sourceIds"]');
    if(boxes.length)this.choice.checked=[...boxes].filter(b=>b.checked).map(b=>b.value);
  }
  async _run(el,fn){
    el.disabled=true;
    try{const result=await fn();if(result)ui.notifications.info(result);await this.render();}
    catch(error){notify(error);el.disabled=false;}
  }
  _onRender(context,options){
    super._onRender(context,options);
    const root=this.element;
    root.querySelector('[data-planar-lang]')?.addEventListener('click',()=>void toggleLanguage());
    root.querySelectorAll('[data-planar-tab]').forEach(el=>el.addEventListener('click',()=>{this._remember();this.tab=el.dataset.planarTab;this.render();}));
    root.querySelectorAll('select,input').forEach(el=>el.addEventListener('change',()=>this._remember()));
    // Items tab
    root.querySelectorAll('[data-light-action]').forEach(el=>el.addEventListener('click',()=>this._run(el,async()=>{
      const item=await fromUuid(el.dataset.lightUuid);
      if(!item)throw fail('Err.ItemGone');
      if(el.dataset.lightAction==='light-toggle')return togglePortableLight(item);
      if(el.dataset.lightAction==='light-refuel')return refuelPortableLight(item);
      if(el.dataset.lightAction==='light-hood')return setHood(item,!summarizeLight(item)?.config.hoodClosed);
    })));
    // Token tab
    root.querySelectorAll('[data-token-pick]').forEach(el=>el.addEventListener('click',()=>{
      this._remember();this.choice.tokenId=el.dataset.tokenPick;
      canvas.tokens?.get?.(el.dataset.tokenPick)?.control?.({releaseOthers:true});
      this.render();
    }));
    root.querySelectorAll('[data-token-off]').forEach(el=>el.addEventListener('click',()=>this._run(el,()=>{
      this._remember();return applyTokenLight(canvas.scene?.tokens.get(el.dataset.tokenOff),'off');
    })));
    root.querySelector('[data-token-apply]')?.addEventListener('click',ev=>this._run(ev.currentTarget,()=>{
      this._remember();
      return applyTokenLight(canvas.scene?.tokens.get(this.choice.tokenId),this.choice.preset,{strength:this.choice.strength});
    }));
    // Scene tab
    root.querySelectorAll('[data-check]').forEach(el=>el.addEventListener('click',()=>{
      root.querySelectorAll('[name="sourceIds"]').forEach(cb=>{cb.checked=el.dataset.check==='all';});
      const scope=root.querySelector('[name="scope"]');if(scope)scope.value='manual';
      this._remember();
    }));
    root.querySelector('[data-scene-apply]')?.addEventListener('click',ev=>this._run(ev.currentTarget,async()=>{
      this._remember();
      const sources=sceneLightSources(canvas.scene);
      const ids=pickTargets(this.choice.scope,{all:[...sources.keys()],selected:selectedSourceIds(sources),checked:this.choice.checked??[]});
      if(!ids.length)throw fail('Err.NoLightsPicked');
      if(this.choice.scope==='all'&&!await confirm(t('TokenLight.ConfirmAll',{action:t(`TokenLight.SwitchAction.${this.choice.action}`),count:ids.length,scene:canvas.scene.name})))return '';
      const {changed,skipped,failed}=await switchLights(ids.map(id=>sources.get(id)),this.choice.action,{scope:this.choice.scope});
      this.choice.checked=null;
      if(failed.length)ui.notifications.error(t('TokenLight.Failed',{names:failed.slice(0,4).join(', ')}));
      return t('TokenLight.Result',{changed,skipped,failed:failed.length});
    }));
  }
}
