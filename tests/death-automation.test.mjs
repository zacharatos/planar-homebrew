import test,{beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {registerBlindDeathSaves,rollBlindDeathSave,getPrivateDeathState,configureBlindDeathSave,resetBlindDeathSave,cancelNativeDeathSave,protectPublicDeathCounters,addPrivateDeathFailure,clearVisibleDeathCounters} from '../scripts/rules/death-saves.mjs';
const hooks = new Map();
const journal=[];
const publicMessages=[];
const privateMessages=[];
let nextFace=15;
const actor={
 id:'hero',uuid:'Actor.hero',name:'Test Hero',type:'character',documentName:'Actor',system:{attributes:{hp:{value:0}}},statuses:new Set(),
 async update(changes){ if(Object.hasOwn(changes,'system.attributes.hp.value'))this.system.attributes.hp.value=changes['system.attributes.hp.value'];this.lastUpdate=changes; },
 async toggleStatusEffect(s){this.statuses.add(s);}
};
const gm={id:'gm',active:true,isGM:true},player={id:'player',active:true,isGM:false};
const setting={deathSavesEnabled:true,deathSavesAuto:true,deathSavesNPCs:false};
Object.assign(globalThis,{
 game:{user:gm,users:[gm,player],settings:{get(_id,key){return setting[key];}},journal:{contents:journal,get(id){return journal.find(j=>j.id===id);}}},
 foundry:{utils:{escapeHTML:s=>s.replace(/</g,'&lt;').replace(/>/g,'&gt;')}},
 ui:{notifications:{warn:()=>{},error:()=>{}}},
 CONFIG:{statusEffects:[{id:'dead'},{id:'stable'}]},
 Hooks:{on(name,func){hooks.set(name,func);}},
 JournalEntry:{async create(data){const flags=structuredClone(data.flags['planar-homebrew']);const j={id:'ledger',ownership:data.ownership,getFlag(_id,key){return flags[key];},async setFlag(_id,key,value){flags[key]=structuredClone(value);}};journal.push(j);return j;}},
 ChatMessage:{async create(data){publicMessages.push(data);}},
 Roll:class {constructor(formula){this.formula=formula;this.dice=[{faces:20,results:[{result:nextFace,active:true}]}];this.total=nextFace+(Number(formula.match(/[+-]\d+$/)?.[0]??0));}async evaluate(){return this;}async toMessage(data,options){privateMessages.push({data,options,formula:this.formula});}}
});
const checkState=async()=> (await getPrivateDeathState(actor)).record;
let counter=0;
// Each test resets persistent ledger via public GM operation.
beforeEach(async()=>{
 game.user=gm;actor.system.attributes.hp.value=0;actor.statuses.clear();setting.deathSavesEnabled=true;setting.deathSavesAuto=true;setting.deathSavesNPCs=false;
 nextFace=15;publicMessages.length=0;privateMessages.length=0;
 if(!counter++)registerBlindDeathSaves(()=>{});
 await resetBlindDeathSave(actor);
 await configureBlindDeathSave(actor,{enabled:true,autoRoll:true,modifier:0,advantage:'normal'});
});
test('GM private journal created with no player permissions',async()=>{
 assert.equal(journal.length,1);assert.equal(journal[0].ownership.default,0);
 const state=await getPrivateDeathState(actor);assert.equal(state.record,null);
});
test('native death saves blocked for player and GM; public actor fields scrubbed',()=>{
 game.user=player;
 assert.equal(cancelNativeDeathSave({subject:actor}),false);
 const changes={'system.attributes.death.success':1,system:{attributes:{death:{failure:2,success:1},hp:{value:0}}}};
 protectPublicDeathCounters(actor,changes);
 assert.equal(changes['system.attributes.death.success'],undefined);
 assert.equal(changes.system.attributes.death.failure,undefined);
 assert.equal(changes.system.attributes.hp.value,0);
 assert.deepEqual(Object.keys(changes.system.attributes.death),[]);
 assert.equal(cancelNativeDeathSave({subject:{type:'npc',documentName:'Actor'}}),undefined);
 assert.equal(cancelNativeDeathSave({unknown:'unknown'}),false);
});
test('player cannot access private state or privately roll',async()=>{
 game.user=player;
 await assert.rejects(()=>getPrivateDeathState(actor),/GM-only/);
 await assert.rejects(()=>rollBlindDeathSave(actor,{manual:true}),/GM-only/);
});
test('GM manual roll persists private successes, never sends public progress',async()=>{
 const r=await rollBlindDeathSave(actor,{manual:true});
 assert.equal(r.record.successes,1);
 assert.equal((await checkState()).successes,1);
 assert.equal(publicMessages.length,0);
 assert.equal(privateMessages.length,1);
 assert.deepEqual(privateMessages[0].data.whisper,['gm']);
 assert.equal(privateMessages[0].data.blind,true);
 assert.equal(actor.system.attributes.hp.value,0);
});
test('combat turn rolls only once, including manual duplicate on same turn',async()=>{
 const c={uuid:'Combat.Z',round:1,turn:0,combatant:{id:'a',actor}};
 await rollBlindDeathSave(actor,{combat:c});
 assert.equal((await rollBlindDeathSave(actor,{combat:c})).skipped,'already rolled for this turn');
 assert.equal((await rollBlindDeathSave(actor,{combat:c,manual:true})).skipped,'already rolled for this turn');
 c.round=2;await rollBlindDeathSave(actor,{combat:c});
 assert.equal(privateMessages.length,2);
});
test('configured advantage and bonus reach the GM-only roller',async()=>{
 await configureBlindDeathSave(actor,{advantage:'advantage',modifier:2});
 await rollBlindDeathSave(actor,{manual:true});
 assert.equal(privateMessages[0].formula,'2d20kh+2');
});
test('critical natural 1 creates two private failures',async()=>{
 nextFace=1;await rollBlindDeathSave(actor,{manual:true});
 assert.equal((await checkState()).failures,2);
 assert.equal(publicMessages.length,0);
});
test('natural 20 restores 1HP and announces only final result',async()=>{
 nextFace=20;await rollBlindDeathSave(actor,{manual:true});
 assert.equal(actor.system.attributes.hp.value,1);
 assert.equal(publicMessages.length,1);
 assert.match(publicMessages[0].content,/regains consciousness/);
});
test('three successes publicly stabilize and block further death saves',async()=>{
 for(let i=0;i<3;i++)await rollBlindDeathSave(actor,{manual:true});
 assert.equal((await checkState()).outcome,'stable');
 assert.equal(actor.statuses.has('stable'),true);
 assert.equal(publicMessages.length,1);
 await assert.rejects(()=>rollBlindDeathSave(actor,{manual:true}),/not eligible/);
});
test('three failures publicly mark dead, not intermediate failures',async()=>{
 nextFace=1;await rollBlindDeathSave(actor,{manual:true});
 nextFace=5;await rollBlindDeathSave(actor,{manual:true});
 assert.equal((await checkState()).outcome,'dead');
 assert.equal(actor.statuses.has('dead'),true);
 assert.equal(publicMessages.length,1);
});
test('manual zero-hp damage adds private failures',async()=>{
 let result=await addPrivateDeathFailure(actor,2);
 assert.equal(result.failures,2);assert.equal(publicMessages.filter(m=>!m.whisper).length,0);
 result=await addPrivateDeathFailure(actor,1);
 assert.equal(result.outcome,'dead');assert.equal(publicMessages.filter(m=>!m.whisper).length,1);
 assert.equal(privateMessages.length,0);
 assert.equal(publicMessages.filter(m=>m.whisper?.includes('gm')).length,2);
});
test('per-actor disabled refuses GM rolls',async()=>{
 await configureBlindDeathSave(actor,{enabled:false});
 await assert.rejects(()=>rollBlindDeathSave(actor,{manual:true}),/disabled/);
});
test('global auto off skips auto rolls but permits manual rolls',async()=>{
 setting.deathSavesAuto=false;
 assert.equal((await rollBlindDeathSave(actor)).skipped,'auto disabled');
 await rollBlindDeathSave(actor,{manual:true});
 assert.equal(privateMessages.length,1);
});
test('explicit visible reset writes zeros without changing private record',async()=>{
 await rollBlindDeathSave(actor,{manual:true});
 await clearVisibleDeathCounters(actor);
 assert.equal(actor.lastUpdate['system.attributes.death.success'],0);
 assert.equal((await checkState()).successes,1);
});
test('third-party non-GM remains unable to create secret ledger',async()=>{
 game.user=player;await assert.rejects(()=>configureBlindDeathSave(actor,{modifier:1}),/GM-only/);
});
test('combat update hook starts an automated private roll only once per eligible turn',async()=>{
 const c={uuid:'Combat.live',id:'live',round:1,turn:0,started:true,combatant:{id:'hero-combatant',actor}};
 hooks.get('updateCombat')(c,{turn:0});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(privateMessages.length,1);
 hooks.get('updateCombat')(c,{turn:0});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(privateMessages.length,1);
 c.round=2;hooks.get('updateCombat')(c,{round:2});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(privateMessages.length,2);
});
test('another GM cannot double-roll as the non-primary GM',async()=>{
 game.users.push({id:'zz-other',active:true,isGM:true});
 game.user=game.users[2];
 await assert.rejects(()=>rollBlindDeathSave(actor,{manual:true}),/primary/);
 game.user=gm;
 game.users.pop();
});
test('normal player-visible zero resets are allowed; nonzero counters removed',()=>{
 const allowed={'system.attributes.death.success':0,system:{attributes:{death:{failure:0}}}};
 protectPublicDeathCounters(actor,allowed);
 assert.equal(allowed['system.attributes.death.success'],0);
 assert.equal(allowed.system.attributes.death.failure,0);
});
