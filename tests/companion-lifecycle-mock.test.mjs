import test from 'node:test';
import assert from 'node:assert/strict';
import {performCompanionAction,inspectVestige,registerCompanionQueries} from '../scripts/rules/vestige.mjs';

/** Simulated Foundry documents. Not a running Foundry V14 world. */
function createWorld({slots=2}={}){
  const hookMap=new Map(),events=[],gm={id:'GM',isGM:true,active:true};
  globalThis.Hooks={
    on(name,callback){const callbacks=hookMap.get(name)??new Set();callbacks.add(callback);hookMap.set(name,callbacks);},
    off(name,callback){hookMap.get(name)?.delete(callback);},
    async call(name,...args){for(const f of hookMap.get(name)??[])await f(...args);}
  };
  let oldState={companionUuid:'Actor.COMPANION',state:'dismissed',enabled:true,range:60,requireCasting:true,
    castingItemUuid:'Actor.SUMMONER.Item.SPELL',castingActivityId:'CAST',lightPreset:'aura',commandCost:'bonus',allowPlayerControls:true,requireOutsideCombatRecall:true};
  const companion={id:'COMPANION',uuid:'Actor.COMPANION',parent:null,
    prototypeToken:{width:1,height:1},system:{attributes:{hp:{value:5,max:5}}},
    async update(data){this.system.attributes.hp.value=data['system.attributes.hp.value'];},
    async getTokenDocument(data){return {toObject:()=>data}}};
  const activity={id:'CAST',type:'utility',async use(){
    events.push('native-cast');
    const slot=summoner.system.spells.spell1;
    if(slot.value)slot.value-=1;
    await Hooks.call('dnd5e.postActivityConsumption',this,{}, {},{});
  }};
  const spell={uuid:'Actor.SUMMONER.Item.SPELL',id:'SPELL',type:'spell',system:{activities:new Map([['CAST',activity]])}};
  activity.item=spell;
  const summoner={id:'SUMMONER',uuid:'Actor.SUMMONER',parent:null,name:'Summoner',
    items:[spell],system:{spells:{spell1:{value:slots}}},
    getFlag(_scope,key){return key==='vestige'?oldState:null;},
    async setFlag(_scope,key,value){if(key==='vestige'){oldState=value;events.push('save-state');}},
    testUserPermission(user){return user.id==='GM'||user.id==='PLAYER'}};
  const tokens=[{id:'MAIN',uuid:'Scene.SCENE.Token.MAIN',actorId:'SUMMONER',x:100,y:100,width:1,height:1,getFlag:()=>undefined}];
  let count=0;
  const scene={id:'SCENE',name:'Test Field',grid:{size:100,distance:5},
    dimensions:{width:1200,height:1200},tokens,
    async createEmbeddedDocuments(_kind,payload){
      const input=payload[0];const id=`TOKEN${++count}`;
      const token={...input,id,uuid:`Scene.SCENE.Token.${id}`,actorId:'COMPANION',width:1,height:1,
        parent:scene,getFlag(_scope,key){return this.flags?.['planar-homebrew']?.[key];}};
      tokens.push(token);events.push('create-token');return [token];
    },
    async deleteEmbeddedDocuments(_kind,ids){for(const id of ids){const i=tokens.findIndex(t=>t.id===id);if(i!==-1)tokens.splice(i,1);}events.push('delete-token');}
  };
  globalThis.game={user:gm,users:{activeGM:gm},actors:{get:(id)=>id==='SUMMONER'?summoner:id==='COMPANION'?companion:null,
    contents:[summoner,companion]},scenes:{get:(id)=>id==='SCENE'?scene:null,[Symbol.iterator]:function*(){yield scene;}},
    combats:{[Symbol.iterator]:function*(){}}};
  globalThis.canvas={scene,tokens:{controlled:[]}};
  globalThis.fromUuid=async uuid=>uuid===companion.uuid?companion:uuid===summoner.uuid?summoner:null;
  globalThis.ChatMessage={getSpeaker:()=>({}),create:async()=>{events.push('chat');}};
  globalThis.foundry={utils:{escapeHTML:(x)=>x}};
  return {summoner,companion,scene,events,gm,slots:()=>summoner.system.spells.spell1.value,config:()=>oldState};
}
test('native slot consumed once, linked token placed, recalled and returned without another spell, dismissed and then re-cast',async()=>{
  const world=createWorld();
  assert.match(await performCompanionAction(world.summoner,'manifest',{point:{x:300,y:200}}),/manifested/i);
  assert.equal(world.slots(),1);
  assert.equal(world.config().state,'manifested');
  assert.equal(world.scene.tokens.length,2);
  assert.ok(world.events.indexOf('native-cast')<world.events.indexOf('create-token'));
  assert.equal((await inspectVestige(world.summoner)).tokens.length,1);
  await performCompanionAction(world.summoner,'recall');
  assert.equal(world.config().state,'dormant');
  assert.equal(world.scene.tokens.length,1);
  await performCompanionAction(world.summoner,'return',{point:{x:200,y:200}});
  assert.equal(world.slots(),1);
  assert.equal(world.config().state,'manifested');
  await performCompanionAction(world.summoner,'dismiss');
  assert.equal(world.config().state,'dismissed');
  assert.equal(world.scene.tokens.length,1);
  await performCompanionAction(world.summoner,'manifest',{point:{x:200,y:200}});
  assert.equal(world.slots(),0);
  assert.equal(world.config().state,'manifested');
  assert.equal(world.scene.tokens.length,2);
});
test('without an available slot, manifestation creates no token',async()=>{
  const world=createWorld({slots:0});
  await assert.rejects(performCompanionAction(world.summoner,'manifest',{point:{x:200,y:200}}),/no exactly-one/i);
  assert.equal(world.scene.tokens.length,1);
  assert.equal(world.config().state,'dismissed');
});
test('duplicate manifestation does not consume additional slots',async()=>{
  const world=createWorld();
  await performCompanionAction(world.summoner,'manifest',{point:{x:200,y:200}});
  await assert.rejects(performCompanionAction(world.summoner,'manifest',{point:{x:300,y:300}}),/cannot manifest/i);
  assert.equal(world.slots(),1);
});
test('invalid coordinates do not spend spell slot',async()=>{
  const world=createWorld();
  await assert.rejects(performCompanionAction(world.summoner,'manifest',{point:{x:1100,y:1100}}),/within/i);
  assert.equal(world.slots(),2);
});

test('player casts with native Activity after explicit GM approval and GM verifies slot decrement before placing token',async()=>{
  const world=createWorld();
  const player={id:'PLAYER',isGM:false};
  globalThis.CONFIG={queries:{}};
  foundry.utils.randomID=()=> 'test-nonce';
  foundry.applications={api:{DialogV2:{confirm:async()=>true}}};
  world.gm.query=async(_type,payload)=>{
    const previous=game.user;game.user=world.gm;
    try{return await CONFIG.queries[_type](payload);}
    finally{game.user=previous;}
  };
  registerCompanionQueries();
  game.user=player;
  const result=await performCompanionAction(world.summoner,'manifest',{point:{x:200,y:200}});
  assert.match(result,/manifested/i);
  assert.equal(world.slots(),1);
  assert.equal(world.scene.tokens.length,2);
  assert.equal(world.config().state,'manifested');
  assert.ok(world.events.indexOf('native-cast')<world.events.indexOf('create-token'));
  await performCompanionAction(world.summoner,'recall');
  assert.equal(world.config().state,'dormant');
  await performCompanionAction(world.summoner,'return',{point:{x:200,y:200}});
  assert.equal(world.config().state,'manifested');
  assert.equal(world.slots(),1);
});
test('GM rejection blocks native casting and token creation',async()=>{
  const world=createWorld();
  const player={id:'PLAYER',isGM:false};
  globalThis.CONFIG={queries:{}};
  foundry.utils.randomID=()=> 'nonce';
  foundry.applications={api:{DialogV2:{confirm:async()=>false}}};
  world.gm.query=async(_type,payload)=>{const previous=game.user;game.user=world.gm;
    try{return await CONFIG.queries[_type](payload);}finally{game.user=previous;}};
  registerCompanionQueries();game.user=player;
  await assert.rejects(performCompanionAction(world.summoner,'manifest',{point:{x:200,y:200}}),/did not authorize/i);
  assert.equal(world.slots(),2);assert.equal(world.scene.tokens.length,1);
});

test('Manifest Vestige (hpMode vestige): full AU hit points for the warlock level on every manifestation',async()=>{
  const world=createWorld();
  world.summoner.classes={warlock:{system:{levels:4}}};
  world.config().hpMode='vestige';
  world.companion.system.attributes.hp.value=0;   // dropped to 0 last time: a new cast brings it back
  world.companion.update=async function(data){
    if('system.attributes.hp.max' in data)this.system.attributes.hp.max=data['system.attributes.hp.max'];
    if('system.attributes.hp.value' in data)this.system.attributes.hp.value=data['system.attributes.hp.value'];
  };
  assert.match(await performCompanionAction(world.summoner,'manifest',{point:{x:300,y:200}}),/manifested/i);
  assert.equal(world.companion.system.attributes.hp.max,20,'4 + 4 × 4');
  assert.equal(world.companion.system.attributes.hp.value,20);
  assert.equal(world.slots(),1,'one slot spent');
});

test('the companion vanishes when its hero dies (Planar Glitch death or the Dead status)',async()=>{
  const {vanishWithSummoner}=await import('../scripts/rules/vestige.mjs');
  const world=createWorld();
  await performCompanionAction(world.summoner,'manifest',{point:{x:300,y:200}});
  assert.equal(world.scene.tokens.length,2);
  assert.match(await vanishWithSummoner(world.summoner),/vanished/);
  assert.equal(world.config().state,'dismissed');
  assert.equal(world.scene.tokens.length,1,'its token is gone');
  assert.equal(await vanishWithSummoner(world.summoner),null,'nothing to do twice');
  world.config().vanishOnDeath=false;
  world.config().state='manifested';
  assert.equal(await vanishWithSummoner(world.summoner),null,'opt-out respected');
});
