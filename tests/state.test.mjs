import test from 'node:test';
import assert from 'node:assert/strict';
import {transition} from '../scripts/core/state.mjs';
import {nearestVacant,boxesOverlap,isCombatActive,validateVestige} from '../scripts/core/validation.mjs';
test('Manifest -> dormant -> manifested is valid',()=>{assert.equal(transition('manifested','dormant'),'dormant');assert.equal(transition('dormant','manifested'),'manifested')});
test('Dismissed -> manifested, destroyed -> manifested are valid',()=>{assert.equal(transition('dismissed','manifested'),'manifested');assert.equal(transition('destroyed','manifested'),'manifested')});
test('Cannot free-return a destroyed companion',()=>assert.throws(()=>transition('destroyed','dormant'),/Invalid/));
test('Cannot dismiss a dismissed companion twice',()=>assert.throws(()=>transition('dismissed','dismissed'),/Invalid/));
test('Rectangles touching on an edge do not overlap',()=>assert.equal(boxesOverlap({x:0,y:0,w:100,h:100},{x:100,y:0,w:100,h:100}),false));
test('Vacant location avoids existing token',()=>{
 const found=nearestVacant({anchor:{x:100,y:100},occupied:[{x:0,y:0,w:200,h:200}],width:100,height:100,step:100,maxDistancePixels:400});
 assert.ok(found);assert.equal(boxesOverlap({...found,w:100,h:100},{x:0,y:0,w:200,h:200}),false);
});
test('Rejects invalid vestige range',()=>assert.throws(()=>validateVestige({range:10000}),/between/));
test('Only active combats block recall',()=>{
 const c=[{scene:{id:'A'},started:true},{scene:{id:'B'},started:false}];
 assert.equal(isCombatActive(c,'A'),true);assert.equal(isCombatActive(c,'B'),false);
});
