import {fail} from '../i18n.mjs';
/** Scene-unit-independent radii are stored in feet; Foundry token light uses scene distance units. */
export const LIGHT_PRESETS = Object.freeze({
  candle: {label:'Candle',bright:5,dim:10,color:'#A2642A',alpha:.14,luminosity:.20,animation:'torch',speed:2,intensity:1,angle:360,maxIgnitions:5,burnSeconds:3600,fuelMode:'replace'},
  torch: {label:'Torch',bright:20,dim:40,color:'#FF9922',alpha:.24,luminosity:.32,animation:'torch',speed:3,intensity:2,angle:360,maxIgnitions:5,burnSeconds:3600,fuelMode:'replace'},
  lamp: {label:'Oil Lamp',bright:15,dim:45,color:'#FFCC77',alpha:.18,luminosity:.27,animation:'flame',speed:2,intensity:1,angle:360,maxIgnitions:10,burnSeconds:21600,fuelMode:'oil'},
  hooded: {label:'Hooded Lantern',bright:30,dim:60,color:'#FFD27A',alpha:.18,luminosity:.29,animation:'flame',speed:1,intensity:1,angle:360,maxIgnitions:10,burnSeconds:21600,fuelMode:'oil'},
  bullseye: {label:'Bullseye Lantern',bright:60,dim:120,color:'#FFD27A',alpha:.20,luminosity:.33,animation:'flame',speed:1,intensity:1,angle:60,maxIgnitions:10,burnSeconds:21600,fuelMode:'oil'},
  magic: {label:'Magic Light (permanent)',bright:20,dim:40,color:'#FFF4CC',alpha:.17,luminosity:.30,animation:'none',speed:1,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'},
  light: {label:'Light Cantrip',bright:20,dim:40,color:'#FFF4CC',alpha:.17,luminosity:.30,animation:'none',speed:1,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'},
  continual: {label:'Continual Flame',bright:20,dim:40,color:'#FFCC77',alpha:.18,luminosity:.26,animation:'flame',speed:1,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'},
  produce: {label:'Produce Flame',bright:10,dim:20,color:'#FF9922',alpha:.18,luminosity:.25,animation:'torch',speed:2,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'},
  daylight: {label:'Daylight Spell',bright:60,dim:120,color:'#FFFFEE',alpha:.12,luminosity:.4,animation:'none',speed:1,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'},
  beacon: {label:'Spectral Beacon',bright:10,dim:30,color:'#8F8BBE',alpha:.16,luminosity:.24,animation:'ghost',speed:1,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'},
  spectral: {label:'Spectral Aura',bright:0,dim:15,color:'#7773AC',alpha:.14,luminosity:.19,animation:'ghost',speed:1,intensity:1,angle:360,maxIgnitions:0,burnSeconds:0,fuelMode:'none'}
});
/** Auto-detect only known item names. Other lights must be assigned explicitly. */
export function classifyLightItem(name='') {
  const value=String(name).toLowerCase().replace(/[,_-]/g,' ').replace(/\s+/g,' ').trim();
  if (/\b(bullseye lantern|lantern bullseye)\b/.test(value)) return 'bullseye';
  if (/\b(hooded lantern|lantern hooded)\b/.test(value)) return 'hooded';
  if (/\b(oil lamp|lamp oil|oil lantern)\b/.test(value)) return 'lamp';
  if (/^lamp$/.test(value)) return 'lamp';
  if (/\bcandle\b/.test(value)) return 'candle';
  if (/\btorch\b/.test(value)) return 'torch';
  return null;
}
export function validateLightConfig(input={}) {
  const preset=String(input.preset??'torch');
  if (!Object.hasOwn(LIGHT_PRESETS,preset)) throw fail('Err.LightPreset');
  const defaults=LIGHT_PRESETS[preset];
  const value=(key,min,max,integer=false)=>{
    const n=Number(input[key]??defaults[key]);
    if (!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n))) throw fail('Err.LightValue',{key,min,max});
    return n;
  };
  const color=String(input.color??defaults.color);
  if(!/^#[0-9a-fA-F]{6}$/.test(color)) throw fail('Err.LightColor');
  const fuelMode=String(input.fuelMode??defaults.fuelMode);
  if(!['oil','replace','none'].includes(fuelMode)) throw fail('Err.FuelMode');
  const animation=String(input.animation??defaults.animation);
  if(!['none','torch','flame','pulse','ghost','chroma','emanation','energy','fairy','fog','hexa','lightning','radialrainbow','revolving','siren','smokepatch','starlight','sunburst','swirlingrainbow','vortex','wave'].includes(animation)) throw fail('Err.LightAnimation');
  const config={enabled:input.enabled!==false&&input.enabled!=='false',preset,bright:value('bright',0,1000),dim:value('dim',0,2000),color,alpha:value('alpha',0,1),luminosity:value('luminosity',-1,1),animation,speed:value('speed',0,10),intensity:value('intensity',0,10),angle:value('angle',1,360),maxIgnitions:value('maxIgnitions',0,1000,true),burnSeconds:value('burnSeconds',0,2592000,true),fuelMode,
    activityId:String(input.activityId??''),fuelItemUuid:String(input.fuelItemUuid??''),
    hoodClosed:Boolean(input.hoodClosed??false)};
  if(config.dim<config.bright)throw fail('Err.DimRadius');
  if(config.hoodClosed&&preset!=='hooded')config.hoodClosed=false;
  return config;
}
export function createLightState(config,previous={}) {
  const max=config.maxIgnitions;
  return {remainingIgnitions:Math.min(max,Math.max(0,Number.isFinite(Number(previous.remainingIgnitions))?Number(previous.remainingIgnitions):max)),
    remainingSeconds:Math.min(config.burnSeconds,Math.max(0,Number.isFinite(Number(previous.remainingSeconds))?Number(previous.remainingSeconds):config.burnSeconds)),
    litTokenUuid:String(previous.litTokenUuid??''),startedAt:Number.isFinite(Number(previous.startedAt))?Number(previous.startedAt):null};
}
export function burnElapsed(state,worldTime) {
  if(!state.litTokenUuid||!Number.isFinite(state.startedAt)||!Number.isFinite(worldTime))return {...state};
  return {...state,remainingSeconds:Math.max(0,state.remainingSeconds-Math.max(0,worldTime-state.startedAt)),startedAt:worldTime};
}
export function canIgnite(config,state){return (config.maxIgnitions===0||state.remainingIgnitions>0)&&(config.burnSeconds===0||state.remainingSeconds>0);}
export function decrementIgnition(config,state){if(!canIgnite(config,state))throw fail('Err.LightNeedsFuel');return {...state,remainingIgnitions:config.maxIgnitions===0?0:state.remainingIgnitions-1};}
export function convertRadiusFeet(feet,sceneUnits='ft'){
  const units=String(sceneUnits).toLowerCase().trim();
  if (['ft','feet','foot'].includes(units))return feet;
  if (['m','meter','meters','metre','metres'].includes(units))return Math.round(feet*.3048*100)/100;
  throw fail('Err.SceneUnits',{units:sceneUnits});
}
export function renderTokenLight(config,sceneUnits='ft') {
  const closed=config.preset==='hooded'&&config.hoodClosed;
  const bright=closed?0:config.bright,dim=closed?5:config.dim;
  return {bright:convertRadiusFeet(bright,sceneUnits),dim:convertRadiusFeet(dim,sceneUnits),color:config.color,alpha:config.alpha,luminosity:config.luminosity,angle:config.angle,animation:{type:config.animation,speed:config.speed,intensity:config.intensity}};
}
