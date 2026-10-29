import test from 'node:test';
import assert from 'node:assert/strict';
import {LIGHT_PRESETS,classifyLightItem,validateLightConfig,createLightState,decrementIgnition,burnElapsed,canIgnite,convertRadiusFeet,renderTokenLight} from '../scripts/core/light-presets.mjs';

test('legacy macro presets keep the proper absolute dim radii',()=>{
  for(const [type,bright,dim] of [['candle',5,10],['torch',20,40],['lamp',15,45],['hooded',30,60],['bullseye',60,120]]){
    const config=validateLightConfig({preset:type});
    assert.equal(config.bright,bright);assert.equal(config.dim,dim);
  }
});
test('recognizes common official lantern names, including inverted commas',()=>{
  assert.equal(classifyLightItem('Lantern, Hooded'),'hooded');
  assert.equal(classifyLightItem('Lantern, Bullseye'),'bullseye');
  assert.equal(classifyLightItem('Oil Lamp'),'lamp');
  assert.equal(classifyLightItem('Ancient torch'),'torch');
  assert.equal(classifyLightItem('Flaming Sword'),null);
});
test('configured light has unique colors, opacity, animation, and cone',()=>{
  const config=validateLightConfig({preset:'bullseye',color:'#112233',alpha:.25,luminosity:.13});
  const light=renderTokenLight(config);
  assert.equal(light.color,'#112233');assert.equal(light.angle,60);assert.equal(light.bright,60);assert.equal(light.dim,120);
  assert.equal(light.animation.type,'flame');assert.equal(light.alpha,.25);
});
test('torch consumes five ignitions, extinguishing must not decrement',()=>{
  const config=validateLightConfig({preset:'torch'});
  let state=createLightState(config);
  for(let i=0;i<5;i++)state=decrementIgnition(config,state);
  assert.equal(state.remainingIgnitions,0);assert.equal(canIgnite(config,state),false);
  assert.throws(()=>decrementIgnition(config,state),/needs a replacement/);
});
test('oil lamp consumes ten ignitions; must refuel after tenth',()=>{
  const config=validateLightConfig({preset:'lamp'});
  let state=createLightState(config);
  for(let i=0;i<10;i++)state=decrementIgnition(config,state);
  assert.equal(state.remainingIgnitions,0);assert.equal(canIgnite(config,state),false);
});
test('clock time decrements only while lit; extinguished time remains unchanged',()=>{
  const config=validateLightConfig({preset:'lamp'});
  const off=createLightState(config),start={...off,litTokenUuid:'Scene.s.Token.t',startedAt:100};
  const after=burnElapsed(start,3700);
  assert.equal(after.remainingSeconds,18000);
  assert.equal(burnElapsed({...after,litTokenUuid:'',startedAt:null},10000).remainingSeconds,18000);
});
test('elapsed time caps at zero; backwards time never refunds fuel',()=>{
  const config=validateLightConfig({preset:'candle'}),state={...createLightState(config),litTokenUuid:'t',startedAt:100,remainingSeconds:1000};
  assert.equal(burnElapsed(state,4000).remainingSeconds,0);
  assert.equal(burnElapsed(state,50).remainingSeconds,1000);
});
test('meters conversion, closed hood, unlimited magical light',()=>{
  assert.equal(convertRadiusFeet(20,'m'),6.1);
  const config=validateLightConfig({preset:'hooded',hoodClosed:true});
  assert.equal(renderTokenLight(config,'ft').bright,0);
  assert.equal(renderTokenLight(config,'ft').dim,5);
  const magic=validateLightConfig({preset:'magic'});
  assert.equal(canIgnite(magic,createLightState(magic)),true);
});
test('invalid settings are rejected before writing any documents',()=>{
  assert.throws(()=>validateLightConfig({preset:'torch',bright:40,dim:20}),/dim radius/);
  assert.throws(()=>validateLightConfig({preset:'torch',color:'blue'}),/#RRGGBB/);
  assert.throws(()=>validateLightConfig({preset:'torch',maxIgnitions:-1}),/Invalid/);
  assert.throws(()=>convertRadiusFeet(20,'hexes'),/Unsupported scene/);
});

test('magical presets from original controller preserve distinct radii',()=>{
  for(const [preset,bright,dim] of [['light',20,40],['continual',20,40],['produce',10,20],['daylight',60,120],['spectral',0,15],['beacon',10,30]]){
    const config=validateLightConfig({preset});
    assert.equal(config.bright,bright);assert.equal(config.dim,dim);
    assert.equal(config.maxIgnitions,0);
    assert.equal(canIgnite(config,createLightState(config)),true);
  }
});
