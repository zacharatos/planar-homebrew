// Planar Homebrew: our campaign's homebrew rules as one module. Hooks only; the rules live in rules/,
// the windows in ui/, pure helpers in core/ and util.mjs (dev guide § 3).
import {ID} from './core/constants.mjs';
import {RuleRegistry} from './core/registry.mjs';
import {loadDictionaries,t} from './i18n.mjs';
import {isSupportedSystemVersion} from './util.mjs';
import {resonanceRule,calculateResonance,registerResonanceAutomation} from './rules/resonance.mjs';
import {vestigeRule,watchCompanions,registerCompanionQueries,performCompanionAction,heroForToken,companionHeroes} from './rules/vestige.mjs';
import {applyTokenLight,switchLights,sceneLightSources} from './rules/token-lights.mjs';
import {TOKEN_LIGHT_PRESETS} from './core/token-lights.mjs';
import {PlanarHomebrewManager,PlanarCompanionStatus} from './ui/manager.mjs';
import {lightRule,registerPortableLightAutomation,togglePortableLight,ignitePortableLight,extinguishPortableLight} from './rules/light.mjs';
import {PlanarLightController} from './ui/light-ui.mjs';
import {deathSaveRule,registerBlindDeathSaves,rollBlindDeathSave,getPrivateDeathState,addPrivateDeathFailure} from './rules/death-saves.mjs';

const registry=new RuleRegistry().register(resonanceRule).register(vestigeRule).register(lightRule).register(deathSaveRule);
const diagnostics=[];
const record=(message)=>{diagnostics.push(`${new Date().toLocaleTimeString()} · ${message}`);if(diagnostics.length>100)diagnostics.shift();try{if(game.settings.get(ID,'debug'))console.info(`${ID}: ${message}`);}catch{/* before init */}};
const WINDOWS={manager:PlanarHomebrewManager,companions:PlanarCompanionStatus,lights:PlanarLightController};
const open=(kind,options={})=>{
  const Cls=WINDOWS[kind];
  const app=foundry.applications.instances?.get?.(Cls.DEFAULT_OPTIONS.id)??new Cls();
  app.configure?.(options);
  return app.render({force:true});
};
/** Redraw the open Lights / Companions windows after token, light or actor changes (debounced). */
let redrawTimer=null;
const redrawLive=()=>{
  clearTimeout(redrawTimer);
  redrawTimer=setTimeout(()=>{for(const kind of ['lights','companions']){
    const app=foundry.applications.instances?.get?.(WINDOWS[kind].DEFAULT_OPTIONS.id);
    if(app?.rendered){app._remember?.();app.render();}
  }},200);
};
/** Re-draw our open windows (after a language switch). */
const rerender=()=>{for(const Cls of Object.values(WINDOWS))foundry.applications.instances?.get?.(Cls.DEFAULT_OPTIONS.id)?.render();};

Hooks.once('init',()=>{
  const S='PLANAR_HOMEBREW.Settings.';
  registerCompanionQueries(record);
  game.settings.registerMenu(ID,'manager',{name:`${S}Manager.Name`,label:`${S}Manager.Label`,hint:`${S}Manager.Hint`,icon:'fa-solid fa-wand-magic-sparkles',type:PlanarHomebrewManager,restricted:true});
  game.settings.registerMenu(ID,'companionStatus',{name:`${S}Companions.Name`,label:`${S}Companions.Label`,hint:`${S}Companions.Hint`,icon:'fa-solid fa-dragon',type:PlanarCompanionStatus,restricted:false});
  game.settings.registerMenu(ID,'lightController',{name:`${S}Lights.Name`,label:`${S}Lights.Label`,hint:`${S}Lights.Hint`,icon:'fa-solid fa-fire-flame-curved',type:PlanarLightController,restricted:false});
  const world=(key,type,def,extra={})=>game.settings.register(ID,key,{name:`${S}${key}.Name`,hint:`${S}${key}.Hint`,scope:'world',config:true,type,default:def,...extra});
  world('deathSavesEnabled',Boolean,true);
  world('deathSavesAuto',Boolean,true);
  world('deathSavesNPCs',Boolean,false);
  world('textLanguage',String,'el',{choices:{el:'Ελληνικά',en:'English'},onChange:rerender});
  world('companionApproval',Boolean,false);
  world('debug',Boolean,false);
  game.settings.register(ID,'language',{name:`${S}language.Name`,hint:`${S}language.Hint`,scope:'client',config:true,type:String,default:'',
    choices:{'':`${S}language.Default`,el:'Ελληνικά',en:'English'},onChange:rerender});
  game.keybindings.register(ID,'manager',{name:`${S}Manager.Name`,editable:[],restricted:true,onDown:()=>{open('manager');return true;}});
});

Hooks.once('setup',()=>{void loadDictionaries().then(rerender);});

Hooks.once('ready',()=>{
  if(game.system.id!=='dnd5e'){ui.notifications.error(t('Note.NeedsDnd5e'));return;}
  if(game.user.isGM&&!isSupportedSystemVersion(game.system.version))ui.notifications.warn(t('Note.SystemUntested',{version:game.system.version}));
  if(game.user.isGM&&game.release?.generation!==14)ui.notifications.warn(t('Note.FoundryUntested'));
  registerResonanceAutomation(record);
  watchCompanions(record);
  registerPortableLightAutomation(record);
  registerBlindDeathSaves(record);
  const api=Object.freeze({registry,diagnostics,
    open:()=>open('manager'),openManager:()=>open('manager'),openStatus:()=>open('companions'),openLights:(options)=>open('lights',options),
    performCompanionAction,calculateResonance,togglePortableLight,ignitePortableLight,extinguishPortableLight,
    applyTokenLight,switchLights,sceneLightSources,lightPresets:()=>Object.keys(TOKEN_LIGHT_PRESETS),
    rollBlindDeathSave,getPrivateDeathState,addPrivateDeathFailure});
  const module=game.modules.get(ID);
  if(module)module.api=api;
  game.planarHomebrew=api; // kept for macros written against 0.6.0
});

// Token-controls buttons: the manager for the GM; lights and companions for everyone.
Hooks.on('getSceneControlButtons',controls=>{
  const tools=controls?.tokens?.tools;
  if(!tools)return;
  const add=(name,title,icon,order,kind,visible=true)=>{tools[`${ID}-${name}`]={name:`${ID}-${name}`,title,icon,order,button:true,visible,onChange:()=>open(kind)};};
  add('manager','PLANAR_HOMEBREW.Tools.Manager','fa-solid fa-wand-magic-sparkles',62,'manager',Boolean(game.user?.isGM));
  add('lights','PLANAR_HOMEBREW.Tools.Lights','fa-solid fa-fire-flame-curved',63,'lights');
  // Only for users who own a hero with a bound companion (and the GM).
  const hasCompanion=Boolean(game.user?.isGM||(game.actors?.contents&&companionHeroes().length));
  add('companions','PLANAR_HOMEBREW.Tools.Companions','fa-solid fa-dragon',64,'companions',hasCompanion);
});

for(const hook of ['createToken','updateToken','deleteToken','createAmbientLight','updateAmbientLight','deleteAmbientLight','canvasReady','updateActor'])Hooks.on(hook,redrawLive);
// Clicking a token on the map picks it in the Lights window's token tab.
Hooks.on('controlToken',(token,controlled)=>{
  const app=foundry.applications.instances?.get?.(PlanarLightController.DEFAULT_OPTIONS.id);
  if(!app?.rendered)return;
  app._remember?.();
  if(controlled&&token?.id)app.choice.tokenId=token.id;
  redrawLive();
});

// Token HUD (right-click a token): a light button on every token the user owns, and a companion button
// on a hero with a bound companion or on the companion itself.
Hooks.on('renderTokenHUD',(hud,html)=>{
  const root=html instanceof HTMLElement?html:html?.[0];
  const doc=hud?.object?.document;
  if(!root||!doc||!(game.user.isGM||doc.isOwner))return;
  const column=root.querySelector('.col.left')??root.querySelector('.col.right');
  if(!column)return;
  const add=(icon,tooltip,onClick)=>{
    const button=document.createElement('button');
    button.type='button';button.className='control-icon planar-hud';button.dataset.tooltip=t(tooltip);
    button.innerHTML=`<i class="${icon}"></i>`;
    button.addEventListener('click',ev=>{ev.preventDefault();ev.stopPropagation();onClick();});
    column.append(button);
  };
  add('fa-solid fa-lightbulb','Tools.TokenLight',()=>open('lights',{tab:'token',tokenId:doc.id}));
  const hero=heroForToken(doc);
  if(hero&&(game.user.isGM||hero.testUserPermission(game.user,'OWNER')))add('fa-solid fa-dragon','Tools.Companions',()=>open('companions'));
});
