// Blind Death Saves ↔ Planar Glitch, and failures that something else tries to put on the sheet.
import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {registerBlindDeathSaves,rollBlindDeathSave,getPrivateDeathState,configureBlindDeathSave,resetBlindDeathSave,protectPublicDeathCounters,handToGlitch} from '../scripts/rules/death-saves.mjs';

const journal=[];const publicMessages=[];const deaths=[];
let nextFace=5;
const actor={id:'hero',uuid:'Actor.hero',name:'Test Hero',type:'character',documentName:'Actor',
  system:{attributes:{hp:{value:0},death:{success:0,failure:0}}},statuses:new Set(),
  async update(){},async toggleStatusEffect(s){this.statuses.add(s);}};
const gm={id:'gm',active:true,isGM:true};
const setting={deathSavesEnabled:true,deathSavesAuto:true,deathSavesNPCs:false};
const glitch={active:true,api:{async recordDeath(a,opts){deaths.push({a,opts,statusesAtCall:[...a.statuses]});return {id:'r1'};}}};
Object.assign(globalThis,{
  game:{user:gm,users:[gm],settings:{get(_id,key){return setting[key];}},journal:{contents:journal,get(id){return journal.find(j=>j.id===id);}},
    modules:new Map([['planar-glitch',glitch]])},
  foundry:{utils:{escapeHTML:s=>String(s)}},
  ui:{notifications:{warn:()=>{},error:()=>{}}},
  CONFIG:{statusEffects:[{id:'dead'},{id:'stable'}],specialStatusEffects:{DEFEATED:'dead'}},
  Hooks:{on(){}},
  JournalEntry:{async create(data){const flags=structuredClone(data.flags['planar-homebrew']);const j={id:'ledger',ownership:data.ownership,getFlag(_id,key){return flags[key];},async setFlag(_id,key,value){flags[key]=structuredClone(value);}};journal.push(j);return j;}},
  ChatMessage:{async create(data){publicMessages.push(data);}},
  Roll:class{constructor(f){this.formula=f;this.dice=[{faces:20,results:[{result:nextFace,active:true}]}];this.total=nextFace;}async evaluate(){return this;}async toMessage(){}}
});
registerBlindDeathSaves(()=>{});
const state=async()=>(await getPrivateDeathState(actor)).record;
const settle=()=>new Promise(r=>setImmediate(r));
beforeEach(async()=>{
  actor.statuses.clear();actor.system.attributes.hp.value=0;actor.system.attributes.death.failure=0;
  deaths.length=0;publicMessages.length=0;glitch.active=true;nextFace=5;
  await resetBlindDeathSave(actor);await configureBlindDeathSave(actor,{enabled:true,autoRoll:true,modifier:0,advantage:'normal'});
});

test('a death on blind saves is handed to Planar Glitch before the Dead status',async()=>{
  for(let i=0;i<3;i++)await rollBlindDeathSave(actor,{manual:true});
  assert.equal((await state()).outcome,'dead');
  assert.equal(deaths.length,1);
  assert.equal(deaths[0].opts.source,'saves');
  assert.deepEqual(deaths[0].statusesAtCall,[],'Glitch records it with source "saves", before the status');
  assert.ok(actor.statuses.has('dead'));
  assert.match(publicMessages.at(-1).content,/has died/);
});

test('without Planar Glitch the death still gets the Dead status',async()=>{
  glitch.active=false;
  for(let i=0;i<3;i++)await rollBlindDeathSave(actor,{manual:true});
  assert.equal(deaths.length,0);
  assert.ok(actor.statuses.has('dead'));
  assert.equal(await handToGlitch(actor),null);
});

test('stabilizing is not a death',async()=>{
  nextFace=15;
  for(let i=0;i<3;i++)await rollBlindDeathSave(actor,{manual:true});
  assert.equal((await state()).outcome,'stable');
  assert.equal(deaths.length,0);
});

test('a failure the system writes on the sheet moves into the secret tally',async()=>{
  const changes={'system.attributes.death.failure':1};
  protectPublicDeathCounters(actor,changes);
  assert.equal(changes['system.attributes.death.failure'],undefined,'nothing reaches the sheet');
  await settle();await settle();
  assert.equal((await state()).failures,1);
  const nested={system:{attributes:{death:{failure:3}}}};
  protectPublicDeathCounters(actor,nested);
  await settle();await settle();
  assert.equal((await state()).failures,3,'capped at +2 per update');
  assert.equal((await state()).outcome,'dead');
  assert.equal(deaths.length,1);
});

test('zero resets (Glitch bringing a hero back) are left alone and add nothing',async()=>{
  const changes={'system.attributes.death.failure':0,'system.attributes.death.success':0};
  protectPublicDeathCounters(actor,changes);
  await settle();
  assert.equal(changes['system.attributes.death.failure'],0);
  assert.equal(await state(),null);
});

test('a player client never adds secret failures',async()=>{
  game.user={id:'p',isGM:false};
  protectPublicDeathCounters(actor,{'system.attributes.death.failure':1});
  game.user=gm;
  await settle();
  assert.equal(await state(),null);
});
