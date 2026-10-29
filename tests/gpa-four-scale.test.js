'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const Core=require('../catalog-core');
const Scoring=require('../scoring-core');
const {normalizeProgramRecord}=require('../program-catalog-core');
const {validatePrograms}=require('../scripts/validate-programs');
const catalog=require('../Server/data/programs.json');
const original=catalog.programs.find(p=>p.id==='program_saarland-computer-science-msc');
const program=requirements=>({...structuredClone(original),requirements:{...original.requirements,gpaMinPercent:null,gpaMin4:3,...requirements}});
const institution={id:'inst_fixture',countryCode:'DE',name:original.institutionName,domains:['uni-saarland.de'],website:original.institutionWebsite};
const options={asOf:'2026-10-28',institution};

test('four-point GPA preserves zero and four, permits decimals and rejects values outside the declared scale',()=>{
    for(const value of [0,4,3.75,'3.75']){const prefs=Core.normalizePreferences({gpa4:value});assert.equal(prefs.gpa4,Number(value));assert.equal(prefs.gpaPercent,null);assert.deepEqual(prefs.issues,[]);}
    for(const value of [-0.01,4.01,85,NaN,Infinity,'invalid',[],{}]){const prefs=Core.normalizePreferences({gpa4:value});assert.equal(prefs.gpa4,null);assert.ok(prefs.issues.length);}
    for(const value of [null,undefined,'']){const prefs=Core.normalizePreferences({gpa4:value});assert.equal(prefs.gpa4,null);assert.deepEqual(prefs.issues,[]);}
});

test('GPA and percent profiles are explicit independent scales and simultaneous grading systems are not accepted',()=>{
    const prefs=Core.normalizePreferences({gpaPercent:85});assert.equal(prefs.gpaPercent,85);assert.equal(prefs.gpa4,null);
    const conflict=Core.normalizePreferences({gpa4:3.5,gpaPercent:85});assert.ok(conflict.issues.length);
    assert.equal(Core.academicComparison(program(),conflict).status,'unknown');
    const inferred=Core.normalizePreferences({gpa:3.5});assert.equal(inferred.gpa4,null);assert.equal(inferred.gpaPercent,3.5,'Old shorthand remains legacy percent rather than silently changing units');
});

test('only matching published grading systems establish an academic match or an exclusion',()=>{
    assert.equal(Core.academicComparison(program(),{gpa4:3}).status,'met');
    assert.equal(Core.academicComparison(program(),{gpa4:4}).status,'met');
    assert.equal(Core.academicComparison(program(),{gpa4:2.99}).status,'below');
    assert.equal(Core.academicComparison(program({gpaMin4:0}),{gpa4:0}).status,'met');
    const below=Core.evaluateProgram(program(),{gpa4:2.99,requiresFullFunding:false},options);assert.equal(below.status,'excluded');assert.ok(below.exclusionReasons.some(reason=>reason.includes('3 / 4 GPA')));
    const mismatched=Core.evaluateProgram(program({gpaMin4:null,gpaMinPercent:70}),{gpa4:3.9,requiresFullFunding:false},options);
    assert.equal(mismatched.status,'needs-verification');assert.ok(mismatched.missing.some(reason=>reason.includes('პირდაპირ არ შედარდება')));assert.ok(!mismatched.exclusionReasons.some(reason=>reason.includes('აკადემიური')));
    assert.equal(Core.academicComparison(program(),{gpaPercent:99}).status,'unknown');
    assert.equal(Core.academicComparison(program({gpaMin4:null,gpaMinPercent:70}),{gpaPercent:85}).status,'met');
});

test('same-scale academic scores and margins retain their units and never become personal admission probabilities',()=>{
    const minimum=Scoring.scoreProgram(program(),institution,{gpa4:3,requiresFullFunding:false},options);
    const maximum=Scoring.scoreProgram(program(),institution,{gpa4:4,requiresFullFunding:false},options);
    assert.equal(minimum.fitScore,60);assert.equal(maximum.fitScore,100);
    assert.equal(maximum.academicMargin,1);assert.equal(maximum.academicMarginScale,4);
    assert.equal(maximum.admissionChance.probability,null);
    const mismatched=Scoring.scoreProgram(program({gpaMin4:null,gpaMinPercent:70}),institution,{gpa4:3.9,requiresFullFunding:false},options);
    assert.equal(mismatched.academicMargin,null);assert.equal(mismatched.academicMarginScale,null);
    assert.equal(mismatched.fitScore,null);assert.equal(mismatched.dataCoverage,0);
    assert.equal(mismatched.breakdown.find(row=>row.key==='academics').status,'unknown');
    const legacy=Scoring.scoreProgram(program({gpaMin4:null,gpaMinPercent:70}),institution,{gpaPercent:85,requiresFullFunding:false},options);
    assert.equal(legacy.academicMargin,15);assert.equal(legacy.academicMarginScale,100);
});

test('legacy browser profiles retain archived percent evidence but require students to supply the new GPA themselves',()=>{
    const input={gpaPercent:85,countryCode:'DE',languageTests:[]};
    const result=Core.migrateAcademicProfile(input);
    assert.equal(result.profile.gpa4,undefined);assert.equal(result.profile.gpaPercent,undefined);
    assert.deepEqual(result.profile.legacyAcademicRecord,{gpaPercent:85,scale:100});assert.equal(result.requiresGpaEntry,true);
    assert.deepEqual(input,{gpaPercent:85,countryCode:'DE',languageTests:[]});
    const repeated=Core.migrateAcademicProfile(result.profile);assert.equal(repeated.migrated,false);assert.deepEqual(repeated.profile,result.profile);
    const newProfile=Core.migrateAcademicProfile({gpa4:3.75,countryCode:'GE'});assert.equal(newProfile.migrated,false);assert.equal(newProfile.profile.gpa4,3.75);
    const zero=Core.migrateAcademicProfile({gpaPercent:0});assert.equal(zero.requiresGpaEntry,true);assert.equal(zero.profile.legacyAcademicRecord.gpaPercent,0);
});

test('programme import and validation retain explicit four-point minima without converting percent-only records',()=>{
    const source={id:'gpa-fixture',kind:'official-directory',url:'https://directory.example.org/programmes/',countryCodes:['DE'],checkedAt:'2026-10-28'};
    const raw={institutionName:'GPA Fixture University',institutionWebsite:'https://fixture-university.edu/',countryCode:'DE',title:'Fixture Degree',programUrl:'https://directory.example.org/programmes/one',requirements:{gpaMin4:3.2}};
    const imported=normalizeProgramRecord(raw,source);assert.equal(imported.requirements.gpaMin4,3.2);assert.equal(imported.requirements.gpaMinPercent,null);
    for(const value of [-1,4.01,NaN,Infinity])assert.throws(()=>normalizeProgramRecord({...raw,requirements:{gpaMin4:value}},source));
    const unchanged=normalizeProgramRecord({...raw,requirements:{gpaMinPercent:80}},source);assert.equal(unchanged.requirements.gpaMin4,undefined);assert.equal(unchanged.requirements.gpaMinPercent,80);
    const valid={metadata:{programCount:1},programs:[program()]};assert.deepEqual(validatePrograms(valid),[]);
    for(const value of [4.1,-1,NaN,Infinity,'3.2']){const invalid=structuredClone(valid);invalid.programs[0].requirements.gpaMin4=value;assert.ok(validatePrograms(invalid).some(error=>error.includes('4-point')));}
});
