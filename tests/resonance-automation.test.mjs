import test from 'node:test';
import assert from 'node:assert/strict';
import {injectResonance,locateWeaponPart,assignmentFor,rollNativeBonus} from '../scripts/rules/resonance.mjs';

const config={enabled:true,activityId:'attack-1',faces:6,maxExtra:100,damageType:'slashing',criticalMode:'no-base-doubling'};
class MockRoll {
  constructor(dice, modifier=0,{type='slashing'}={}) {
    this.terms=[{number:dice.length,faces:6,results:dice.map(result=>({result,active:true}))}];
    this._total=dice.reduce((s,n)=>s+n,0)+modifier;
    if(modifier) this.terms.push({operator:'+'},{number:modifier});
    this.options={type};
    this.formula=''; this.resetFormula();
  }
  get total(){return this._total;}
  resetFormula(){this.formula=this.terms.map(t=>t.faces?`${t.number}d${t.faces}`:t.operator??t.number).join(' ');return this.formula;}
}
function extras(sequence){let i=0;return ()=>{
  const n=sequence[i++]; if(n===undefined)throw new Error('Too many dice');
  return {value:n,roll:{terms:[{number:1,faces:6,results:[{result:n,active:true}]}],total:n}};
};}
const operatorFactory=()=>({operator:'+'});
const execute=(rolls,sequence=[],cfg=config)=>injectResonance(rolls,cfg,{rollBonus:extras(sequence),operatorFactory});

test('Native damage: nonmatching base dice leaves the standard roll total intact',()=>{
 const roll=new MockRoll([2,5],3),result=execute([roll]);
 assert.equal(result.status,'applied');assert.equal(roll.total,10);assert.deepEqual(result.extra,[]);
});
test('Native damage: 3,3 + 5 + Str 3 = 14, original dice preserved',()=>{
 const roll=new MockRoll([3,3],3),result=execute([roll],[5]);
 assert.equal(result.status,'applied');assert.equal(roll.total,14);
 assert.deepEqual(roll.terms[0].results.map(r=>r.result),[3,3]);
 assert.equal(roll.terms.filter(t=>t.faces===6).length,2);
});
test('Native damage: 4,4,4,4,2 chain stays in the same roll',()=>{
 const roll=new MockRoll([4,4],3),result=execute([roll],[4,4,2]);
 assert.equal(result.newTotal,21);assert.equal(roll.total,21);
 assert.deepEqual(result.extra,[4,4,2]);
});
test('Native damage: 6,6,6,3 chain + flat 5',()=>{
 const roll=new MockRoll([6,6],5),result=execute([roll],[6,3]);
 assert.equal(result.newTotal,26);
});
test('Critical hit: removes only this weapon\'s doubled base two dice, keeps modifier once',()=>{
 const roll=new MockRoll([4,4,1,6],3),result=execute([roll],[4,2]);
 assert.equal(result.status,'applied');assert.equal(result.critical,true);
 assert.deepEqual(result.removedCriticalDice,[1,6]);
 assert.deepEqual(roll.terms[0].results.map(r=>r.result),[4,4]);
 assert.equal(roll.terms[0].number,2);assert.equal(roll.total,17);
});
test('Critical hit: retains another feature\'s independently doubled dice in a separate roll',()=>{
 const weapon=new MockRoll([3,3,2,4],3),smite=new MockRoll([6,1,6,1],0,{type:'radiant'});
 const result=execute([weapon,smite],[5]);
 assert.equal(result.status,'applied');assert.equal(weapon.total,14);
 assert.equal(smite.total,14);assert.equal(weapon.total+smite.total,28);
});
test('Graze or other flat damage contains no base 2d6 and does not trigger',()=>{
 const graze=new MockRoll([],4),out=execute([graze]);
 assert.equal(out.status,'ambiguous-or-unsupported-roll');assert.equal(graze.total,4);
});
test('Critical damage of different types remains untouched',()=>{
 const weapon=new MockRoll([5,5,2,4],2),other=new MockRoll([3,3],0,{type:'radiant'});
 execute([weapon,other],[1]);assert.equal(other.total,6);
});
test('Ambiguous same-type two separate weapon-like pools fail closed',()=>{
 const rolls=[new MockRoll([2,2]),new MockRoll([2,2])];
 assert.equal(locateWeaponPart(rolls,config),null);
 assert.equal(execute(rolls,[5]).status,'ambiguous-or-unsupported-roll');
});
test('Damage reroll on a new instance is processed; same instance cannot double-trigger',()=>{
 const first=new MockRoll([2,2],3),out=execute([first],[3]);
 assert.equal(out.status,'applied');assert.equal(execute([first],[3]).status,'already-processed');
 const reroll=new MockRoll([3,3],3);assert.equal(execute([reroll],[4]).status,'applied');
});
test('Only explicitly assigned item and activity can fire',()=>{
 const assigned={getFlag:()=>({...config,activityId:'attack-1'})};
 const other={getFlag:()=>null};
 assert.equal(assignmentFor(assigned,'attack-1')?.enabled,true);
 assert.equal(assignmentFor(assigned,'attack-2'),null);
 assert.equal(assignmentFor(other,'attack-1'),null);
});
test('Invalid addition rolls back atomically, does not change base damage',()=>{
 const roll=new MockRoll([4,4],2); const formula=roll.formula;
 const out=injectResonance([roll],config,{rollBonus:extras([5]),operatorFactory:()=>{throw new Error('no operator');}});
 assert.equal(out.status,'error');assert.equal(roll.total,10);
 assert.equal(roll.formula,formula);assert.equal(roll.terms.length,3);
 assert.equal(roll.options['planar-homebrew'],undefined);
});
test('Critical rollback restores doubled base term on mutation failure',()=>{
 const roll=new MockRoll([4,4,4,4],2);
 const out=injectResonance([roll],config,{rollBonus:extras([2]),operatorFactory:()=>{throw new Error('broken');}});
 assert.equal(out.status,'error'); assert.equal(roll.total,18);
 assert.equal(roll.terms[0].number,4); assert.equal(roll.terms[0].results.length,4);
});
test('Safety cap ends a matching streak and keeps the cap result',()=>{
 const roll=new MockRoll([6,6],3),out=execute([roll],[6,6],{...config,maxExtra:2});
 assert.equal(out.capped,true);assert.equal(out.extra.length,2);assert.equal(roll.total,27);
});
test('Type mismatch does not alter the native roll',()=>{
 const fire=new MockRoll([4,4],0,{type:'fire'});
 assert.equal(execute([fire],[5]).status,'ambiguous-or-unsupported-roll');
});

test('Native single-die integration uses a typed DamageRoll with synchronous evaluation',()=>{
 const Original=globalThis.CONFIG;
 try{
  globalThis.CONFIG={Dice:{DamageRoll:class {
   constructor(formula){this.formula=formula;this.terms=[{faces:6,number:1,results:[]}];this.total=0;}
   evaluateSync(opts){assert.equal(opts.strict,true);this.terms[0].results=[{result:4,active:true}];this.total=4;return this;}
  }}};
  const r=rollNativeBonus(6,'slashing');assert.equal(r.value,4);assert.equal(r.roll.formula,'1d6[slashing]');
 }finally{globalThis.CONFIG=Original;}
});

test('Registered dnd5e.rollDamage hook automates only the item/activity flag assignment',async()=>{
 const old={Hooks:globalThis.Hooks,CONFIG:globalThis.CONFIG,game:globalThis.game,foundry:globalThis.foundry};
 const registered=new Map();
 try {
   globalThis.Hooks={on:(name,handler)=>registered.set(name,handler)};
   globalThis.foundry={dice:{terms:{OperatorTerm:class{constructor({operator}){this.operator=operator;}}}}};
   globalThis.game={user:{isGM:true},system:{version:'6.0.5'},release:{generation:14}};
   globalThis.CONFIG={Dice:{DamageRoll:class{
     constructor(formula){this.formula=formula;this.options={type:'slashing'};this._total=0;this.terms=[{number:1,faces:6,results:[]}];}
     evaluateSync(){this.terms[0].results=[{result:5,active:true}];this._total=5;return this;}
     get total(){return this._total;}
     get dice(){return this.terms.filter(t=>t.faces);}
   }}};
   const {registerResonanceAutomation}=await import('../scripts/rules/resonance.mjs');
   const records=[];registerResonanceAutomation(message=>records.push(message));
   const process=registered.get('dnd5e.rollDamage');
   assert.equal(typeof process,'function');
   assert.equal(typeof registered.get('renderChatMessageHTML'),'function');
   const item={name:'A weapon',getFlag:()=>config};
   const ownedRoll=new MockRoll([3,3],3);
   process([ownedRoll],{subject:{type:'attack',id:'attack-1',item}});
   assert.equal(ownedRoll.total,14);
   assert.equal(records.length,1);
   const strangerRoll=new MockRoll([3,3],3);
   process([strangerRoll],{subject:{type:'attack',id:'attack-2',item}});
   assert.equal(strangerRoll.total,9);
   const unassignedRoll=new MockRoll([3,3],3);
   process([unassignedRoll],{subject:{type:'attack',id:'attack-1',item:{getFlag:()=>null}}});
   assert.equal(unassignedRoll.total,9);
 } finally {for (const [key,value] of Object.entries(old))globalThis[key]=value;}
});


test('Nonmatching critical removes doubled weapon dice even if resonance does not chain',()=>{
 const roll=new MockRoll([2,5,6,3],3);
 const out=execute([roll]);
 assert.equal(out.status,'applied');assert.equal(out.critical,true);assert.equal(out.matched,false);
 assert.equal(out.extra.length,0);assert.equal(roll.total,10);
});

test('separate mode (the tested macro): no crit doubling for this attack; matching dice roll an exploding chain card',async()=>{
  const {registerResonanceAutomation,baseDiceFromRolls}=await import('../scripts/rules/resonance.mjs');
  const hooks={};
  globalThis.Hooks={on:(n,f)=>{(hooks[n]??=[]).push(f);}};
  const built=[];
  globalThis.CONFIG={Dice:{DamageRoll:{build:async(cfg)=>{built.push(cfg.rolls[0].parts[0]);return [{total:9}];}}}};
  globalThis.ChatMessage={getSpeaker:()=>({})};
  globalThis.ui={notifications:{warn(){},info(){},error(){}}};
  globalThis.game={user:{isGM:true},release:{generation:14},system:{version:'6.0.5'}};
  const item={name:'Silver Eagle Greatsword',parent:{},system:{properties:new Set(['mgc'])},getFlag:()=>({enabled:true,faces:6,maxExtra:100,damageType:'slashing',mode:'separate'})};
  const activity={type:'attack',id:'ATK',item};
  registerResonanceAutomation(()=>{});
  const config={subject:activity,isCritical:true,rolls:[{options:{isCritical:true}}]};
  for(const f of hooks['dnd5e.preRollDamage'])f(config);
  assert.equal(config.isCritical,false);assert.equal(config.rolls[0].options.isCritical,false);
  const die=v=>({faces:6,number:2,results:v.map(result=>({result,active:true}))});
  for(const f of hooks['dnd5e.rollDamage'])f([{options:{type:'slashing'},dice:[die([4,4])]}],{subject:activity});
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(built,['1d6x=4']);
  for(const f of hooks['dnd5e.rollDamage'])f([{dice:[die([4,2])]}],{subject:activity});
  await new Promise(r=>setTimeout(r,0));
  assert.equal(built.length,1,'no chain without doubles');
  assert.equal(baseDiceFromRolls([{options:{type:'radiant'},dice:[die([3,3])]},{options:{type:'slashing'},dice:[die([5,1])]}],6,'slashing').join(),'5,1','smite dice are not the weapon dice');
});
