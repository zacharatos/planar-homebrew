import test from 'node:test';
import assert from 'node:assert/strict';
import {TOKEN_LIGHT_PRESETS,TOKEN_LIGHT_GROUPS,buildTokenLight,feetToSceneUnits,resolveSwitchAction,softenedLook,savedLook,pickTargets,emitsLight} from '../scripts/core/token-lights.mjs';

test('every preset is in exactly one menu group, with the macro radii',()=>{
  const grouped=Object.values(TOKEN_LIGHT_GROUPS).flat();
  assert.deepEqual([...grouped].sort(),Object.keys(TOKEN_LIGHT_PRESETS).sort());
  assert.deepEqual([TOKEN_LIGHT_PRESETS.torch.bright,TOKEN_LIGHT_PRESETS.torch.dim],[20,40]);
  assert.deepEqual([TOKEN_LIGHT_PRESETS.aura.bright,TOKEN_LIGHT_PRESETS.aura.dim],[0,15]);
  assert.equal(TOKEN_LIGHT_PRESETS.bull.angle,60);
});
test('a preset becomes a full token light, merged over the current one',()=>{
  const light=buildTokenLight('aura',{current:{attenuation:.7,bright:99},animations:{ghost:{}}});
  assert.equal(light.attenuation,.7,'fields we do not set are kept');
  assert.equal(light.bright,0);assert.equal(light.dim,15);
  assert.equal(light.animation.type,'ghost');
  assert.equal(light.negative,false);
  assert.deepEqual(light.darkness,{min:0,max:1});
});
test('strength changes the look, never the radii; unknown animations are dropped',()=>{
  const gentle=buildTokenLight('torch'),vivid=buildTokenLight('torch',{strength:'vivid',animations:{flame:{}}});
  assert.equal(vivid.dim,gentle.dim);
  assert.ok(vivid.alpha>gentle.alpha);
  assert.equal(vivid.animation.type,'','torch animation not offered → none');
  assert.equal(buildTokenLight('nope'),null);
});
test('metric scenes get metres, other units stay feet',()=>{
  assert.equal(feetToSceneUnits(30,'m'),9.14);
  assert.equal(feetToSceneUnits(30,'ft'),30);
  assert.equal(feetToSceneUnits(30,'squares'),30);
  assert.equal(buildTokenLight('torch',{units:'m'}).dim,12.19);
});
test('switchboard: toggle, soften and target picking follow the macro',()=>{
  assert.equal(resolveSwitchAction('toggle',{lit:true,saved:false}),'off');
  assert.equal(resolveSwitchAction('toggle',{lit:false,saved:false}),'on');
  assert.equal(resolveSwitchAction('toggle',{lit:false,saved:true}),'on');
  assert.equal(resolveSwitchAction('soften',{lit:true}),'soften');
  const look=softenedLook({alpha:.8,luminosity:.9});
  assert.equal(look.alpha,.23);assert.equal(look.luminosity,.3);
  assert.deepEqual(Object.keys(savedLook({alpha:1})),['alpha','luminosity','coloration','saturation','contrast','shadows']);
  const all=['A:1','T:2','T:3'];
  assert.deepEqual(pickTargets('all',{all}),all);
  assert.deepEqual(pickTargets('selected',{all,selected:['T:2','X']}),['T:2']);
  assert.deepEqual(pickTargets('manual',{all,checked:['T:3','T:3']}),['T:3']);
  assert.equal(emitsLight({bright:0,dim:5}),true);
  assert.equal(emitsLight({bright:0,dim:5,negative:true}),false);
});

// ---- Foundry side, against mocked documents ----
function doc({id,kind='token',light={bright:20,dim:40,alpha:.5,luminosity:.5},hidden=false,owner=true,flags={}}){
  return {id,name:id,hidden,isOwner:owner,parent:{grid:{units:'ft'}},flags:structuredClone(flags),
    light:kind==='token'?structuredClone(light):undefined,config:kind==='ambient'?structuredClone(light):undefined,
    getFlag(scope,key){return this.flags[scope]?.[key];},
    async unsetFlag(scope,key){delete this.flags[scope]?.[key];},
    async update(change){for(const [path,value] of Object.entries(change)){
      if(path==='light'){this.light=structuredClone(value);continue;}
      const parts=path.split('.');let o=this;for(const p of parts.slice(0,-1))o=o[p]??={};o[parts.at(-1)]=structuredClone(value);
    }}};
}
function setup(user={isGM:true}){
  globalThis.game={user};globalThis.CONFIG={Canvas:{lightAnimations:{torch:{},ghost:{}}}};
  globalThis.foundry={utils:{deepClone:structuredClone}};
  globalThis.ui={notifications:{warn(){},info(){},error(){}}};
  globalThis.fromUuid=async()=>null;
}
test('applyTokenLight: only the GM puts presets on tokens (the vestige too)',async()=>{
  setup({isGM:false});
  const {applyTokenLight,tokenPreset}=await import('../scripts/rules/token-lights.mjs');
  const vestige=doc({id:'Vestige',light:{bright:0,dim:0}});
  await assert.rejects(applyTokenLight(vestige,'aura'),/Only the GM/);
  assert.equal(vestige.light.dim,0);
  setup({isGM:true});
  assert.match(await applyTokenLight(vestige,'aura'),/Vestige/);
  assert.equal(vestige.light.dim,15);
  assert.equal(tokenPreset(vestige),'aura');
});
test('switchLights: off saves, on restores, toggle, soften and restore look; old macro flags still restore',async()=>{
  setup();
  const {switchLights}=await import('../scripts/rules/token-lights.mjs');
  const torch=doc({id:'Torch'}),lamp=doc({id:'Lamp',kind:'ambient'});
  const src=[{doc:torch,kind:'token',label:'Torch'},{doc:lamp,kind:'ambient',label:'Lamp'}];
  let r=await switchLights(src,'off');
  assert.deepEqual([r.changed,r.skipped],[2,0]);
  assert.equal(torch.light.bright,0);assert.equal(lamp.hidden,true);
  r=await switchLights(src,'off');assert.equal(r.skipped,2,'already off');
  r=await switchLights(src,'on');assert.equal(r.changed,2);
  assert.equal(torch.light.bright,20);assert.equal(lamp.hidden,false);
  assert.equal(torch.flags['planar-homebrew'].lightSwitch,undefined);
  await switchLights(src,'soften');
  assert.equal(torch.light.alpha,.225);
  assert.equal(lamp.config.alpha,.225);
  await switchLights(src,'lookrestore');
  assert.equal(torch.light.alpha,.5);
  const legacy=doc({id:'Old',light:{bright:0,dim:0},flags:{world:{nytherisLightSwitchV2:{kind:'token',light:{bright:10,dim:30}}}}});
  r=await switchLights([{doc:legacy,kind:'token',label:'Old'}],'toggle');
  assert.equal(legacy.light.dim,30,'restored from the old macro');
  assert.equal(legacy.flags.world.nytherisLightSwitchV2,undefined);
  const hiddenByHand=doc({id:'Hidden',kind:'ambient',hidden:true});
  assert.equal((await switchLights([{doc:hiddenByHand,kind:'ambient',label:'H'}],'on',{scope:'all'})).skipped,1,'"all" never reveals lights hidden by hand');
  assert.equal((await switchLights([{doc:hiddenByHand,kind:'ambient',label:'H'}],'on',{scope:'manual'})).changed,1);
});
