'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const C=require('../experience-core');
test('shared discovery links round-trip multiple choices, text, flags and pagination',()=>{
 const state={view:'programs',page:4,values:{country:['DE','US'],degree:['master'],query:['data & AI / ქართული'],funding:['1'],budget:['12000'],currency:['EUR']}};
 const parsed=C.parse(C.hash(state));assert.equal(parsed.view,'programs');assert.equal(parsed.page,4);for(const[k,v]of Object.entries(state.values))assert.deepEqual(parsed.values[k],v);
});
test('untrusted discovery links are bounded and cannot introduce arbitrary DOM fields',()=>{
 const parsed=C.parse('#universities?type=admin&page=-6&country=DE&evil=script&query='+encodeURIComponent('a'.repeat(301)));
 assert.equal(parsed.view,'institutions');assert.equal(parsed.page,1);assert.equal(parsed.values.evil,undefined);assert.deepEqual(parsed.values.query,[]);
});
