'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const C=require('../catalog-core');
const {loadCatalog}=require('../Server/catalog-service');const data=loadCatalog().payload;
const opts={asOf:'2026-10-27'};
const prefs=extra=>({requiresFullFunding:false,...extra});
test('multi countries use OR while unrelated dimensions use AND',()=>{
 const rows=C.filterPrograms(data.programs,data.institutions,prefs({countryCodes:['DE','FI'],degrees:['master'],fields:['tech']}),opts);
 assert.ok(rows.length>1);assert.ok(rows.every(p=>['DE','FI'].includes(p.countryCode)&&p.degree==='master'&&p.category==='tech'));
});
test('the directory joins program interests instead of assigning every university a subject',()=>{
 const plain=C.filterCatalogInstitutions(data.institutions,data.programs,prefs({}),opts);assert.equal(plain.length,10268);
 const specific=C.filterCatalogInstitutions(data.institutions,data.programs,prefs({fields:['tech'],degrees:['master']}),opts);
 assert.ok(specific.length>1&&specific.length<plain.length);assert.ok(specific.every(i=>data.programs.some(p=>p.institutionId===i.id&&p.degree==='master'&&p.category==='tech')));
});
test('unknown duration never satisfies a requested duration bound',()=>{
 const rows=C.filterPrograms(data.programs,data.institutions,prefs({durationMaxMonths:12}),opts);assert.ok(rows.length>0);assert.ok(rows.every(p=>p.durationMonths!=null&&p.durationMonths<=12));
});
test('subject fields match real specializations and do not leak into unrelated fields',()=>{
 const rows=C.filterPrograms(data.programs,data.institutions,prefs({subjectFields:['cybersecurity']}),opts);
 assert.ok(rows.some(p=>p.id==='program_taltech-cybersecurity-msc'),'the curated programme remains discoverable after adding official imports');
 assert.ok(rows.every(p=>p.field==='cybersecurity'||/cyber\s*security/i.test(p.title)),'each result needs an actual subject or title match');
});
test('unknown fees and full funding retain distinct meanings',()=>{
 const free=C.filterPrograms(data.programs,data.institutions,prefs({freeTuitionOnly:true}),opts);assert.equal(free.length,1);assert.equal(free[0].tuition.amount,0);
 assert.equal(C.filterPrograms(data.programs,data.institutions,{requiresFullFunding:true},opts).length,0);
 const known=C.filterPrograms(data.programs,data.institutions,prefs({tuitionKnownOnly:true}),opts);assert.ok(known.every(p=>p.tuition.amount!==null));
});
test('deadline windows and exact intake cycles exclude unknown dates',()=>{
 const rows=C.filterPrograms(data.programs,data.institutions,prefs({deadlines:'known-upcoming',deadlineBefore:'2027-01-31'}),opts);
 assert.ok(rows.length>0);assert.ok(rows.every(p=>p.deadline.date>='2026-10-27'&&p.deadline.date<='2027-01-31'));
 const cycle=rows[0].deadline.cycle;assert.ok(C.filterPrograms(data.programs,data.institutions,prefs({intakeCycle:cycle}),opts).every(p=>p.deadline.cycle===cycle));
});
test('multi choices and advanced constraints also apply to recommendations',()=>{
 const input=prefs({countryCodes:['DE','FI'],fields:['tech'],durationMaxMonths:12});const r=C.recommendPrograms(data.programs,data.institutions,input,opts);
 assert.ok([...r.matches,...r.needsVerification].every(item=>['DE','FI'].includes(item.program.countryCode)&&item.program.category==='tech'));
 assert.ok(r.excluded.some(item=>item.exclusionReasons.some(reason=>reason.includes('ხანგრძლივობა'))));
});
test('malformed multi choices and reversed bounds never expand the search silently',()=>{
 for(const input of [{countryCodes:['INVALID']},{degrees:'master'},{durationMinMonths:24,durationMaxMonths:12},{deadlineAfter:'2027-02-01',deadlineBefore:'2027-01-01'}])assert.equal(C.filterPrograms(data.programs,data.institutions,prefs(input),opts).length,0);
});
