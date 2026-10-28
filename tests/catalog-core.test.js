'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../catalog-core');
const institution = {id:'inst-example',name:'Example Universität',countryCode:'DE',country:'გერმანია',countryEnglish:'Germany',region:'europe',website:'https://www.example.edu',domains:['example.edu']};
const program = () => ({id:'program-example',institutionId:institution.id,institutionName:institution.name,institutionWebsite:institution.website,title:'Computer Science MSc',field:'Computer Science',category:'tech',degree:'master',countryCode:'DE',language:'en',mode:'full-time',durationMonths:24,tuition:{amount:5000,currency:'EUR',period:'year',applicantScope:'all'},funding:{fullFunding:false,scholarships:[]},requirements:{gpaMinPercent:75,languageLevel:'B2',experienceYears:0},eligibility:{internationalApplicants:true},deadline:{date:'2027-05-01'},sources:[{url:'https://example.edu/program',checkedAt:'2026-10-01'}],verificationStatus:'official-source'});
const preferences = () => ({countryCode:'DE',region:'europe',degree:'master',field:'tech',language:'en',mode:'full-time',budget:6000,currency:'EUR',budgetPeriod:'year',gpaPercent:85,languageLevel:'C1',citizenshipCode:'GE'});
const evaluate = (p = program(), prefs = preferences()) => Core.evaluateProgram(p,prefs,{institution,asOf:'2026-10-27'});

test('UMD exports the same matching functions in a browser-like environment', () => {
    const context = {Intl,URL,Date}; context.globalThis = context;
    vm.runInNewContext(fs.readFileSync(require.resolve('../catalog-core'),'utf8'),context);
    assert.equal(typeof context.CatalogCore.recommendPrograms,'function');
    assert.equal(context.CatalogCore.countryInfo('GE').name,'საქართველო');
});
test('known checked constraints match without claiming admission probability', () => {
    const result = evaluate(); assert.equal(result.status,'matches'); assert.equal(result.score,100); assert.equal(result.scoreLabel,'პრეფერენციების შესაბამისობა'); assert.deepEqual(result.missing,[]);
    assert.ok(result.reasons.some(reason => reason.includes('საფასური'))); assert.equal('admissionProbability' in result,false);
});
test('normalize aliases and preserve null instead of coercing unknown values to zero', () => {
    const result = Core.normalizePreferences({country:'გერმანია',degree:'მაგისტრატურა',major:'Technology & Engineering',lang:'ინგლისური',gpa:null,budget:''});
    assert.equal(result.countryCode,'DE'); assert.equal(result.degree,'master'); assert.equal(result.field,'tech'); assert.equal(result.language,'en'); assert.equal(result.gpaPercent,null); assert.equal(result.budget,null);
    assert.equal(Core.normalizePreferences({budget:'   ',gpa:[]}).budget,null); assert.equal(Core.normalizePreferences({gpa:[]}).gpaPercent,null);
});
test('explicit country, degree, category, language and mode mismatches exclude', () => {
    for (const patch of [{countryCode:'IT'},{degree:'bachelor'},{field:'business'},{language:'de'},{mode:'online'}]) assert.equal(evaluate(program(),{...preferences(),...patch}).status,'excluded');
});
test('natural sciences preference does not match computer science by substring', () => {
    assert.equal(evaluate(program(),{...preferences(),field:'science'}).status,'excluded');
    assert.equal(evaluate(program(),{...preferences(),field:'computer-science'}).status,'matches');
});
test('missing program attribute is conditional, never an arbitrary fallback', () => {
    const p = program(); p.language = null; const result = evaluate(p);
    assert.equal(result.status,'needs-verification'); assert.ok(result.missing.some(item => item.includes('სწავლების ენა')));
});
test('an unknown price is not free and cannot satisfy a positive budget', () => {
    const p = program(); p.tuition.amount = null;
    const result = evaluate(p); assert.equal(result.status,'needs-verification'); assert.ok(result.missing.some(item => item.includes('უცნობი ფასი'))); assert.ok(result.score < 100);
});
test('currency conversion and annualization are never silently invented', () => {
    const p = program(); p.tuition.currency = 'GBP';
    assert.equal(evaluate(p).status,'needs-verification');
    p.tuition.currency = 'EUR'; p.tuition.period = 'program'; assert.equal(evaluate(p).status,'needs-verification');
});
test('zero tuition does not imply a fully funded study package', () => {
    const p = program(); p.tuition.amount = 0;
    assert.equal(evaluate(p,{...preferences(),budget:0}).status,'excluded');
    p.funding.fullFunding = null; assert.equal(evaluate(p,{...preferences(),budget:0}).status,'needs-verification');
    p.funding.fullFunding = true; const result = evaluate(p,{...preferences(),budget:0}); assert.equal(result.status,'matches'); assert.ok(result.warnings.some(item => item.includes('ავტომატურად')));
});
test('a tuition-only zero budget can be explicitly selected without requiring a scholarship', () => {
    const p = program(); p.tuition.amount = 0;
    assert.equal(evaluate(p,{...preferences(),budget:0,requiresFullFunding:false}).status,'matches');
});
test('tuition quotes for a different applicant scope are conditional', () => {
    const p = program(); p.tuition.applicantScope = 'non-eu';
    assert.equal(evaluate(p,{...preferences(),citizenshipCode:'DE'}).status,'needs-verification');
    assert.equal(evaluate(p,{...preferences(),citizenshipCode:''}).status,'needs-verification');
    assert.equal(evaluate(p).status,'needs-verification');
});
test('missing GPA data remains unknown; lower known grades exclude', () => {
    assert.equal(evaluate(program(),{...preferences(),gpaPercent:null}).status,'needs-verification');
    const p = program(); p.requirements.gpaMinPercent = null; assert.equal(evaluate(p).status,'needs-verification');
    assert.equal(evaluate(program(),{...preferences(),gpaPercent:50}).status,'excluded');
});
test('invalid GPA cannot become an eligibility claim', () => {
    const result = evaluate(program(),{...preferences(),gpaPercent:150});
    assert.equal(result.status,'needs-verification'); assert.ok(result.missing.some(item => item.includes('0–100')));
});
test('CEFR self report cannot substitute for a required official IELTS result', () => {
    const p = program(); p.requirements.languageLevel = null; p.requirements.languageTest = {name:'IELTS Academic',minScore:6.5};
    assert.equal(evaluate(p).status,'needs-verification');
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:6}]}).status,'excluded');
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:7}]}).status,'matches');
});
test('accepted language tests are alternatives, not jointly required', () => {
    const p = program(); p.requirements.languageTests = [{name:'IELTS',minScore:6.5},{name:'TOEFL iBT',minScore:90}];
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:95}]}).status,'matches');
});
test('an overall language score never silently satisfies required section scores', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS',minScore:6.5,componentsMinScore:6};
    const prefs = {...preferences(),languageTests:[{name:'IELTS',score:7}]};
    const conditional = evaluate(p,prefs); assert.equal(conditional.status,'needs-verification'); assert.ok(conditional.missing.some(item => item.includes('კომპონენტების')));
    prefs.languageTests[0].minComponentScore = 5.5; assert.equal(evaluate(p,prefs).status,'excluded');
    prefs.languageTests[0].minComponentScore = 6; assert.equal(evaluate(p,prefs).status,'matches');
});
test('individual section minima are compared independently', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS',minScore:6.5,componentMinimums:{writing:6.5,speaking:6}};
    const prefs = {...preferences(),languageTests:[{name:'IELTS',score:7,components:{writing:6,speaking:7}}]};
    assert.equal(evaluate(p,prefs).status,'excluded'); prefs.languageTests[0].components.writing = 7; assert.equal(evaluate(p,prefs).status,'matches');
});
test('invalid preferences remain conditional after recommendation normalization', () => {
    const result = Core.recommendPrograms([program()],[institution],{...preferences(),gpaPercent:140},{asOf:'2026-10-27'});
    assert.equal(result.needsVerification.length,1); assert.ok(result.needsVerification[0].missing.some(item => item.includes('0–100')));
});
test('published experience and citizenship restrictions are enforced', () => {
    const p = program(); p.requirements.experienceYears = 2;
    assert.equal(evaluate(p).status,'needs-verification');
    assert.equal(evaluate(p,{...preferences(),experienceYears:1}).status,'excluded');
    p.requirements.experienceYears = 0; p.eligibility.citizenshipCodes = ['DE']; assert.equal(evaluate(p).status,'excluded');
});
test('unknown international eligibility is marked for verification', () => {
    const p = program(); delete p.eligibility;
    assert.equal(evaluate(p).status,'needs-verification');
});
test('deadlines use the injected date and exclude elapsed cycles', () => {
    const p = program(); p.deadline.date = '2026-10-26'; assert.equal(evaluate(p).status,'excluded');
    p.deadline.date = '2026-10-27'; assert.equal(evaluate(p).status,'matches'); assert.ok(evaluate(p).warnings.some(item => item.includes('დღეს')));
    p.deadline.date = null; assert.equal(evaluate(p).status,'needs-verification');
    p.deadline.rolling = true; assert.equal(evaluate(p).status,'matches');
});
test('old or future source checks cannot silently count as fresh', () => {
    const p = program(); p.sources[0].checkedAt = '2025-01-01'; assert.equal(evaluate(p).status,'needs-verification');
    p.sources[0].checkedAt = '2026-12-01'; assert.equal(evaluate(p).status,'needs-verification');
    p.sources = []; assert.equal(evaluate(p).status,'needs-verification');
});
test('official domain linking is deterministic and does not choose ambiguous campuses', () => {
    const p = program(); p.institutionId = null; p.institutionName = 'Name variation';
    assert.equal(Core.resolveInstitution(p,[institution]).id,institution.id);
    const second = {...institution,id:'other-campus',name:'Other Campus'};
    assert.equal(Core.resolveInstitution(p,[institution,second]),null);
    p.institutionName = 'Example Universitat'; assert.equal(Core.resolveInstitution(p,[institution,second]).id,institution.id);
});
test('linking does not mutate directory records or assign orphan programs arbitrarily', () => {
    const orphan = {...program(),id:'orphan',institutionId:null,institutionName:'Absent',institutionWebsite:'https://absent.example'};
    const result = Core.attachInstitutionPrograms([institution],[program(),orphan]);
    assert.equal(result.institutions[0].programCount,1); assert.equal(result.unmatchedPrograms.length,1); assert.equal(result.unmatchedPrograms[0].institutionId,null); assert.equal(institution.programCount,undefined);
});
test('search supports English, Georgian, ISO code and official domain', () => {
    for (const query of ['გერმანია','Germany','DE','example.edu','universitat']) assert.equal(Core.searchInstitution(institution,query),true);
    assert.equal(Core.searchInstitution(institution,'Germany chemistry'),false);
    assert.equal(Core.filterInstitutions([institution],{countryCode:'IT'}).length,0);
    assert.equal(Core.filterInstitutions([institution],{region:'europe',query:'Germany'}).length,1);
});
test('no matching program returns an empty result instead of first records', () => {
    const result = Core.recommendPrograms([program()],[institution],{...preferences(),countryCode:'JP'},{asOf:'2026-10-27'});
    assert.equal(result.matches.length,0); assert.equal(result.needsVerification.length,0); assert.equal(result.excludedCount,1);
    assert.equal(result.excluded[0].program.id,program().id); assert.ok(result.excluded[0].exclusionReasons.some(item => item.includes('ქვეყანა')));
});
test('arbitrary JSON preferences and malformed test rows never crash or qualify', () => {
    for (const input of [null,[],true,42,'profile']) {
        const normalized = Core.normalizePreferences(input); assert.ok(normalized.issues.length); assert.equal(evaluate(program(),input).status,'needs-verification');
    }
    for (const languageTests of [[null],[42],['IELTS'],[{}],[{name:null,score:7}],{name:'IELTS',score:7}]) {
        const result = evaluate(program(),{...preferences(),languageTests}); assert.equal(result.status,'needs-verification'); assert.ok(result.missing.length);
    }
});
test('invalid preference enums and malformed fields remain visible validation issues', () => {
    for (const patch of [{degree:42},{degree:'certificate'},{language:42},{language:'xx'},{mode:'telepathy'},{region:'mars'},{countryCode:'ZZ'},{languageLevel:'C7'},{currency:'ZZZ'},{budgetPeriod:'month'},{requiresFullFunding:'yes'},{field:{}},{query:[]}]) {
        const result = evaluate(program(),{...preferences(),...patch}); assert.notEqual(result.status,'matches',JSON.stringify(patch)); assert.ok(result.missing.length,JSON.stringify(patch));
    }
});
test('negative and nonnumeric budgets never disappear into unrestricted matching', () => {
    for (const budget of [-100,'free',false,{},'Infinity']) {
        const normalized = Core.normalizePreferences({budget}); assert.equal(normalized.budget,null); assert.ok(normalized.issues.length);
        assert.notEqual(evaluate(program(),{...preferences(),budget}).status,'matches');
    }
});
test('IELTS rejects impossible overall scores and unsupported fractional bands', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS Academic',minScore:6.5};
    for (const score of [999,-1,9.5,6.25,'hello',false]) {
        const result = evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score}]});
        assert.equal(result.status,'needs-verification',String(score)); assert.ok(result.missing.some(item => item.includes('ქულა')));
    }
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:9}]}).status,'matches');
});
test('invalid IELTS minimum component scores cannot satisfy component requirements', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS Academic',minScore:6.5,componentsMinScore:6};
    for (const minComponentScore of [999,9.5,6.25,false,-1]) {
        assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:7,minComponentScore}]}).status,'needs-verification');
    }
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:7,minComponentScore:8}]}).status,'needs-verification');
});
test('legacy TOEFL overall and section ranges require integers within their own scales', () => {
    const p = program(); p.requirements.languageTest = {name:'TOEFL iBT',minScore:90,componentsMinScore:20};
    for (const score of [999,121,-1,90.5]) assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score,scoreScale:'0-120',minComponentScore:20}]}).status,'needs-verification');
    for (const minComponentScore of [999,31,20.5,-1]) assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:100,scoreScale:'0-120',minComponentScore}]}).status,'needs-verification');
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:100,scoreScale:'0-120',minComponentScore:20}]}).status,'matches');
});
test('TOEFL 1–6 and legacy0–120 results are never directly compared or converted', () => {
    const p = program(); p.requirements.languageTest = {name:'TOEFL iBT',minScore:90};
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:6}]}).status,'needs-verification');
    const newResult = evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:6,scoreScale:'1-6'}]});
    assert.equal(newResult.status,'needs-verification'); assert.ok(newResult.missing.some(item => item.includes('პირდაპირ არ შედარდება')));
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:6,scoreScale:'0-120'}]}).status,'excluded');
    p.requirements.languageTest = {name:'TOEFL iBT',minScore:4.5,scoreScale:'1-6'};
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:5,scoreScale:'1-6'}]}).status,'matches');
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'TOEFL iBT',score:100,scoreScale:'0-120'}]}).status,'needs-verification');
});
test('an accepted alternative test can satisfy language proof despite another test failing sections', () => {
    const p = program(); p.requirements.languageTests = [{name:'IELTS',minScore:6.5,componentsMinScore:6},{name:'TOEFL iBT',minScore:90}];
    const result = evaluate(p,{...preferences(),languageTests:[{name:'IELTS',score:7,minComponentScore:5.5},{name:'TOEFL iBT',score:100,scoreScale:'0-120'}]});
    assert.equal(result.status,'matches'); assert.ok(result.reasons.some(item => item.includes('TOEFL')));
});
test('inconsistent overall and individual section results cannot qualify', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS Academic',minScore:6.5};
    const result = evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:9,components:{reading:6,listening:6,speaking:6,writing:6}}]});
    assert.equal(result.status,'needs-verification'); assert.ok(result.missing.some(item => item.includes('საერთო ქულას')));
});
test('malformed component records are validation issues instead of exceptions', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS Academic',minScore:6.5,componentsMinScore:6};
    for (const components of [[],false,{reading:999},{reading:6.25},{readng:7}]) {
        const result = evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:7,components}]});
        assert.equal(result.status,'needs-verification');
    }
});
test('impossible published test thresholds remain unverified rather than qualifying students', () => {
    const p = program(); p.requirements.languageTest = {name:'IELTS Academic',minScore:6.5,componentsMinScore:999};
    assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:7,minComponentScore:7}]}).status,'needs-verification');
    p.requirements.languageTest.minScore = 999; assert.equal(evaluate(p,{...preferences(),languageTests:[{name:'IELTS Academic',score:7}]}).status,'needs-verification');
});
test('EEA or Swiss citizenship alone cannot determine nonEU tuition classification', () => {
    const p = program(); p.tuition.applicantScope = 'non-eu';
    for (const citizenshipCode of ['NO','IS','LI','CH']) {
        const result = evaluate(p,{...preferences(),citizenshipCode}); assert.equal(result.status,'needs-verification'); assert.ok(result.missing.some(item => item.includes('EEA')));
    }
});
test('unknown work experience requirements stay explicit instead of becoming zero', () => {
    const p = program(); p.requirements.experienceYears = null;
    const result = evaluate(p); assert.equal(result.status,'needs-verification'); assert.ok(result.missing.some(item => item.includes('გამოცდილების მოთხოვნა')));
});
