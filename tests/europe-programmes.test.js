'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractEuropeanCatalog,fetchEuropeanCatalog}=require('../scripts/providers/europe-official');
const {applyInstitutionSupplements}=require('../scripts/institution-supplements');
const {loadCatalog}=require('../Server/catalog-service');
const Funding=require('../funding-core');
const data=loadCatalog().payload;
const src=(adapter,host)=>({id:'fixture',adapter,url:'https://'+host+'/masters',institutionWebsite:'https://'+host+'/',countryCodes:['NO'],institutionName:'Fixture University'});
test('European country coverage counts real linked programmes and distinguishes affiliation from campus location',()=>{
    const coverage=data.metadata.programCoverage.europe;
    assert.equal(coverage.countryCount,51);assert.equal(coverage.countriesWithPrograms,51);assert.equal(coverage.completeness,'partial');
    assert.equal(new Set(coverage.countries.map(c=>c.countryCode)).size,51);
    for(const row of coverage.countries){assert.ok(row.programCount>0);assert.equal(row.programCount,data.programs.filter(p=>p.countryCode===row.countryCode).length);}
    const holySee=data.programs.find(p=>p.countryCode==='VA');assert.equal(holySee.studyLocation.countryCode,'IT');assert.equal(holySee.studyLocation.city,'Rome');
    assert.equal(data.metadata.supplementalInstitutionCount,2);
});
test('master adapters extract degree entries and reject menus, bachelor results and foreign links',()=>{
    const html='<li><a href="/study/math"><h3>Mathematics</h3><span class="facet">Master</span><span class="facet">2 years</span></a></li><li><a href="/study/bsc"><h3>Physics BSc</h3><span class="facet">Bachelor</span></a></li><li><a href="https://evil.example/no"><h3>Fake</h3><span class="facet">Master</span></a></li>';
    const snapshot=extractEuropeanCatalog(html,src('oslo-masters','uio.no'));
    assert.equal(snapshot.records.length,1);assert.equal(snapshot.records[0].title,'Mathematics');assert.equal(snapshot.records[0].durationMonths,24);assert.equal(snapshot.records[0].language,null);assert.equal(snapshot.coverage.complete,false);
    const vienna=extractEuropeanCatalog('<a href="/master-access-guide-mag">Master Access Guide</a><a href="/master-access-guide-mag/astronomy">Astronomy</a>',src('vienna-masters','univie.ac.at'));
    assert.equal(vienna.records.length,1);assert.equal(vienna.records[0].title,'Astronomy');
    const uppsala=extractEuropeanCatalog('<a href="/en/study/programme/masters-programme-data-science">Data Science</a><a href="/en/study/programme/bachelor-physics">Physics</a>',src('uppsala-masters','uu.se'));
    assert.equal(uppsala.records.length,1);
    const copenhagen=extractEuropeanCatalog('<article data-study-programme="1" aria-label="Master of Science (MSc) in Chemistry"><a href="/chemistry">Read more</a></article><article data-study-programme="2" aria-label="Bachelor of Science"><a href="/bachelor">Read more</a></article>',src('copenhagen-masters','ku.dk'));
    assert.equal(copenhagen.records.length,1);assert.equal(copenhagen.records[0].title,'Master of Science (MSc) in Chemistry');
});
test('changed, empty, failed and off-domain institutional sources cannot silently replace programme snapshots',async()=>{
    const source=src('oslo-masters','uio.no');
    assert.throws(()=>extractEuropeanCatalog('<p>Maintenance</p>',source),/no verified/);
    await assert.rejects(fetchEuropeanCatalog(source,{fetchImpl:async()=>({ok:false,status:503})}),/HTTP 503/);
    await assert.rejects(fetchEuropeanCatalog(source,{fetchImpl:async()=>({ok:true,url:'https://unrelated.example/',text:async()=>''})}),/redirected outside/);
});
test('supplement source ownership rejects suffix tricks and repeated application preserves counts',()=>{
    const directory=require('../Server/data/institutions.json'),supplements=structuredClone(require('../Server/data/additional-institutions.json'));
    const once=applyInstitutionSupplements(directory),twice=applyInstitutionSupplements(once);
    assert.equal(once.institutions.length,twice.institutions.length);assert.equal(twice.metadata.supplementalInstitutionCount,2);
    supplements.institutions[0].source.url='https://evilmonaco.edu/';assert.throws(()=>applyInstitutionSupplements(directory,supplements),/owned source/);
});
test('joint programmes preserve all verified partners and exact non-DAAD funding bindings',()=>{
    const cyber=data.programs.filter(p=>p.provenance?.sourceId==='cybersure-consortium'),multi=data.programs.filter(p=>p.provenance?.sourceId==='multidiverse-consortium');
    assert.equal(cyber.length,7);assert.equal(multi.length,3);assert.equal(new Set(cyber.map(p=>p.institutionId)).size,7);
    for(const p of multi){const institution=data.institutions.find(i=>i.id===p.institutionId);const a=Funding.fundingForProgram(p,institution,data.funding,null,{asOf:'2026-10-29'}).find(a=>a.id==='funding_erasmus-mundus-multidiverse');assert.equal(a.associationStatus,'listed');assert.equal(a.callStatus,'closed');assert.equal(a.awardGuaranteed,false);}
    const unrelated=data.programs.find(p=>p.countryCode==='DE'&&p.provenance?.sourceId!=='multidiverse-consortium');assert.equal(Funding.fundingForProgram(unrelated,data.institutions.find(i=>i.id===unrelated.institutionId),data.funding,null,{asOf:'2026-10-29'}).find(a=>a.id==='funding_erasmus-mundus-multidiverse').status,'ineligible');
});
test('Master Mind enforces the published GPA scale without percentage conversion',()=>{
    const p=data.programs.find(p=>p.institutionWebsite.includes('kuleuven.be')),i=data.institutions.find(i=>i.id===p.institutionId),get=applicant=>Funding.fundingForProgram(p,i,data.funding,applicant,{asOf:'2026-10-29'}).find(a=>a.id==='funding_flanders-master-mind');
    assert.equal(get({gpa4:3.4}).status,'ineligible');assert.notEqual(get({gpa4:3.8}).status,'ineligible');assert.ok(get({gpaPercent:98}).missing.some(m=>m.includes('0–4')));
    const broken=structuredClone(data.funding);broken.schemes.find(s=>s.id==='funding_flanders-master-mind').conditions.minGpa4=4.1;assert.equal(Funding.validateFundingCatalog(broken).valid,false);
});
