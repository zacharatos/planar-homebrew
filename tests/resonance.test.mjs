import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateResonance,findWeaponDice} from '../scripts/rules/resonance.mjs';
import {validateResonance} from '../scripts/core/validation.mjs';
function fixed(values){let idx=0;return ()=>values[idx++];}
function verify(original,additional,expected){
 const value=calculateResonance(original,fixed(additional));
 assert.deepEqual(value.extra,original[0]===original[1]?additional:[]);
 assert.equal(value.total,expected);
}
test('Nonmatching dice add nothing',()=>verify([2,5],[],7));
test('Matching 3,3 then 5 yields 11',()=>verify([3,3],[5],11));
test('Matching 4,4 then 4,4,2 yields 18',()=>verify([4,4],[4,4,2],18));
test('Matching 6,6 then 6,3 yields 21',()=>verify([6,6],[6,3],21));
test('First nonmatching die is included',()=>verify([1,1],[4],6));
test('Stops at safety cap',()=>{
 const roll=calculateResonance([2,2],fixed([2,2]),{maxExtra:2});
 assert.equal(roll.capped,true);assert.equal(roll.total,8);
});
test('Rejects invalid dice pool size',()=>assert.throws(()=>calculateResonance([1,1,1],()=>2),/two/));
test('Rejects invalid extra dice',()=>assert.throws(()=>calculateResonance([2,2],()=>7),/Invalid/));
test('Rejects unsupported initial pools',()=>assert.throws(()=>validateResonance({initialDice:3}),/TWO/));
test('Can identify original dice when unambiguous',()=>{
 const result=findWeaponDice({terms:[{number:2,faces:6,results:[{result:3,active:true},{result:3,active:true}]}]});
 assert.deepEqual(result,[3,3]);
});
test('Will not mix ambiguous 2d6 terms from different features',()=>{
 assert.equal(findWeaponDice({terms:[{number:2,faces:6,results:[]},{number:2,faces:6,results:[]}]}),null);
});
