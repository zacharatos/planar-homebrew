import test from 'node:test';
import assert from 'node:assert/strict';
import {performCompanionAction,inspectVestige,registerCompanionQueries,registerCompanionCasting,setPlacementPicker,bindVestige,repairCompanionState,heroForToken} from '../scripts/rules/vestige.mjs';

/** Simulated Foundry documents. Not a running Foundry V14 world. */
function createWorld({slots=2,pact=1,costMode='spell',approval=false}={}){
  const hookMap=new Map(),events=[],gm={id:'GM',name:'GM',isGM:true,active:true},player={id:'PLAYER',name:'Player',isGM:false,active:true};
  globalThis.Hooks={
    on(name,callback){const callbacks=hookMap.get(name)??new Set();callbacks.add(callback);hookMap.set(name,callbacks);},
    off(name,callback){hookMap.get(name)?.delete(callback);},
    async call(name,...args){let ok=true;for(const f of hookMap.get(name)??[])if(await f(...args)===false)ok=false;return ok;}
  };
  let oldState={companionUuid:'Actor.COMPANION',state:'dismissed',enabled:true,range:60,costMode,requireCasting:costMode==='spell',
    castingItemUuid:'Actor.SUMMONER.Item.SPELL',castingActivityId:'CAST',lightPreset:'aura',commandCost:'bonus',allowPlayerControls:true,requireOutsideCombatRecall:true};
  const companion={id:'COMPANION',uuid:'Actor.COMPANION',parent:null,name:'Vestige',ownership:{default:0},
    prototypeToken:{width:1,height:1},system:{attributes:{hp:{value:5,max:5}}},getFlag:()=>undefined,
    async update(data){
      if('system.attributes.hp.max' in data)this.system.attributes.hp.max=data['system.attributes.hp.max'];
      if('system.attributes.hp.value' in data)this.system.attributes.hp.value=data['system.attributes.hp.value'];
      if(data.ownership)this.ownership=data.ownership;
    },
    async getTokenDocument(data){return {toObject:()=>({...data,light:{bright:0,dim:0}})};}};
  // A dnd5e activity: preUseActivity can cancel before the slot is spent; postUseActivity runs after.
  const activity={id:'CAST',type:'summon',async use(){
    if(await Hooks.call('dnd5e.preUseActivity',this)===false){events.push('cast-blocked');return null;}
    events.push('native-cast');
    const slot=summoner.system.spells.spell1;
    if(!slot.value)return null;
    slot.value-=1;
    await Hooks.call('dnd5e.postUseActivity',this);
    return {};
  }};
  const spell={uuid:'Actor.SUMMONER.Item.SPELL',id:'SPELL',type:'spell',system:{activities:new Map([['CAST',activity]])}};
  activity.item=spell;
  const summoner={id:'SUMMONER',uuid:'Actor.SUMMONER',parent:null,name:'Summoner',
    items:[spell],isOwner:true,system:{spells:{spell1:{value:slots,max:2},pact:{value:pact,max:1,level:2}}},
    getFlag(_scope,key){return key==='vestige'?oldState:null;},
    async setFlag(_scope,key,value){if(key==='vestige'){oldState=value;events.push('save-state');}},
    async update(data){for(const [k,v] of Object.entries(data)){const [, , key]=k.split('.');this.system.spells[key].value=v;}events.push('slot');},
    testUserPermission(user){return user.id==='GM'||user.id==='PLAYER';}};
  spell.parent=summoner;
  const tokens=[{id:'MAIN',uuid:'Scene.SCENE.Token.MAIN',actorId:'SUMMONER',x:100,y:100,width:1,height:1,getFlag:()=>undefined}];
  let count=0;
  const scene={id:'SCENE',name:'Test Field',grid:{size:100,distance:5,units:'ft'},
    dimensions:{width:1200,height:1200},tokens,
    async createEmbeddedDocuments(_kind,payload){
      if(world.failCreate)throw new Error('create failed');
      const input=payload[0];const id=`TOKEN${++count}`;
      const token={...input,id,uuid:`Scene.SCENE.Token.${id}`,actorId:'COMPANION',width:1,height:1,
        parent:scene,getFlag(_scope,key){return this.flags?.['planar-homebrew']?.[key];},
        async update(d){for(const [k,v] of Object.entries(d)){const key=k.split('.').pop();this.flags??={};(this.flags['planar-homebrew']??={})[key]=v;}}};
      tokens.push(token);events.push('create-token');return [token];
    },
    async deleteEmbeddedDocuments(_kind,ids){for(const id of ids){const i=tokens.findIndex(t=>t.id===id);if(i!==-1)tokens.splice(i,1);}events.push('delete-token');}
  };
  const users=[gm,player];users.activeGM=gm;users.get=id=>users.find(u=>u.id===id);
  globalThis.game={user:gm,users,actors:{get:(id)=>id==='SUMMONER'?summoner:id==='COMPANION'?companion:null,
    contents:[summoner,companion]},scenes:{get:(id)=>id==='SCENE'?scene:null,[Symbol.iterator]:function*(){yield scene;}},
    combats:{[Symbol.iterator]:function*(){}},settings:{get:(_m,key)=>key==='companionApproval'?approval:undefined}};
  globalThis.canvas={scene,tokens:{controlled:[]}};
  globalThis.fromUuid=async uuid=>uuid===companion.uuid?companion:uuid===summoner.uuid?summoner:null;
  globalThis.ChatMessage={getSpeaker:()=>({}),create:async()=>{events.push('chat');}};
  globalThis.CONFIG={queries:{},Canvas:{lightAnimations:{ghost:{},torch:{}}}};
  globalThis.ui={notifications:{warn(){},info(){},error(){}}};
  const dialogs={confirm:async()=>true,input:async()=>({slot:'pact'})};
  globalThis.foundry={utils:{escapeHTML:(x)=>x},applications:{api:{DialogV2:{confirm:(...a)=>dialogs.confirm(...a),input:(...a)=>dialogs.input(...a)}}}};
  gm.query=async(type,payload)=>{const previous=game.user;game.user=gm;try{return await CONFIG.queries[type](payload);}finally{game.user=previous;}};
  registerCompanionQueries();
  registerCompanionCasting();
  setPlacementPicker(null);
  const world={summoner,companion,scene,events,gm,player,dialogs,failCreate:false,
    slots:()=>summoner.system.spells.spell1.value,pact:()=>summoner.system.spells.pact.value,config:()=>oldState,
    asPlayer(){game.user=player;}};
  return world;
}
const companionToken=w=>w.scene.tokens.find(t=>t.actorId==='COMPANION');
const spellOf=w=>w.summoner.items[0];

test('spell mode: cast once, token beside the hero with the spectral aura; recall/return free; dismiss then re-cast',async()=>{
  const world=createWorld();
  await performCompanionAction(world.summoner,'manifest');   // casts the bound spell; the hook places it
  assert.equal(world.slots(),1);
  assert.equal(world.config().state,'manifested');
  const token=companionToken(world);
  assert.ok(token,'token placed without asking for coordinates');
  assert.equal(token.light.dim,15,'aura light on the token');
  assert.equal(token.light.animation.type,'ghost');
  assert.ok(world.events.indexOf('native-cast')<world.events.indexOf('create-token'));
  assert.equal((await inspectVestige(world.summoner)).tokens.length,1);
  await performCompanionAction(world.summoner,'recall');
  assert.equal(world.config().state,'dormant');
  assert.equal(companionToken(world),undefined);
  assert.match(await performCompanionAction(world.summoner,'return'),/returned/i);
  assert.equal(world.slots(),1,'return is free');
  await performCompanionAction(world.summoner,'dismiss');
  assert.equal(world.config().state,'dismissed');
  await performCompanionAction(world.summoner,'manifest');
  assert.equal(world.slots(),0);
  assert.equal(world.config().state,'manifested');
});

test('slot mode: the module spends the picked slot (Pact first) and gives it back if the token cannot be placed',async()=>{
  const world=createWorld({costMode:'slot'});
  await performCompanionAction(world.summoner,'manifest');
  assert.equal(world.pact(),0,'pact slot spent');
  assert.equal(world.slots(),2,'spell slots untouched');
  await performCompanionAction(world.summoner,'dismiss');
  world.failCreate=true;
  await assert.rejects(performCompanionAction(world.summoner,'manifest',{slotKey:'spell1'}),/slot was given back/);
  assert.equal(world.slots(),2,'refunded');
  assert.equal(world.config().state,'dismissed');
});

test('slot mode: no slot left → clear error, no token; closing the slot dialog does nothing',async()=>{
  const world=createWorld({costMode:'slot',slots:0,pact:0});
  await assert.rejects(performCompanionAction(world.summoner,'manifest'),/no spell slot left/);
  assert.equal(companionToken(world),undefined);
  const w2=createWorld({costMode:'slot'});
  w2.dialogs.input=async()=>null;
  assert.equal(await performCompanionAction(w2.summoner,'manifest'),'');
  assert.equal(w2.pact(),1);
  assert.equal(companionToken(w2),undefined);
});

test('spell mode: a cancelled cast places nothing',async()=>{
  const world=createWorld({slots:0});
  assert.equal(await performCompanionAction(world.summoner,'manifest'),'');
  assert.equal(companionToken(world),undefined);
});

test('duplicate manifestation does not consume additional slots',async()=>{
  const world=createWorld();
  await performCompanionAction(world.summoner,'manifest');
  await assert.rejects(performCompanionAction(world.summoner,'manifest'),/cannot manifest/i);
  assert.equal(world.slots(),1);
});

test('invalid coordinates do not spend a slot',async()=>{
  const world=createWorld({costMode:'slot'});
  await assert.rejects(performCompanionAction(world.summoner,'manifest',{point:{x:1100,y:1100}}),/within/);
  assert.equal(world.pact(),1);
});

test('player: manifest, recall, return and dismiss run on the GM client without approval by default',async()=>{
  const world=createWorld({costMode:'slot'});
  let asked=0;world.dialogs.confirm=async()=>{asked++;return true;};
  world.asPlayer();
  assert.match(await performCompanionAction(world.summoner,'manifest'),/manifested/i);
  assert.equal(world.pact(),0,'paid by the player');
  assert.ok(companionToken(world));
  await performCompanionAction(world.summoner,'recall');
  assert.equal(world.config().state,'dormant');
  await performCompanionAction(world.summoner,'return');
  assert.equal(world.config().state,'manifested');
  await performCompanionAction(world.summoner,'command');
  await performCompanionAction(world.summoner,'dismiss');
  assert.equal(world.config().state,'dismissed');
  assert.equal(asked,0,'no GM dialog');
  await assert.rejects(performCompanionAction(world.summoner,'destroy'),/Only a GM/);
});

test('player with GM approval on: a declined Manifest places nothing and gives the slot back',async()=>{
  const world=createWorld({costMode:'slot',approval:true});
  world.dialogs.confirm=async()=>false;
  world.asPlayer();
  await assert.rejects(performCompanionAction(world.summoner,'manifest'),/declined/);
  assert.equal(world.pact(),1);
  assert.equal(companionToken(world),undefined);
});

test('the GM refuses a request from a user who does not own the hero',async()=>{
  const world=createWorld({costMode:'free'});
  const result=await CONFIG.queries['planar-homebrew.companionRequest']({action:'manifest',summonerUuid:'Actor.SUMMONER',userId:'NOBODY',sceneId:'SCENE'});
  assert.equal(result.ok,false);
  assert.equal(companionToken(world),undefined);
});

test('Manifest Vestige (hpMode vestige): full AU hit points for the warlock level on every manifestation',async()=>{
  const world=createWorld();
  world.summoner.classes={warlock:{system:{levels:4}}};
  world.config().hpMode='vestige';
  world.companion.system.attributes.hp.value=0;
  await performCompanionAction(world.summoner,'manifest');
  assert.equal(world.config().state,'manifested');
  assert.equal(world.companion.system.attributes.hp.max,20,'4 + 4 × 4');
  assert.equal(world.companion.system.attributes.hp.value,20);
});

test('a dismissed companion at 0 HP (own HP mode) comes back at full HP on a new casting',async()=>{
  const world=createWorld({costMode:'free'});
  world.companion.system.attributes.hp.value=0;
  await performCompanionAction(world.summoner,'manifest');
  assert.equal(world.companion.system.attributes.hp.value,5);
});

test('the companion vanishes when its hero dies (Planar Glitch death or the Dead status)',async()=>{
  const {vanishWithSummoner}=await import('../scripts/rules/vestige.mjs');
  const world=createWorld();
  await performCompanionAction(world.summoner,'manifest');
  assert.match(await vanishWithSummoner(world.summoner),/vanished/);
  assert.equal(world.config().state,'dismissed');
  assert.equal(companionToken(world),undefined,'its token is gone');
  assert.equal(await vanishWithSummoner(world.summoner),null,'nothing to do twice');
  world.config().vanishOnDeath=false;
  world.config().state='manifested';
  assert.equal(await vanishWithSummoner(world.summoner),null,'opt-out respected');
});

test('binding adopts a companion token placed by hand and shares the companion with the hero\'s player',async()=>{
  const world=createWorld({costMode:'free'});
  const [placed]=await world.scene.createEmbeddedDocuments('Token',[{x:300,y:100}]);
  world.summoner.setFlag('planar-homebrew','vestige',{});
  await bindVestige(world.summoner,world.companion,{costMode:'slot'});
  assert.equal(world.config().state,'manifested');
  assert.equal(world.config().costMode,'slot');
  assert.equal(placed.getFlag('planar-homebrew','summonerUuid'),'Actor.SUMMONER');
  assert.equal(world.companion.ownership.PLAYER,3,'player owns the companion');
  assert.equal(heroForToken(placed),world.summoner);
});

test('repair adopts a hand-placed token when the binding thinks the companion is away',async()=>{
  const world=createWorld();
  await world.scene.createEmbeddedDocuments('Token',[{x:300,y:100}]);
  assert.match(await repairCompanionState(world.summoner),/adopt|bound one/i);
  assert.equal(world.config().state,'manifested');
});

test('casting the bound spell (sheet or Manifest button) places the companion where the player clicks',async()=>{
  const world=createWorld();
  const {castingSummoner}=await import('../scripts/rules/vestige.mjs');
  spellOf(world).parent=world.summoner;
  assert.equal(castingSummoner(spellOf(world).system.activities.get('CAST')),world.summoner);
  let asked=0;
  setPlacementPicker(async({validate})=>{asked++;return validate({x:300,y:300});});
  await spellOf(world).system.activities.get('CAST').use();   // from the sheet
  assert.equal(asked,1);
  assert.equal(world.config().state,'manifested');
  assert.equal(world.config().paidPending,false);
  const token=companionToken(world);assert.deepEqual([token.x,token.y],[300,300]);
  assert.equal(world.slots(),1);
  // Casting again while it's out is refused before any slot is spent.
  await spellOf(world).system.activities.get('CAST').use();
  assert.ok(world.events.includes('cast-blocked'));
  assert.equal(world.slots(),1);
  setPlacementPicker(null);
});
test('a cancelled placement keeps the casting: Manifest then places it without a new slot',async()=>{
  const world=createWorld();
  spellOf(world).parent=world.summoner;
  setPlacementPicker(async()=>null);
  await performCompanionAction(world.summoner,'manifest');   // casts, the player cancels the click
  assert.equal(world.slots(),1);
  assert.equal(world.config().paidPending,true);
  assert.equal(companionToken(world),undefined);
  await assert.rejects(Promise.resolve().then(async()=>{const r=await spellOf(world).system.activities.get('CAST').use();if(!r)throw new Error('blocked');}),/blocked/,'no second casting while one is pending');
  setPlacementPicker(null);
  await performCompanionAction(world.summoner,'manifest');
  assert.equal(world.slots(),1,'no new slot');
  assert.equal(world.config().state,'manifested');
});
