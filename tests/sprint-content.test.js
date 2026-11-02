'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
test('Sprint programme additions cover USA, Europe and Asia with official provenance and no inferred GPA thresholds',()=>{
    const seed=require('../Server/data/sprint-1-programmes.json'),catalog=require('../Server/data/programs.json'),Core=require('../catalog-core');
    assert.equal(seed.records.length,19);assert.equal(seed.records.filter(r=>r.countryCode==='US').length,6);assert.equal(seed.records.filter(r=>['SG','HK','JP'].includes(r.countryCode)).length,6);
    for(const record of seed.records){assert.ok(catalog.programs.some(p=>p.programUrl===record.programUrl),record.title);assert.ok(!record.requirements?.gpaMin4);assert.ok(Core.COUNTRIES[record.countryCode]);assert.ok(record.sourceUrl.startsWith('https://'));}
});
test('Loan catalogue exposes actual countries, dated terms, source links and explicit unknown variable rates',()=>{
    const {validateSimple}=require('../Server/content-service'),records=require('../Server/data/loans.json').records;
    assert.deepEqual([...new Set(records.flatMap(r=>r.countryCodes))].sort(),['DE','GB','US']);
    for(const r of records){assert.doesNotThrow(()=>validateSimple('loans',r));assert.ok(r.eligibility.en.length>80);assert.ok(r.sources.every(s=>s.url.startsWith('https://')));if(r.interest.type==='variable')assert.equal(r.interest.annualPercent,null);}
    const us=records.find(r=>r.countryCodes.includes('US'));assert.equal(us.interest.annualPercent,8.07);assert.match(us.interest.note.en,/2026.*2027/);
});
test('FAQ has all required categories, three-language content and no dangling category links',()=>{
    const {validateSimple}=require('../Server/content-service'),faq=require('../Server/data/faq.json');assert.equal(faq.categories.length,5);assert.equal(faq.records.length,12);
    for(const r of faq.records){assert.doesNotThrow(()=>validateSimple('faq',r));assert.ok(faq.categories.some(c=>c.id===r.categoryId));}
});
