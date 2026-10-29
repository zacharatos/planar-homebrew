import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeDeathConfig,isDeathSaveEligible,applyDeathSave,deathFormula,naturalFromEvaluatedRoll,combatTurnKey} from '../scripts/core/death-math.mjs';
const actor=(type='character',hp=0)=>({type,system:{attributes:{hp:{value:hp}}}});
test('downed character eligible, conscious actor and default NPC ineligible',()=>{
 assert.equal(isDeathSaveEligible(actor()),true);
 assert.equal(isDeathSaveEligible(actor('character',1)),false);
 assert.equal(isDeathSaveEligible(actor('npc')),false);
 assert.equal(isDeathSaveEligible(actor('npc'),{includeNPCs:true}),true);
 assert.equal(isDeathSaveEligible({...actor(),statuses:new Set(['stable'])}),false);
});
test('configuration defaults and validates inputs',()=>{
 assert.deepEqual(normalizeDeathConfig({modifier:'-2',advantage:'advantage'}),{enabled:true,autoRoll:true,modifier:-2,advantage:'advantage'});
 assert.throws(()=>normalizeDeathConfig({modifier:400}),/modifier/);
 assert.throws(()=>normalizeDeathConfig({advantage:'triple'}),/advantage/);
});
test('formulas are safe and support normal, advantage, disadvantage',()=>{
 assert.equal(deathFormula(), '1d20+0');
 assert.equal(deathFormula({advantage:'advantage',modifier:3}), '2d20kh+3');
 assert.equal(deathFormula({advantage:'disadvantage',modifier:-1}), '2d20kl-1');
 assert.throws(()=>deathFormula({modifier:100}),/modifier/);
});
test('10 or higher succeeds; 9 or less fails',()=>{
 assert.equal(applyDeathSave({}, {natural:10,total:10}).successes,1);
 assert.equal(applyDeathSave({}, {natural:9,total:9}).failures,1);
});
test('save modifiers affect threshold but not natural 1/20',()=>{
 assert.equal(applyDeathSave({}, {natural:9,total:11}).successes,1);
 assert.equal(applyDeathSave({}, {natural:10,total:8}).failures,1);
 assert.equal(applyDeathSave({}, {natural:1,total:21}).failures,2);
 assert.equal(applyDeathSave({}, {natural:20,total:9}).outcome,'revived');
});
test('three failures kill and three successes stabilize',()=>{
 assert.equal(applyDeathSave({failures:2},{natural:8,total:8}).outcome,'dead');
 assert.equal(applyDeathSave({successes:2},{natural:15,total:15}).outcome,'stable');
 assert.equal(applyDeathSave({successes:2,failures:2},{natural:1,total:1}).failures,3);
});
test('terminal saves cannot be rolled again',()=>assert.throws(()=>applyDeathSave({outcome:'dead'},{natural:17,total:17}),/resolved/));
test('extracts only active d20 face, not sum with modifiers',()=>{
 const r={dice:[{faces:20,results:[{result:18,active:false,discarded:true},{result:7,active:true}]}]};
 assert.equal(naturalFromEvaluatedRoll(r),7);
 assert.throws(()=>naturalFromEvaluatedRoll({dice:[]}),/twenty-sided/);
 assert.throws(()=>naturalFromEvaluatedRoll({dice:[{faces:20,results:[{result:1},{result:20}]}]}),/uniquely/);
});
test('turn keys differentiate round, turn and combatant',()=>{
 assert.notEqual(combatTurnKey({uuid:'Combat.A',round:1,turn:0,combatant:{id:'x'}}),combatTurnKey({uuid:'Combat.A',round:2,turn:0,combatant:{id:'x'}}));
 assert.equal(combatTurnKey({}),null);
});
