import {lightManagementHTML,handleLightManagerAction} from './light-ui.mjs';
import {ID,DEFAULT_RESONANCE,DEFAULT_VESTIGE} from '../core/constants.mjs';
import {t,fail,language,toggleLanguage} from '../i18n.mjs';
import {assignResonance,unassignResonance} from '../rules/resonance.mjs';
import {bindVestige,unbindVestige,inspectVestige,performCompanionAction,suggestCompanionPosition,repairCompanionState} from '../rules/vestige.mjs';
import {configureBlindDeathSave,getPrivateDeathState,rollBlindDeathSave,resetBlindDeathSave,clearVisibleDeathCounters,addPrivateDeathFailure,SKIP} from '../rules/death-saves.mjs';

const DialogV2 = () => foundry.applications.api.DialogV2;
const safe = value => foundry.utils.escapeHTML(String(value??''));
const get = (data, key) => data?.get?.(key) ?? data?.[key];
const option = (value,label,selected=false)=>`<option value="${safe(value)}" ${selected?'selected':''}>${safe(label)}</option>`;
const yesNo = (name,value,yes='Common.Enabled',no='Common.Disabled')=>`<select name="${name}">${option('true',t(yes),value)}${option('false',t(no),!value)}</select>`;
const field = (label,control)=>`<div class="form-group"><label>${safe(label)}</label>${control}</div>`;
const notify = error => {console.error(`${ID}:`,error);ui.notifications.error(t('Note.Error',{message:error?.message??error}));};
const worldActors=()=>game.actors.contents.toSorted((a,b)=>a.name.localeCompare(b.name));

/** The EN/ΕΛ button shown at the top of every window of the module. */
export const languageButton=()=>`<button type="button" class="planar-lang" data-planar-lang title="${safe(t('Common.LanguageHint'))}">${language()==='el'?'EN':'ΕΛ'}</button>`;
export function bindLanguageButton(root){
  root.querySelector('[data-planar-lang]')?.addEventListener('click',()=>void toggleLanguage());
}

async function promptFields(title,content){
  return DialogV2().input({window:{title},content:`<div class="planar-form">${content}</div>`,rejectClose:false,ok:{label:t('Common.Save')}});
}
async function chooseActor(title,{exclude='',ownerOnly=false}={}){
  const actors=worldActors().filter(a=>a.id!==exclude&&(!ownerOnly||a.testUserPermission(game.user,'OWNER')));
  if(!actors.length){ui.notifications.warn(t('Note.NoActors'));return null;}
  const fd=await promptFields(title,field(t('Common.Actor'),`<select name="actor">${actors.map(a=>option(a.id,a.name)).join('')}</select>`));
  return fd?game.actors.get(String(get(fd,'actor'))):null;
}
async function chooseItem(actor){
  const items=actor.items.filter(i=>i.type==='weapon');
  if(!items.length)throw fail('Err.NoWeapons',{name:actor.name});
  const fd=await promptFields(t('Resonance.ChooseWeapon'),field(t('Resonance.WeaponOf',{name:actor.name}),`<select name="item">${items.map(i=>option(i.id,i.name)).join('')}</select>`));
  return fd?actor.items.get(String(get(fd,'item'))):null;
}
function activityOptions(item,selected){
  const activities=[...(item.system?.activities?.values?.()??[])].filter(a=>a.type==='attack');
  return option('',t('Resonance.AllAttacks'),!selected) + activities.map(a=>option(a.id,a.name||a.type,selected===a.id)).join('');
}
const damageLabel=type=>CONFIG.DND5E?.damageTypes?.[type]?.label??type;
async function configureWeapon(actor,item,refresh){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  const prev={...DEFAULT_RESONANCE,...(item.getFlag(ID,'resonance')??{})};
  const fd=await promptFields(t('Resonance.ConfigureTitle',{item:item.name}),`
    <p>${t('Resonance.ConfigureHint')}</p>
    ${field(t('Common.Status'),yesNo('enabled',prev.enabled))}
    ${field(t('Resonance.Activity'),`<select name="activityId">${activityOptions(item,prev.activityId)}</select>`)}
    ${field(t('Label.DieFaces'),`<input type="number" name="faces" min="2" max="100" value="${safe(prev.faces)}">`)}
    ${field(t('Label.MaxExtra'),`<input type="number" name="maxExtra" min="1" max="1000" value="${safe(prev.maxExtra)}">`)}
    ${field(t('Resonance.DamageType'),`<select name="damageType">${['slashing','piercing','bludgeoning'].map(k=>option(k,damageLabel(k),prev.damageType===k)).join('')}</select>`)}
  `);
  if(!fd)return;
  await assignResonance(item,{enabled:get(fd,'enabled')==='true',activityId:get(fd,'activityId'),faces:get(fd,'faces'),maxExtra:get(fd,'maxExtra'),damageType:get(fd,'damageType')});
  ui.notifications.info(t('Resonance.Saved',{actor:actor.name,item:item.name}));
  await refresh();
}
async function configureBinding(summoner,refresh){
  if(!game.user.isGM)throw fail('Err.GMOnly');
  const actors=worldActors().filter(a=>a.id!==summoner.id);
  if(!actors.length)throw fail('Err.NoCompanionActor');
  const prev={...DEFAULT_VESTIGE,...(summoner.getFlag(ID,'vestige')??{})};
  const currentId=actors.find(a=>a.uuid===prev.companionUuid)?.id;
  const spells=summoner.items.filter(i=>i.type==='spell');
  const activities=spells.flatMap(item=>[...(item.system?.activities?.values?.()??[])]
    .filter(activity=>activity.type!=='summon')
    .map(activity=>({key:`${item.id}:${activity.id}`,label:`${item.name} — ${activity.name||activity.type}`,item,activity})));
  const previousCast=spells.find(i=>i.uuid===prev.castingItemUuid);
  const castingKey=previousCast?`${previousCast.id}:${prev.castingActivityId}`:'';
  const fd=await promptFields(t('Companion.BindTitle',{name:summoner.name}),`
    <p>${t('Companion.BindHint')}</p>
    ${field(t('Companion.CompanionActor'),`<select name="companion">${actors.map(a=>option(a.id,a.name,a.id===currentId)).join('')}</select>`)}
    ${field(t('Common.Status'),yesNo('enabled',prev.enabled))}
    ${field(t('Label.Range'),`<input name="range" type="number" min="5" max="500" value="${safe(prev.range)}">`)}
    ${field(t('Companion.Cost'),`<select name="requireCasting">${option('true',t('Companion.CostSpell'),prev.requireCasting)}${option('false',t('Companion.CostFree'),!prev.requireCasting)}</select>`)}
    ${field(t('Companion.Spell'),`<select name="casting">${option('',t('Companion.SpellNone'),!castingKey)}${activities.map(a=>option(a.key,a.label,a.key===castingKey)).join('')}</select>`)}
    ${field(t('Companion.CommandCost'),`<select name="commandCost">${['bonus','action','free'].map(k=>option(k,t(`Cost.${k}`),prev.commandCost===k)).join('')}</select>`)}
    ${field(t('Companion.RecallReturn'),`<select name="requireOutsideCombatRecall">${option('true',t('Companion.OutsideCombat'),prev.requireOutsideCombatRecall)}${option('false',t('Companion.InCombatToo'),!prev.requireOutsideCombatRecall)}</select>`)}
    ${field(t('Companion.PlayerControls'),`<select name="allowPlayerControls">${option('true',t('Companion.PlayerControlsOn'),prev.allowPlayerControls)}${option('false',t('Companion.GMOnly'),!prev.allowPlayerControls)}</select>`)}
    ${field(t('Companion.HPMode'),`<select name="hpMode">${['keep','vestige'].map(k=>option(k,t(`Companion.HP.${k}`),prev.hpMode===k)).join('')}</select>`)}
    ${field(t('Companion.Vanish'),`<select name="vanishOnDeath">${option('true',t('Common.Yes'),prev.vanishOnDeath)}${option('false',t('Common.No'),!prev.vanishOnDeath)}</select>`)}
    ${field(t('Companion.Light'),`<select name="lightPreset">${['none','aura','beacon'].map(k=>option(k,t(`Companion.LightPreset.${k}`),prev.lightPreset===k)).join('')}</select>`)}
  `);
  if(!fd)return;
  const casting=activities.find(a=>a.key===get(fd,'casting'));
  if(get(fd,'requireCasting')==='true'&&!casting)throw fail('Err.ChooseSpell');
  const companion=game.actors.get(String(get(fd,'companion')));
  await bindVestige(summoner,companion,{
    range:get(fd,'range'), enabled:get(fd,'enabled')==='true',
    requireCasting:get(fd,'requireCasting')==='true',
    castingItemUuid:casting?.item.uuid??'',castingActivityId:casting?.activity.id??'',
    lightPreset:get(fd,'lightPreset'),commandCost:get(fd,'commandCost'),
    requireOutsideCombatRecall:get(fd,'requireOutsideCombatRecall')==='true',
    allowPlayerControls:get(fd,'allowPlayerControls')==='true',
    hpMode:get(fd,'hpMode'),vanishOnDeath:get(fd,'vanishOnDeath')==='true'
  });
  ui.notifications.info(t('Companion.Bound',{companion:companion.name,summoner:summoner.name}));
  await refresh();
}
async function confirmAction(message){return Boolean(await DialogV2().confirm({content:`<p>${safe(message)}</p>`,rejectClose:false,modal:true}));}
async function choosePlacement(summoner){
  const suggested=suggestCompanionPosition(summoner);
  const fd=await promptFields(t('Companion.PlaceTitle',{name:summoner.name}),`
    <p>${t('Companion.PlaceHint')}</p>
    ${field('X',`<input name="x" type="number" step="1" value="${safe(suggested.x)}">`)}
    ${field('Y',`<input name="y" type="number" step="1" value="${safe(suggested.y)}">`)}
  `);
  if(!fd)return null;
  return {x:Number(get(fd,'x')),y:Number(get(fd,'y'))};
}
export async function perform(action,summoner,refresh){
  let result;
  if(['manifest','return'].includes(action)){
    const point=await choosePlacement(summoner);
    if(!point)return;
    result=await performCompanionAction(summoner,action,{point});
  }else if(action==='repair-companion'){
    result=await repairCompanionState(summoner);
  }else if(action==='unbind'){
    if(!await confirmAction(t('Companion.ConfirmUnbind')))return;
    await unbindVestige(summoner); result=t('Companion.Unbound');
  }else{
    if(['destroy','dismiss'].includes(action)&&!await confirmAction(t(`Companion.Confirm.${action}`)))return;
    result=await performCompanionAction(summoner,action);
  }
  ui.notifications.info(result);
  await refresh();
}
const button=(action,key,uuid='',data)=>`<button type="button" data-planar-action="${safe(action)}" data-uuid="${safe(uuid)}">${safe(t(key,data))}</button>`;
const stateLabel=state=>t(`State.${state}`);
const outcomeLabel=outcome=>t(`Death.Outcome.${outcome??'pending'}`);
const skipLabel=skipped=>t(skipped===SKIP.AUTO?'Death.Skip.auto':skipped===SKIP.TURN?'Death.Skip.turn':'Death.Skip.resolved');

export class PlanarHomebrewManager extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={id:'planar-homebrew-manager',window:{title:'PLANAR_HOMEBREW.Manager.Title',resizable:true},position:{width:820,height:660}};
  get title(){return t('Manager.Title');}
  async _renderHTML(){
    if(!game.user.isGM)throw fail('Err.GMOnly');
    const root=document.createElement('div');root.className='planar-manager';
    const weapons=[];
    const companions=[];
    const deaths=[];
    const deathOn=game.settings.get(ID,'deathSavesEnabled');
    for(const actor of worldActors()){
      if(deathOn&&(actor.type==='character'||(actor.type==='npc'&&game.settings.get(ID,'deathSavesNPCs')))){
        const {config,record}=await getPrivateDeathState(actor);
        const eligible=Number(actor.system?.attributes?.hp?.value)===0;
        const details=record ? t('Death.Tally',{successes:record.successes,failures:record.failures,outcome:outcomeLabel(record.outcome)}) : t('Death.NoResults');
        const live=eligible&&config.enabled;
        deaths.push(`<tr><td>${safe(actor.name)}</td><td>${safe(t(eligible?'Death.AtZero':'Death.Conscious'))} · ${safe(t(config.enabled?'Death.Active':'Death.Excluded'))}</td><td>${safe(details)}</td><td class="planar-actions">${button('death-config','Common.Configure',actor.uuid)} ${live?button('death-roll','Death.SecretRoll',actor.uuid)+button('death-failure','Death.AddFailure',actor.uuid)+button('death-critical-failure','Death.AddTwoFailures',actor.uuid):''} ${button('death-reset','Death.ResetTally',actor.uuid)} ${button('death-clear','Death.ClearVisible',actor.uuid)}</td></tr>`);
      }
      for(const item of actor.items.filter(i=>i.type==='weapon')){
        const assign=item.getFlag(ID,'resonance');if(!assign)continue;
        weapons.push(`<tr><td>${safe(actor.name)}</td><td>${safe(item.name)}</td><td>${safe(t(assign.enabled?'Common.Enabled':'Common.Disabled'))}</td><td>${button('edit-weapon','Common.Edit',item.uuid)} ${button('remove-weapon','Common.Remove',item.uuid)}</td></tr>`);
      }
      const flag=actor.getFlag(ID,'vestige');if(!flag)continue;
      const inspected=await inspectVestige(actor);
      const state=inspected.config.state;
      const details=`${safe(stateLabel(state))} · ${safe(inspected.companion?.name??t('Companion.MissingActor'))} · ${safe(t('Companion.Tokens',{count:inspected.tokens.length}))} ${inspected.errors.length?'⚠ '+safe(inspected.errors.join(', ')):''}`;
      companions.push(`<tr><td>${safe(actor.name)}</td><td>${details}</td><td class="planar-actions">
        ${button('edit-companion','Common.Edit',actor.uuid)} ${inspected.errors.length?button('repair-companion','Common.Repair',actor.uuid):''}
        ${state==='dismissed'||state==='destroyed'?button('manifest','Companion.Action.manifest',actor.uuid):''}
        ${state==='manifested'?button('command','Companion.Action.command',actor.uuid)+button('recall','Companion.Action.recall',actor.uuid)+button('dismiss','Companion.Action.dismiss',actor.uuid)+button('destroy','Companion.Action.destroy',actor.uuid):''}
        ${state==='dormant'?button('return','Companion.Action.return',actor.uuid)+button('dismiss','Companion.Action.dismiss',actor.uuid):''}
        ${state==='dismissed'||state==='destroyed'?button('unbind','Companion.Action.unbind',actor.uuid):''}
      </td></tr>`);
    }
    const diagnostics=game.modules.get(ID)?.api?.diagnostics??[];
    const empty=(cols,key)=>`<tr><td colspan="${cols}">${safe(t(key))}</td></tr>`;
    root.innerHTML=`
      <header class="planar-head"><div><h2>${t('Manager.Title')}</h2><p>${t('Manager.Intro')}</p></div>${languageButton()}</header>
      <nav class="planar-tabs"><a href="#planar-rules">${t('Manager.Tab.rules')}</a><a href="#planar-items">${t('Manager.Tab.weapons')}</a><a href="#planar-companions">${t('Manager.Tab.companions')}</a><a href="#planar-lights">${t('Manager.Tab.lights')}</a><a href="#planar-death-saves">${t('Manager.Tab.death')}</a><a href="#planar-diagnostics">${t('Manager.Tab.diagnostics')}</a></nav>
      <section id="planar-rules"><h3>${t('Manager.RulesTitle')}</h3>
        ${['Resonance','Companion','Light','Death'].map(k=>`<p><strong>${t(`Rule.${k}.Name`)}:</strong> ${t(`Rule.${k}.Manager`)}</p>`).join('')}
      </section>
      <section id="planar-items"><h3>${t('Resonance.Title')}</h3>${button('new-weapon','Resonance.Assign')}<table><thead><tr><th>${t('Common.Actor')}</th><th>${t('Common.Weapon')}</th><th>${t('Common.Status')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${weapons.join('')||empty(4,'Resonance.None')}</tbody></table></section>
      <section id="planar-companions"><h3>${t('Companion.Title')}</h3>${button('new-companion','Companion.Bind')}<table><thead><tr><th>${t('Companion.Summoner')}</th><th>${t('Common.Status')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${companions.join('')||empty(3,'Companion.None')}</tbody></table>
        <p class="notes">${t('Companion.ManagerNotes')}</p>
      </section>
      ${lightManagementHTML()}
      <section id="planar-death-saves"><h3>${t('Death.Title')}</h3>
        <p>${t('Death.Intro')}</p>
        <p><strong>${t('Common.Important')}</strong> ${t('Death.NoEffects')}</p>
        <table><thead><tr><th>${t('Common.Actor')}</th><th>${t('Common.Status')}</th><th>${t('Death.PrivateColumn')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${deaths.join('')||empty(4,deathOn?'Death.NoActors':'Death.Off')}</tbody></table>
        <p class="notes">${t('Death.Notes')}</p>
      </section>
      <section id="planar-diagnostics"><h3>${t('Manager.Tab.diagnostics')}</h3><p>${t('Manager.Targets')}</p><ul>${diagnostics.slice(-15).reverse().map(line=>`<li>${safe(line)}</li>`).join('')||`<li>${safe(t('Manager.NoDiagnostics'))}</li>`}</ul></section>`;
    return root;
  }
  _replaceHTML(result,content){content.replaceChildren(result);}
  _onRender(_context,options){
    super._onRender(_context,options);
    bindLanguageButton(this.element);
    this.element.querySelectorAll('button[data-planar-action]').forEach(buttonEl=>buttonEl.addEventListener('click',async()=>{
      try{
        const action=buttonEl.dataset.planarAction;
        const uuid=buttonEl.dataset.uuid;
        const doc=uuid?await fromUuid(uuid):null;
        if(action.startsWith('light-'))return handleLightManagerAction(action,uuid,()=>this.render());
        if(action==='death-roll'){
          if(!doc)return;const result=await rollBlindDeathSave(doc,{manual:true,combat:game.combat});
          if(result.skipped)ui.notifications.warn(skipLabel(result.skipped));
          return this.render();
        }
        if(action==='death-failure'||action==='death-critical-failure'){
          const amount=action==='death-failure'?1:2;
          if(!doc||!await confirmAction(t('Death.ConfirmFailure',{amount,name:doc.name})))return;
          await addPrivateDeathFailure(doc,amount);return this.render();
        }
        if(action==='death-reset'){
          if(!doc||!await confirmAction(t('Death.ConfirmReset',{name:doc.name})))return;
          ui.notifications.info(await resetBlindDeathSave(doc));return this.render();
        }
        if(action==='death-clear'){
          if(!doc||!await confirmAction(t('Death.ConfirmClear',{name:doc.name})))return;
          ui.notifications.info(await clearVisibleDeathCounters(doc));return this.render();
        }
        if(action==='death-config'){
          if(!doc)return;
          const {config}=await getPrivateDeathState(doc);
          const fd=await promptFields(t('Death.ConfigTitle',{name:doc.name}),`
            <p>${t('Death.ConfigHint')}</p>
            ${field(t('Common.Status'),yesNo('enabled',config.enabled,'Common.Yes','Common.No'))}
            ${field(t('Death.AutoRoll'),yesNo('autoRoll',config.autoRoll,'Common.Yes','Death.ManualOnly'))}
            ${field(t('Death.Modifier'),`<input type="number" min="-30" max="30" step="1" name="modifier" value="${safe(config.modifier)}">`)}
            ${field(t('Death.RollMode'),`<select name="advantage">${['normal','advantage','disadvantage'].map(k=>option(k,t(`Death.Mode.${k}`),config.advantage===k)).join('')}</select>`)}
          `);
          if(!fd)return;
          await configureBlindDeathSave(doc,{enabled:get(fd,'enabled')==='true',autoRoll:get(fd,'autoRoll')==='true',modifier:get(fd,'modifier'),advantage:get(fd,'advantage')});
          return this.render();
        }
        if(action==='new-weapon'){
          const actor=await chooseActor(t('Resonance.ChooseOwner'));if(!actor)return;
          const item=await chooseItem(actor);if(!item)return;
          return configureWeapon(actor,item,()=>this.render());
        }
        if(action==='edit-weapon'){if(!doc)return;return configureWeapon(doc.parent,doc,()=>this.render());}
        if(action==='remove-weapon'){
          if(!doc)return;
          if(!await confirmAction(t('Resonance.ConfirmRemove',{item:doc.name})))return;
          await unassignResonance(doc);return this.render();
        }
        if(action==='new-companion'){
          const actor=await chooseActor(t('Companion.ChooseSummoner'));if(actor)return configureBinding(actor,()=>this.render());
        }
        if(action==='edit-companion'){if(doc)return configureBinding(doc,()=>this.render());}
        if(doc)return perform(action,doc,()=>this.render());
      }catch(e){notify(e);}
    }));
  }
}
export class PlanarCompanionStatus extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS={id:'planar-homebrew-player-status',window:{title:'PLANAR_HOMEBREW.Companion.ControllerTitle',resizable:true},position:{width:720,height:450}};
  get title(){return t('Companion.ControllerTitle');}
  async _renderHTML(){
    const root=document.createElement('div');root.className='planar-manager';
    const owned=worldActors().filter(a=>a.testUserPermission(game.user,'OWNER')&&a.getFlag(ID,'vestige')?.companionUuid);
    const rows=[];
    for(const actor of owned){
      const {config,companion,tokens,errors}=await inspectVestige(actor),state=config.state;
      const actions=config.enabled&&config.allowPlayerControls ? `
        ${['dismissed','destroyed'].includes(state)?button('manifest','Companion.Action.manifest',actor.uuid):''}
        ${state==='dormant'?button('return','Companion.Action.returnFree',actor.uuid)+button('dismiss','Companion.Action.dismiss',actor.uuid):''}
        ${state==='manifested'?button('command','Companion.Action.command',actor.uuid)+button('recall','Companion.Action.recall',actor.uuid)+button('dismiss','Companion.Action.dismiss',actor.uuid):''}`:`<em>${safe(t('Companion.GMControls'))}</em>`;
      rows.push(`<tr><td>${safe(actor.name)}</td><td>${safe(companion?.name??t('Companion.MissingActor'))}</td><td>${safe(stateLabel(state))}</td><td>${safe(companion?.system?.attributes?.hp?.value??'?')} / ${safe(companion?.system?.attributes?.hp?.max??'?')}</td><td>${safe(tokens[0]?.scene?.name??'—')}</td><td>${errors.length?safe(errors.join('; ')):actions}</td></tr>`);
    }
    root.innerHTML=`<header class="planar-head"><div><h2>${t('Companion.ControllerTitle')}</h2><p>${t('Companion.ControllerIntro')}</p></div>${languageButton()}</header><table><thead><tr><th>${t('Companion.Summoner')}</th><th>${t('Companion.Companion')}</th><th>${t('Common.Status')}</th><th>HP</th><th>${t('Common.Scene')}</th><th>${t('Common.Actions')}</th></tr></thead><tbody>${rows.join('')||`<tr><td colspan="6">${safe(t('Companion.NoneOwned'))}</td></tr>`}</tbody></table><p class="notes">${t('Companion.ControllerNotes')}</p>`;
    return root;
  }
  _replaceHTML(result,content){content.replaceChildren(result);}
  _onRender(context,options){
    super._onRender(context,options);
    bindLanguageButton(this.element);
    this.element.querySelectorAll('button[data-planar-action]').forEach(el=>el.addEventListener('click',async()=>{
      try{const actor=await fromUuid(el.dataset.uuid);if(actor)await perform(el.dataset.planarAction,actor,()=>this.render());}
      catch(e){notify(e);}
    }));
  }
}
