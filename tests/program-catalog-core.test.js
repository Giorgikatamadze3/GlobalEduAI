'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../catalog-core');
const {normalizeProgramRecord,mergeProgramCatalog,computeProgramCoverage,canonicalProgramURL} = require('../program-catalog-core');

const DATE = '2026-10-27';
const source = () => ({id:'official-programmes',kind:'official-directory',url:'https://directory.example.org/study/',countryCodes:['DE'],checkedAt:DATE});
const institution = (patch = {}) => ({id:'inst_example',name:'Example University',countryCode:'DE',website:'https://www.example.edu/',domains:['example.edu'],...patch});
const raw = (patch = {}) => ({institutionName:'Example University',institutionWebsite:'https://www.example.edu/',countryCode:'DE',title:'Computer Science',
    degree:null,language:null,field:null,category:null,mode:null,sourceRecordId:'123',programUrl:'https://directory.example.org/study/course/123/',
    sourceUrl:'https://directory.example.org/study/course/123/',listingSourceUrl:'https://directory.example.org/study/api/?page=1',...patch});
const merge = (records,patch = {}) => mergeProgramCatalog({existingPrograms:[],records,source:source(),directory:[institution()],...patch});
function curated(patch = {}) {
    return {id:'program_existing-manual',institutionId:null,institutionName:'Example University',institutionWebsite:'https://example.edu/',countryCode:'DE',
        title:'Computer Science (M.Sc.)',degree:'master',language:'en',category:'tech',field:'computer-science',mode:'full-time',durationMonths:24,
        tuition:{amount:0,currency:'EUR',period:'year',applicantScope:'all',note:'No tuition; living costs and contributions remain payable.'},
        funding:{fullFunding:null,scholarships:[]},requirements:{gpaMinPercent:70,languageLevel:'C1',languageTest:{name:'IELTS Academic',minScore:6.5},experienceYears:null,note:'Published academic requirements.'},
        deadline:{date:null,cycle:null,note:'The intake year needs verification.'},verificationStatus:'official-source',updatedAt:DATE,
        sources:[{url:'https://example.edu/study/computer-science',label:'Institution programme page',checkedAt:DATE},{url:'https://example.edu/fees',label:'Fee policy',checkedAt:DATE}],...patch};
}

test('official-directory normalization preserves unknown facts instead of assuming English, free tuition or full-time study',() => {
    const program = normalizeProgramRecord(raw(),source());
    for (const field of ['degree','language','category','field','mode','durationMonths']) assert.equal(program[field],null,field);
    assert.deepEqual(program.languages,[]);
    assert.deepEqual(program.tuition,{amount:null,currency:null,period:null,applicantScope:null,note:''});
    assert.equal(program.requirements.gpaMinPercent,null);assert.equal(program.funding.fullFunding,null);assert.equal(program.deadline.date,null);
    assert.equal(program.verificationStatus,'official-directory');assert.equal(program.provenance.sourceId,source().id);
    assert.equal(program.sources[0].kind,'official-directory');assert.equal(program.provenance.sourceRecordId,'123');
    assert.match(program.id,/^program_[a-f0-9]{24}$/);
});

test('only explicit canonical taxonomies are accepted; titles and raw subject labels do not infer a degree or field',() => {
    const unknown = normalizeProgramRecord(raw({title:'Master of Computer Science',subject:'Computer Science',languages:['en','de']}),source());
    assert.equal(unknown.degree,null);assert.equal(unknown.field,null);assert.equal(unknown.category,null);assert.equal(unknown.language,null);
    assert.deepEqual(unknown.languages,['de','en']);
    for (const patch of [{degree:'MSc'},{language:'English'},{field:'Computer Science'},{category:'engineering'},{mode:'campus'},{languages:['xx']},{field:'computer-science',category:'medicine'}]) {
        assert.throws(() => normalizeProgramRecord(raw(patch),source()),error => error.code === 'INVALID_ENUM');
    }
});

test('program URLs canonicalize presentation differences without discarding meaningful identifiers',() => {
    const first = raw({programUrl:'https://www.directory.example.org/study/course/?id=123&utm_source=test#requirements'});
    const second = raw({programUrl:'https://directory.example.org/study/course?id=123'});
    assert.equal(normalizeProgramRecord(first,source()).id,normalizeProgramRecord(second,source()).id);
    assert.notEqual(normalizeProgramRecord(second,source()).id,normalizeProgramRecord(raw({programUrl:'https://directory.example.org/study/course?id=124'}),source()).id);
    assert.equal(canonicalProgramURL('https://directory.example.org/study/?z=2&a=1&gclid=ads#top'),'https://directory.example.org/study?a=1&z=2');
});

test('unsafe, credential-bearing and unregistered URLs are rejected before they enter public records',() => {
    for (const value of ['javascript:alert(1)','data:text/html,hello','https://user:secret@directory.example.org/study/1','http://127.0.0.1/study/1','http://2130706433/study/1','http://[::1]/study/1','https://localhost/study/1','https://service.internal/study/1','https://directory.example.org\\@evil.example/study/1']) {
        assert.throws(() => normalizeProgramRecord(raw({programUrl:value}),source()),error => error.code === 'INVALID_URL',value);
    }
    assert.throws(() => normalizeProgramRecord(raw({sourceUrl:'https://unregistered.example/study/1'}),source()),{code:'SOURCE_MISMATCH'});
    assert.throws(() => normalizeProgramRecord(raw({sourceUrl:'https://directory.example.org/unrelated/1'}),source()),{code:'SOURCE_MISMATCH'});
    assert.throws(() => normalizeProgramRecord(raw({institutionWebsite:'http://169.254.169.254/'}),source()),{code:'INVALID_URL'});
});

test('source country, identity, exact calendar dates and official-source kind are validated',() => {
    for (const patch of [{kind:'aggregator'},{countryCodes:['XX']},{checkedAt:'2026-02-30'},{checkedAt:'9999-01-01'},{id:'Invalid Identifier'}]) {
        assert.throws(() => normalizeProgramRecord(raw(),{...source(),...patch}));
    }
    assert.throws(() => normalizeProgramRecord(raw({countryCode:'FR'}),source()),{code:'SOURCE_COUNTRY_MISMATCH'});
    assert.throws(() => normalizeProgramRecord(raw({sourceId:'unregistered'}),source()),{code:'SOURCE_MISMATCH'});
    assert.throws(() => normalizeProgramRecord(raw({checkedAt:'9999-01-01'}),source()),{code:'INVALID_DATE'});
    const ownSource = {...source(),id:'example-university',kind:'institution',url:'https://example.edu/'};
    const ownRecord = raw({programUrl:'https://example.edu/study/123',sourceUrl:'https://example.edu/study/123',listingSourceUrl:undefined});
    assert.equal(normalizeProgramRecord(ownRecord,ownSource).verificationStatus,'official-source');
    assert.throws(() => normalizeProgramRecord({...ownRecord,institutionWebsite:'https://other.edu/'},ownSource),{code:'SOURCE_MISMATCH'});
});

test('known numeric facts retain their units and scopes, while invalid or incomplete facts are rejected',() => {
    const fee = {amount:0,currency:'EUR',period:'year',applicantScope:'all'};
    const program = normalizeProgramRecord(raw({degree:'master',language:'en',field:'computer-science',category:'tech',tuition:fee,durationMonths:24,
        requirements:{gpaMinPercent:65,experienceYears:0,languageTest:{name:'IELTS Academic',minScore:6.5,componentsMinScore:6,componentMinimums:{reading:6,listening:6,speaking:6,writing:6}}},
        deadline:{date:'2027-06-15',cycle:'2027 autumn'}}),source());
    assert.equal(program.tuition.amount,0);assert.equal(program.funding.fullFunding,null);assert.equal(program.requirements.experienceYears,0);
    assert.equal(program.requirements.languageTest.componentMinimums.writing,6);assert.equal(program.deadline.date,'2027-06-15');
    for (const patch of [{tuition:{amount:1000}},{tuition:{...fee,amount:-1}},{tuition:{...fee,period:'semester'}},{durationMonths:0},
        {requirements:{gpaMinPercent:101}},{requirements:{gpaMinPercent:'70'}},{requirements:{languageTest:{name:'IELTS Academic',minScore:10}}},
        {deadline:{date:'2027-02-29'}},{funding:{fullFunding:'yes'}}]) assert.throws(() => normalizeProgramRecord(raw(patch),source()));
});

test('domain and country mapping attaches a unique institution and remains compatible with CatalogCore attachment',() => {
    const result = merge([raw({institutionName:'Published name variant',institutionWebsite:'https://admissions.example.edu/'})]);
    assert.equal(result.report.accepted,1);assert.equal(result.programs[0].institutionId,institution().id);
    assert.equal(Core.attachInstitutionPrograms([institution()],result.programs).unmatchedPrograms.length,0);
    const wrongCountry = merge([raw()],{directory:[institution({countryCode:'US'})]});
    assert.equal(wrongCountry.programs.length,0);assert.equal(wrongCountry.report.unmatched,1);
});

test('orphan, absent and shared ambiguous institution websites are quarantined without name-only attachment',() => {
    const orphan = merge([raw({institutionWebsite:'https://unlisted.edu/'}),raw({institutionWebsite:null})]);
    assert.equal(orphan.programs.length,0);assert.equal(orphan.report.unmatched,2);assert.equal(orphan.report.accepted,0);
    const ambiguous = merge([raw({institutionName:'Unknown campus'})],{directory:[institution(),institution({id:'inst_second',name:'Second Campus'})]});
    assert.equal(ambiguous.programs.length,0);assert.equal(ambiguous.report.ambiguous,1);assert.equal(ambiguous.report.issues[0].institutionIds.length,2);
    const named = merge([raw()],{directory:[institution(),institution({id:'inst_second',name:'Second Campus'})]});
    assert.equal(named.report.accepted,1);assert.equal(named.programs[0].institutionId,'inst_example');
});

test('repeat imports and duplicate rows are idempotent and deterministic',() => {
    const first = merge([raw(),raw()]);
    assert.equal(first.programs.length,1);assert.equal(first.report.accepted,1);assert.equal(first.report.duplicates,1);
    const second = merge([raw()],{existingPrograms:first.programs});
    assert.deepEqual(second.programs,first.programs);assert.equal(second.report.accepted,0);assert.equal(second.report.updated,0);assert.equal(second.report.duplicates,1);
    const a = raw({sourceRecordId:'a',title:'Biology',programUrl:'https://directory.example.org/study/a',sourceUrl:'https://directory.example.org/study/a'});
    const b = raw({sourceRecordId:'b',title:'Law',programUrl:'https://directory.example.org/study/b',sourceUrl:'https://directory.example.org/study/b'});
    assert.deepEqual(merge([a,b]).programs,merge([b,a]).programs);
});

test('distinct published source IDs and URLs preserve same-title tracks through repeated and reordered imports',() => {
    const first=raw({degree:'master',sourceRecordId:'track-1',programUrl:'https://directory.example.org/study/track-1',sourceUrl:'https://directory.example.org/study/track-1'});
    const second=raw({degree:'master',sourceRecordId:'track-2',programUrl:'https://directory.example.org/study/track-2',sourceUrl:'https://directory.example.org/study/track-2'});
    const imported=merge([first,second]);
    assert.equal(imported.programs.length,2);assert.equal(imported.report.accepted,2);
    assert.equal(new Set(imported.programs.map(program=>program.id)).size,2);
    assert.deepEqual(merge([second,first]).programs,imported.programs);
    const again=merge([second,first],{existingPrograms:imported.programs});
    assert.equal(again.report.updated,0);assert.equal(again.report.duplicates,2);assert.deepEqual(again.programs,imported.programs);
    const withManual=merge([first,second],{existingPrograms:[curated()]});
    assert.equal(withManual.programs.length,3);assert.equal(withManual.programs[0].id,'program_existing-manual');
    assert.equal(withManual.report.updated,0);assert.equal(withManual.report.accepted,2);
    assert.equal(withManual.programs[0].tuition.amount,0);
    assert.deepEqual(merge([second,first],{existingPrograms:[curated()]}).programs,withManual.programs);
    const exact=merge([first,second],{existingPrograms:[curated({programUrl:first.programUrl})]});
    assert.equal(exact.programs.length,2);assert.equal(exact.programs[0].id,'program_existing-manual');
    assert.equal(exact.programs[0].programUrl,first.programUrl);
});

test('published raw language labels survive unsupported language codes and refresh without inferring an English-only route',() => {
    const multilingual=raw({languages:['en'],language:null,sourceLanguages:['English','Russian']});
    const program=normalizeProgramRecord(multilingual,source());
    assert.equal(program.language,null);assert.deepEqual(program.languages,['en']);assert.deepEqual(program.sourceLanguages,['English','Russian']);
    const first=merge([raw({language:'en',languages:['en'],sourceLanguages:['English']})]);
    const refreshed=merge([multilingual],{existingPrograms:first.programs,checkedAt:'2026-10-28'});
    assert.equal(refreshed.programs[0].id,first.programs[0].id);assert.equal(refreshed.programs[0].language,null);
    assert.deepEqual(refreshed.programs[0].sourceLanguages,['English','Russian']);
    for(const sourceLanguages of ['English',[42],[''],Array.from({length:65},()=> 'English')])assert.throws(()=>normalizeProgramRecord(raw({sourceLanguages}),source()),{code:'INVALID_RECORD'});
});

test('matching a curated programme preserves its ID, fee, admission requirements, dates and institution-owned sources',() => {
    const existing = curated();
    const before = structuredClone(existing);
    const result = merge([raw({degree:'master',language:'de',title:'Computer Science',tuition:{amount:5000,currency:'EUR',period:'year',applicantScope:'all'},requirements:{gpaMinPercent:50,languageLevel:'B2'}})],{existingPrograms:[existing]});
    assert.equal(result.programs.length,1);assert.equal(result.report.updated,1);assert.equal(result.report.accepted,0);
    const program = result.programs[0];
    assert.equal(program.id,existing.id);assert.equal(program.language,'en');assert.deepEqual(program.tuition,existing.tuition);assert.deepEqual(program.requirements,existing.requirements);
    assert.deepEqual(program.sources.slice(0,2),existing.sources);assert.equal(program.verificationStatus,'official-source');assert.equal(program.updatedAt,DATE);
    assert.equal(program.imports[0].sourceId,source().id);assert.deepEqual(existing,before,'Inputs must remain unmodified');
    assert.equal(merge([raw({degree:'master'})],{existingPrograms:result.programs}).programs.length,1);
});

test('shared fee-policy sources never collapse different programmes, and ambiguous programme identities are quarantined',() => {
    const second = curated({id:'program_second',title:'Applied Physics (M.Sc.)',field:'physics',category:'science',sources:[{url:'https://example.edu/study/physics',label:'Physics',checkedAt:DATE},curated().sources[1]]});
    const result = merge([raw({degree:'master'})],{existingPrograms:[curated(),second]});
    assert.equal(result.programs.length,2);assert.equal(result.programs[1].title,second.title);
    const ambiguous = merge([raw({degree:'master'})],{existingPrograms:[curated(),curated({id:'program_duplicate-manual'})]});
    assert.equal(ambiguous.report.ambiguous,1);assert.equal(ambiguous.programs.length,2);assert.equal(ambiguous.report.accepted,0);
});

test('a new amount cannot be combined with incompatible old fee units or applicant scope',() => {
    const existing = curated({tuition:{amount:null,currency:'EUR',period:'year',applicantScope:'non-eu',note:'Cohort needs verification.'}});
    const result = merge([raw({degree:'master',tuition:{amount:5000,currency:'USD',period:'program',applicantScope:'all'}})],{existingPrograms:[existing]});
    assert.deepEqual(result.programs[0].tuition,existing.tuition);
});

test('newer imported metadata updates the same identity without erasing verified values with nulls',() => {
    const first = merge([raw({degree:'master',language:'en'})]);
    const nextDate = '2026-10-28';
    const second = merge([raw({degree:'master',title:'Computing Science',language:null})],{existingPrograms:first.programs,checkedAt:nextDate});
    assert.equal(second.programs.length,1);assert.equal(second.programs[0].id,first.programs[0].id);
    assert.equal(second.programs[0].title,'Computing Science');assert.equal(second.programs[0].language,'en');assert.equal(second.programs[0].updatedAt,nextDate);
    assert.equal(second.programs[0].sources[0].checkedAt,nextDate);
});

test('coverage counts actual linked institutions and explicitly remains partial even if every listed institution has a programme',() => {
    const imported = merge([raw()]).programs;
    const absent = institution({id:'inst_absent',name:'Absent University',website:'https://absent.edu/',domains:['absent.edu'],countryCode:'FR'});
    const coverage = computeProgramCoverage([institution(),absent],imported,{sources:[source(),{id:'not-yet-imported',kind:'institution',checkedAt:DATE}]});
    assert.equal(coverage.institutionCount,2);assert.equal(coverage.institutionsWithPrograms,1);assert.equal(coverage.institutionsWithoutPrograms,1);
    assert.equal(coverage.programCount,1);assert.equal(coverage.coveragePercent,50);assert.equal(coverage.completeness,'partial');
    assert.equal(coverage.sources[0].programCount,1);assert.equal(coverage.sources[1].status,'not-imported');assert.equal(coverage.sources[0].complete,false);
    assert.equal(computeProgramCoverage([institution()],imported).completeness,'partial');
    const orphan = {...imported[0],institutionId:'inst_forged',institutionWebsite:'https://unlisted.edu/'};
    assert.equal(computeProgramCoverage([institution()],[orphan]).unmatchedProgramCount,1);
});

test('a malformed row does not discard valid rows or mutate the existing snapshot',() => {
    const existing = [curated()];
    const before = structuredClone(existing);
    const result = merge([raw({degree:'master'}),raw({sourceRecordId:'bad',countryCode:'XX'}),null],{existingPrograms:existing});
    assert.equal(result.report.updated,1);assert.equal(result.report.invalid,2);assert.equal(result.report.totalRecords,3);
    assert.equal(result.programs.length,1);assert.deepEqual(existing,before);assert.equal(result.report.sourceComplete,false);
});
