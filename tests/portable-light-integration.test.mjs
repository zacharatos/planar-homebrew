import test from 'node:test';
import assert from 'node:assert/strict';
import {ignitePortableLight,extinguishPortableLight,togglePortableLight,refuelPortableLight,assignPortableLight,setHood,registerPortableLightAutomation,repairPortableLight,summarizeLight} from '../scripts/rules/light.mjs';

function createWorld({kind='torch',oil=2,quantity=3}={}){
  const scopes=new Map(),users={id:'GM',isGM:true},callbacks=new Map();
  const actor={id:'ACTOR',uuid:'Actor.ACTOR',name:'Tester',items:[],testUserPermission:()=>true};
  const item={id:'LIGHT',uuid:'Actor.ACTOR.Item.LIGHT',type:'equipment',name:kind==='torch'?'Torch':kind==='lamp'?'Oil Lamp':'Lantern, Hooded',parent:actor,system:{quantity},
    getFlag(scope,key){return scopes.get(this.uuid)?.[key]},
    async setFlag(scope,key,data){const o=scopes.get(this.uuid)??{};o[key]=structuredClone(data);scopes.set(this.uuid,o);return data;},
    async unsetFlag(scope,key){delete scopes.get(this.uuid)?.[key]},
    async update(diff){if('system.quantity' in diff)this.system.quantity=diff['system.quantity'];}
  };
  const oilItem={...item,id:'OIL',uuid:'Actor.ACTOR.Item.OIL',name:'Oil Flask',system:{quantity:oil}};
  actor.items=[item,oilItem];actor.items.get=id=>actor.items.find(i=>i.id===id);
  let data={bright:0,dim:0,color:'#000000',alpha:.5,luminosity:.5,angle:360,animation:{type:'none',speed:1,intensity:1}};
  let activeFlag={};
  const token={id:'TOKEN',uuid:'Scene.SCENE.Token.TOKEN',actorId:'ACTOR',documentName:'Token',parent:{grid:{units:'ft'}},
    canUserModify:()=>true,getFlag(_scope,key){return activeFlag[key]},async unsetFlag(scope,key){delete activeFlag[key]},
    get light(){return {toObject:()=>structuredClone(data)}},
    async update(change){if(change.light)data={...data,...structuredClone(change.light)};for(const [key,value] of Object.entries(change))if(key==='flags.planar-homebrew.activePortableLight')activeFlag.activePortableLight=structuredClone(value);}
  };
  const scene={id:'SCENE',grid:{units:'ft'},tokens:[token]};
  globalThis.foundry={utils:{deepClone:structuredClone}};
  globalThis.canvas={scene,tokens:{controlled:[{document:token}]}};
  globalThis.game={user:users,time:{worldTime:1000},users:{activeGM:users},actors:{contents:[actor]},settings:{get:()=>false}};
  globalThis.ui={notifications:{warn:()=>{},info:()=>{},error:()=>{}}};
  globalThis.fromUuid=async uuid=>uuid===token.uuid?token:uuid===item.uuid?item:uuid===oilItem.uuid?oilItem:null;
  globalThis.Hooks={on(name,fn){const l=callbacks.get(name)??[];l.push(fn);callbacks.set(name,l);},async call(name,...args){for(const f of callbacks.get(name)??[])await f(...args);}};
  return {actor,item,oilItem,token,getLight:()=>structuredClone(data),getActive:()=>activeFlag.activePortableLight,callbacks};
}
test('lighting a torch updates owned token, tracks one ignition and restores previous light',async()=>{
  const w=createWorld();
  assert.match(await ignitePortableLight(w.item),/4\/5/);
  assert.equal(w.getLight().bright,20);
  assert.equal(w.getLight().dim,40);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,4);
  assert.match(await extinguishPortableLight(w.item),/extinguished/);
  assert.equal(w.getLight().color,'#000000');
  assert.equal(w.getLight().bright,0);
  assert.equal(w.getActive(),undefined);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,4);
  await ignitePortableLight(w.item);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,3);
});
test('consecutive light presses toggle, depleted item refuses sixth ignition',async()=>{
  const w=createWorld();
  for(let i=0;i<5;i++){await togglePortableLight(w.item);await togglePortableLight(w.item);}
  await assert.rejects(ignitePortableLight(w.item),/exhausted/);
  assert.equal(w.getLight().bright,0);
});
test('two rapid ignition attempts cannot consume more than one charge',async()=>{
  const w=createWorld();
  const results=await Promise.allSettled([ignitePortableLight(w.item),ignitePortableLight(w.item)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,4);
});
test('switching item restores original and lights the second item',async()=>{
  const w=createWorld({kind:'torch'});
  w.oilItem.name='Oil Lamp';
  await ignitePortableLight(w.item);
  await ignitePortableLight(w.oilItem);
  assert.equal(w.getLight().bright,15);
  assert.equal(summarizeLight(w.item).state.litTokenUuid,'');
  assert.equal(summarizeLight(w.oilItem).state.remainingIgnitions,9);
});
test('oil lantern refill consumes exactly one inventory Oil Item',async()=>{
  const w=createWorld({kind:'lamp'});
  await assignPortableLight(w.item,{preset:'lamp',fuelItemUuid:w.oilItem.uuid});
  await refuelPortableLight(w.item);
  assert.equal(w.oilItem.system.quantity,1);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,10);
  await refuelPortableLight(w.item);
  assert.equal(w.oilItem.system.quantity,0);
  await assert.rejects(refuelPortableLight(w.item),/quantity at least 1/);
});
test('torch replacement decrements inventory stack',async()=>{
  const w=createWorld({quantity:2});
  await ignitePortableLight(w.item);await extinguishPortableLight(w.item);
  await refuelPortableLight(w.item);
  assert.equal(w.item.system.quantity,1);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,5);
  await assert.rejects(refuelPortableLight(w.item),/No unused replacement/);
});
test('clock reconciliation extinguishes at end of remaining burn duration',async()=>{
  const {reconcilePortableLight}=await import('../scripts/rules/light.mjs');
  const w=createWorld({kind:'torch'});
  await ignitePortableLight(w.item);
  game.time.worldTime+=3601;
  assert.equal(await reconcilePortableLight(w.item),true);
  assert.equal(summarizeLight(w.item).state.remainingSeconds,0);
  assert.equal(summarizeLight(w.item).state.litTokenUuid,'');
  assert.equal(w.getLight().bright,0);
});
test('external lighting change is preserved on extinguish',async()=>{
  const w=createWorld();
  await ignitePortableLight(w.item);
  await w.token.update({light:{bright:100}});
  await extinguishPortableLight(w.item);
  assert.equal(w.getLight().bright,100);
  assert.equal(w.getActive(),undefined);
});
test('lowering hood changes light without consuming ignition',async()=>{
  const w=createWorld({kind:'hooded'});
  await ignitePortableLight(w.item);
  await setHood(w.item,true);
  assert.equal(w.getLight().bright,0);
  assert.equal(w.getLight().dim,5);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,9);
  await setHood(w.item,false);
  assert.equal(w.getLight().bright,30);
});
test('automated activity ignores attacking with a torch and uses Utility activity only',async()=>{
  const w=createWorld();
  registerPortableLightAutomation();
  await Hooks.call('dnd5e.postUseActivity',{item:w.item,type:'attack',id:'ATTACK'});
  assert.equal(w.getLight().bright,0);
  await Hooks.call('dnd5e.postUseActivity',{item:w.item,type:'utility',id:'UTILITY'});
  // Hook is intentionally fire-and-forget; resolve next task queue cycle.
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(w.getLight().bright,20);
  assert.equal(summarizeLight(w.item).state.remainingIgnitions,4);
});
