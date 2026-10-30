import test from 'node:test';
import assert from 'node:assert/strict';
import {slotSnapshot,consumedExactlyOneSlot,isAuthorizedOwner,validateRequestShape,validateTokenPosition,commandKey} from '../scripts/core/companion-helpers.mjs';
import {validateVestige} from '../scripts/core/validation.mjs';

test('native single 1st level slot expenditure is accepted',()=>assert.equal(consumedExactlyOneSlot({spell1:2,pact:2},{spell1:1,pact:2}),true));
test('pact slot can be expended',()=>assert.equal(consumedExactlyOneSlot({pact:1,spell1:3},{pact:0,spell1:3}),true));
test('no slot expenditure is rejected',()=>assert.equal(consumedExactlyOneSlot({pact:1},{pact:1}),false));
test('two slots expended is rejected',()=>assert.equal(consumedExactlyOneSlot({spell1:3},{spell1:1}),false));
test('gained slot is rejected',()=>assert.equal(consumedExactlyOneSlot({pact:1},{pact:2}),false));
test('missing tracked slot is rejected',()=>assert.equal(consumedExactlyOneSlot({pact:1},{spell1:0}),false));
test('only real spell and pact entries in a snapshot',()=>{
 assert.deepEqual(slotSnapshot({system:{spells:{spell1:{value:2},spell2:{value:0},pact:{value:1},other:{value:4}}}}),{spell1:2,spell2:0,pact:1});
});
test('request rejects arbitrary actor paths',()=>assert.throws(()=>validateRequestShape({action:'manifest',summonerUuid:'JournalEntry.1234',point:{x:1,y:2}})));
test('request rejects unexpected action',()=>assert.throws(()=>validateRequestShape({action:'delete-all',summonerUuid:'Actor.Ab1'})));
test('owner permission is verified via Foundry method',()=>{
 const actor={testUserPermission:(user,level)=>user.id==='owner'&&level==='OWNER'};
 assert.equal(isAuthorizedOwner(actor,{id:'owner'}),true);
 assert.equal(isAuthorizedOwner(actor,{id:'intruder'}),false);
});
const geometry={anchor:{x:200,y:200},width:100,height:100,step:100,gridFeet:5,rangeFeet:60,sceneWidth:1500,sceneHeight:1500,occupied:[{x:0,y:0,w:100,h:100}]};
test('valid point snapped to scene grid',()=>assert.deepEqual(validateTokenPosition({...geometry,point:{x:303,y:310}}),{x:300,y:300}));
test('occupied destination is rejected',()=>assert.throws(()=>validateTokenPosition({...geometry,point:{x:2,y:2}}),/overlaps/));
test('outside scene boundary is rejected',()=>assert.throws(()=>validateTokenPosition({...geometry,point:{x:1499,y:1499}}),/outside/));
test('outside spell range is rejected',()=>assert.throws(()=>validateTokenPosition({...geometry,point:{x:1400,y:400}}),/within/));
test('invalid nonnumeric location rejected',()=>assert.throws(()=>validateTokenPosition({...geometry,point:{x:NaN,y:200}}),/invalid/));
test('config rejects an invalid command economy',()=>assert.throws(()=>validateVestige({commandCost:'ninety actions'}),/command cost/));
test('command per-round marker is specific to the combat and round',()=>assert.equal(commandKey({id:'combat1',round:4}),'combat1:4'));

test('AU vestige hit points and class level lookup',async()=>{
  const {vestigeMaxHP,classLevel}=await import('../scripts/core/companion-helpers.mjs');
  assert.equal(vestigeMaxHP(3),16);
  assert.equal(vestigeMaxHP(4),20);
  assert.equal(vestigeMaxHP(undefined),4);
  assert.equal(classLevel({classes:{warlock:{system:{levels:5}}}},'warlock'),5);
  assert.equal(classLevel({items:[{type:'class',name:'Warlock',system:{levels:2}}]},'warlock'),2);
  assert.equal(classLevel({items:[]},'warlock'),0);
});

test('old bindings keep working: chosen spell → spell, "no slot" → free, otherwise the module spends a slot',async()=>{
  const {companionCostMode}=await import('../scripts/core/validation.mjs');
  assert.equal(companionCostMode({requireCasting:true,castingItemUuid:'Actor.A.Item.B',castingActivityId:'C'}),'spell');
  assert.equal(companionCostMode({requireCasting:false}),'free');
  assert.equal(companionCostMode({requireCasting:true}),'slot');
  assert.equal(companionCostMode({costMode:'free',requireCasting:true}),'free');
  assert.equal(validateVestige({lightPreset:'beacon'}).lightPreset,'beacon');
  assert.equal(validateVestige({lightPreset:'moon'}).lightPreset,'moon','any token light preset');
  assert.throws(()=>validateVestige({lightPreset:'disco'}));
});
test('slots to pay with: Pact first, only those with uses left',async()=>{
  const {availableSlots}=await import('../scripts/core/companion-helpers.mjs');
  assert.deepEqual(availableSlots({system:{spells:{pact:{value:1,max:2,level:3},spell1:{value:0,max:4},spell2:{value:2,max:3}}}}).map(s=>[s.key,s.level,s.value]),[['pact',3,1],['spell2',2,2]]);
  assert.deepEqual(availableSlots({system:{spells:{pact:{value:0,max:1}}}}),[]);
});
