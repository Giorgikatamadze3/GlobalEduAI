'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractWorldCatalog}=require('../scripts/providers/world-official'),{mergeProgramCatalog,computeProgramCoverage}=require('../program-catalog-core');
const source={id:'fixture-world',kind:'institution',name:'Official university',url:'https://example.edu/masters',institutionName:'Example University',institutionWebsite:'https://example.edu/',institutionDomains:['example.edu'],countryCodes:['US'],checkedAt:'2026-10-28',minRecords:1};
const extract=(html,extra={})=>extractWorldCatalog(html,{...source,...extra},{checkedAt:'2026-10-28'});
test('mixed degree index imports only explicit master routes and keeps unpublished facts unknown',()=>{
    const html='<a href="/graduate/biology-ms">Biology, MS</a><a href="/graduate/biology-phd">Biology, PhD</a><a href="/graduate/biology-certificate">Biology Certificate</a><a href="https://unrelated.edu/graduate/foo-ms">Foo, MS</a><a href="javascript:alert(1)">Master of Foo</a>';
    const {records}=extract(html,{format:'masters-links',pathPattern:'/graduate/'});assert.equal(records.length,1);assert.equal(records[0].title,'Biology, MS');assert.equal(records[0].language,null);assert.equal(records[0].durationMonths,null);assert.equal(records[0].requirements.gpaMin4,undefined);
});
test('Boston college labels distinguish same-name programmes and combined bachelor routes are excluded',()=>{
    const {records}=extract('<li class="ma">Advertising <strong>COM</strong> (<a href="/a">MS</a>, <a href="/b">BS</a>)</li><li class="ma">Advertising <strong>MET</strong> (<a href="/c">M.Sc.</a>)</li><li class="ma">Chemistry (<a href="/d">BA-to-MA</a>)</li>',{format:'bu-degrees'});assert.equal(records.length,2);assert.equal(records[0].title,'Advertising (MS) — COM');assert.equal(records[1].title,'Advertising (M.Sc.) — MET');
});
test('Auckland and GW require the official master-level marker rather than a broad postgraduate label',()=>{
    const a=extract('<a class="listing-item__link" href="/master"><p data-programme-name="Master of Engineering"></p><dd data-programme-type="Masters degree"></dd></a><a class="listing-item__link" href="/bachelor"><p data-programme-name="Bachelor of Engineering"></p><dd data-programme-type="Bachelors degree"></dd></a>',{format:'auckland-masters'}).records;assert.equal(a.length,1);
    const b=extract('<li class="item"><a href="/ms"><span class="title">Chemistry, MS</span><span class="keyword">Master\'s</span></a></li><li class="item"><a href="/cert"><span class="title">Post-Master\'s Certificate</span><span class="keyword">Certificate</span></a></li>',{format:'gwu-masters'}).records;assert.equal(b.length,1);
});
test('published master codes on a shared faculty page retain separate stable identities and reimport idempotently',()=>{
    const html='<h2>Master\'s Degrees</h2><table><tbody><tr><td rowspan="2">Master of Arts (by dissertation)</td><td>History</td><td>HM001AAA01</td></tr><tr><td>Philosophy</td><td>HM001AAA02</td></tr></tbody></table><h2>Doctoral Degrees</h2><table><tr><td>Doctor of Philosophy</td><td>History</td><td>HD001</td></tr></table>';
    const settings={...source,recordIdentity:'published-code',format:'uct-masters-codes'},records=extract(html,settings).records;assert.equal(records.length,2);assert.equal(records[0].programUrl,records[1].programUrl);
    const institutions=[{id:'inst_example',name:'Example University',countryCode:'US',domains:['example.edu'],website:'https://example.edu/'}];const first=mergeProgramCatalog({records,source:settings,directory:{institutions},checkedAt:'2026-10-28'});assert.equal(first.report.accepted,2);assert.notEqual(first.programs[0].id,first.programs[1].id);const second=mergeProgramCatalog({records,source:settings,directory:{institutions},existingPrograms:first.programs,checkedAt:'2026-10-28'});assert.equal(second.report.accepted,0);assert.equal(second.programs.length,2);
});
test('HKU rejects truncated search responses and doctoral records and deduplicates the same master route',()=>{
    const row={Id:'abc',Attributes:{hkutgp_name:'Master of Science in Chemistry','rootprogramme.hkutgp_name':{Value:'chemistry'}}};const response={responses:[{data:[row,{Id:'def',Attributes:{hkutgp_name:'Doctor of Education'}}],total:2},{data:[row],total:1}]};assert.equal(extract(JSON.stringify(response),{format:'hku-json'}).records.length,1);assert.throws(()=>extract(JSON.stringify({responses:[{data:[row],total:2}]}),{format:'hku-json'}),/Incomplete/);
});
test('pagination follows the published next link and a changed empty layout fails closed',()=>{
    const result=extract('<a href="/graduate/chemistry">Chemistry, M.Sc.</a><a aria-label="Go to next page, page 2" href="?pageNumber=2">Next</a>',{format:'masters-links',pathPattern:'/graduate/'});assert.equal(result.next,'?pageNumber=2');assert.throws(()=>extract('<h1>Unavailable</h1>',{format:'masters-links',pathPattern:'/graduate/'}),/expected at least/);
});
test('real degree subjects Diplomacy and Minorities are not mistaken for diplomas or minors',()=>{
    const result=extract('<a href="/graduate/diplomacy">Diplomacy, MS</a><a href="/graduate/minorities">Minorities and Society, MA</a><a href="/graduate/certificate">Diploma in Education</a>',{format:'masters-links',pathPattern:'/graduate/'});assert.equal(result.records.length,2);
});
test('world region totals partition verified programme coverage across continents',()=>{
    const institutions=['US','FR','NZ','ZA','HK','CL'].map(code=>({id:'inst_'+code,name:code,countryCode:code,domains:[code.toLowerCase()+'.edu'],website:'https://'+code.toLowerCase()+'.edu/'})),programs=institutions.map(i=>({id:'program_'+i.id,institutionId:i.id,institutionWebsite:i.website,countryCode:i.countryCode}));const coverage=computeProgramCoverage(institutions,programs);assert.equal(coverage.regions.filter(r=>r.programCount>0).length,6);assert.equal(coverage.regions.reduce((n,r)=>n+r.programCount,0),programs.length);assert.equal(coverage.completeness,'partial');
});
