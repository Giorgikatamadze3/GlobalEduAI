'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const Profile=require('../student-profile-core'),Core=require('../catalog-core'),Scoring=require('../scoring-core');
const program=require('../Server/data/programs.json').programs.find(p=>p.id==='program_aalto-computer-science-msc');
const complete={academicUniversity:'Tbilisi State University',academicFaculty:'Computer Science',academicSubject:'computer-science',completedDegree:'bachelor',degreeStatus:'completed',gpa4:3.7,certificateStatus:'provided',languageCertificate:{name:'IELTS Academic',score:7,minComponentScore:6.5},targetDegree:'master',targetSubject:'data-science',studyGoal:'Study machine learning'};
test('academic profile validates canonical choices, GPA and explicit test scales without conversions',()=>{
    const data=Profile.normalizeExtras(complete);assert.equal(data.gpa4,3.7);assert.equal(data.languageCertificate.score,7);
    for(const patch of [{gpa4:90},{gpa4:'3.7'},{academicSubject:'invented'},{studyGoal:'x'.repeat(1501)},{languageCertificate:{name:'IELTS Academic',score:10}},{languageCertificate:{name:'TOEFL iBT',score:100,scoreScale:'1-6'}},{certificateStatus:'provided',languageCertificate:null}])assert.throws(()=>Profile.normalizeExtras({...complete,...patch}));
    assert.equal(Profile.normalizeExtras({...complete,certificateStatus:'none'}).languageCertificate,null);
    assert.deepEqual(Profile.normalizeExtras({}),{});
    assert.equal(Profile.normalizeExtras({...complete,languageCertificate:{name:'Goethe-Zertifikat B2',score:null}}).languageCertificate.name,'Goethe-Zertifikat B2');
    assert.throws(()=>Profile.normalizeExtras({academicUniversity:'Name\u0000invalid'}));
    assert.throws(()=>Profile.normalizeExtras({...complete,languageCertificate:{name:'TOEFL iBT',score:80,scoreScale:'0-120',minComponentScore:25}}));
});
test('saved academic profile produces a bounded matching profile without account identity or guessed subject equivalence',()=>{
    const prefs=Profile.matchingProfile({...complete,name:'Private',email:'private@example.com',password:'secret'});
    assert.equal(prefs.priorSubject,'computer-science');assert.deepEqual(prefs.degrees,['master']);assert.deepEqual(prefs.subjectFields,['data-science']);assert.equal(prefs.gpa4,3.7);assert.equal(prefs.languageTests[0].score,7);assert.equal(prefs.name,undefined);assert.equal(prefs.email,undefined);assert.equal(prefs.password,undefined);
    assert.deepEqual(Profile.matchingProfile(null),{});
});
test('published background checks distinguish degree level, subject match and mandatory transcript review',()=>{
    const prefs=Profile.matchingProfile(complete),checks=Core.academicBackgroundComparison(program,prefs);
    assert.ok(checks.some(c=>c.status==='matched'));assert.ok(checks.some(c=>c.status==='unknown'&&c.detail.includes('კრედიტ')));
    assert.ok(Core.academicBackgroundComparison(program,{...prefs,priorDegree:'high-school'}).some(c=>c.status==='not-matched'));
    assert.ok(Core.academicBackgroundComparison(program,{...prefs,priorSubject:'finance'}).some(c=>c.status==='unknown'));assert.ok(!Core.academicBackgroundComparison(program,{...prefs,priorSubject:'finance'}).some(c=>c.status==='not-matched'));
    assert.ok(Core.academicBackgroundComparison(program,{...prefs,degreeStatus:'in-progress'}).some(c=>c.status==='unknown'));
});
test('unknown academic requirements reduce evidence coverage and never create an individual admission probability',()=>{
    const prefs=Profile.matchingProfile({...complete,targetSubject:'computer-science'}),unknown={...program,requirements:{}};
    const result=Scoring.scoreProgram(unknown,null,prefs,{asOf:'2026-10-30'});
    assert.equal(result.breakdown.find(c=>c.key==='academics').status,'unknown');assert.equal(result.admissionChance.probability,null);assert.equal(result.readiness.status,'needs-verification');
    const first=Scoring.scoreProgram(program,null,{...prefs,academicUniversity:'Famous university'},{asOf:'2026-10-30'}),second=Scoring.scoreProgram(program,null,{...prefs,academicUniversity:'Different university'},{asOf:'2026-10-30'});assert.equal(first.fitScore,second.fitScore);
});
test('SQLite persists academic profile and certificate removal without changing other saved details',()=>{
    const {createAccountStore}=require('../Server/account-store'),store=createAccountStore({filename:':memory:'});
    try{const user=store.createUser({id:'academic-user',name:'Test Student',email:'academic@example.com',phone:'+995555123456',passwordHash:require('bcryptjs').hashSync('TestPassword123!',4),role:'student',studentProfile:complete});assert.equal(user.studentProfile.academicFaculty,'Computer Science');store.updateUser(user.id,{studentProfile:{academicFaculty:'Data Science'}});assert.equal(store.findById(user.id).studentProfile.languageCertificate.score,7);store.updateUser(user.id,{studentProfile:{certificateStatus:'none'}});assert.equal(store.findById(user.id).studentProfile.languageCertificate,null);}finally{store.close();}
});
