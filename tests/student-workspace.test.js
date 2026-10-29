'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),Core=require('../student-workspace-core');
test('planner storage separates accounts, preview and signed-out users',()=>{
    assert.equal(Core.accountKey(null),null);assert.notEqual(Core.accountKey({id:'one'}),Core.accountKey({id:'two'}));assert.notEqual(Core.accountKey({id:'one'},true),Core.accountKey({id:'one'}));assert.equal(Core.accountKey({_id:'one'}),Core.accountKey({id:'one'}));
});
test('planner normalizes stored input, bounds notes and rejects invalid dates and prototype keys',()=>{
    const state=Core.normalize(JSON.parse('{"plans":{"__proto__":{"stage":"offer"},"program_real":{"stage":"invented","targetDate":"2026-02-30","note":"hello"}},"tasks":{"shortlist":"true","funding":true}}'));
    assert.equal(Object.getPrototypeOf(state.plans),null);assert.equal(Object.keys(state.plans).length,1);assert.equal(state.plans.program_real.stage,'researching');assert.equal(state.plans.program_real.targetDate,'');assert.equal(state.tasks.shortlist,false);assert.equal(state.tasks.funding,true);
    assert.equal(Core.normalize({plans:{program_real:{stage:'submitted',targetDate:'2028-02-29',note:'a'.repeat(5000)}}}).plans.program_real.note.length,1000);assert.equal(Core.validDate('2028-02-29'),true);
});
test('profile completion uses actual saved details and does not imply admissions readiness',()=>{
    assert.equal(Core.completion({}).percent,0);assert.equal(Core.completion({name:'A',email:'a@b.example',phone:'+995',studentProfile:{educationLevel:'bachelor',citizenshipCode:'GE',graduationYear:2027}}).percent,100);
});
test('upcoming programme dates exclude past, missing and invalid deadlines and retain the official cycle',()=>{
    const list=Core.deadlines([{id:'b',title:'Later',deadline:{date:'2027-01-01',cycle:'2027'}},{id:'a',title:'Today',deadline:{date:'2026-10-29'}},{id:'past',deadline:{date:'2026-10-28'}},{id:'invalid',deadline:{date:'2026-02-30'}},{id:'unknown',deadline:{date:null}}],'2026-10-29');
    assert.deepEqual(list.map(x=>x.id),['a','b']);assert.equal(list[1].cycle,'2027');assert.throws(()=>Core.deadlines([],'invalid'));
});
