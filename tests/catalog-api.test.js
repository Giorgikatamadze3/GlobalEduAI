'use strict';

const {test,before,after} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {validatePrograms} = require('../scripts/validate-programs');
const expectedPrograms=JSON.parse(fs.readFileSync(path.join(__dirname,'../Server/data/programs.json'),'utf8')).programs;
let server, base, accountStore;

before(async()=>{
    process.env.AUTH_DB_DRIVER='sqlite';
    process.env.AUTH_DB_PATH=':memory:';
    process.env.NODE_ENV='test';
    const app=require('../Server/server');
    accountStore=app.locals.accountStore;
    server=app.listen(0,'127.0.0.1');await once(server,'listening');
    base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));accountStore.close();});

test('worldwide catalog is usable with no MongoDB connection',async()=>{
    const response=await fetch(`${base}/api/catalog/meta`);assert.equal(response.status,200);
    const meta=await response.json();assert.ok(meta.institutionCount>=10000);assert.ok(meta.countryCount>=190);assert.equal(meta.programCount,expectedPrograms.length);assert.ok(meta.programCount>=1600);assert.equal(meta.programCoverage.completeness,'partial');assert.equal(meta.countries.length,meta.countryCount);
});
test('country search and pagination return institutions without invented program facts',async()=>{
    const response=await fetch(`${base}/api/institutions?countryCode=GE&limit=3`);const data=await response.json();
    assert.equal(data.limit,3);assert.equal(data.items.length,3);assert.ok(data.total>3);
    for(const item of data.items){assert.equal(item.countryCode,'GE');assert.equal(item.verificationStatus,'directory-listed');assert.ok(!('price'in item));assert.ok(!('degree'in item));assert.ok(!('matchScore'in item));}
});
test('search supports official domains and institution program linking',async()=>{
    const data=await fetch(`${base}/api/institutions?q=uni-saarland.de`).then(r=>r.json());assert.ok(data.items.length>=1);
    const institution=data.items.find(i=>i.programCount>0);assert.ok(institution);
    const detail=await fetch(`${base}/api/institutions/${institution.id}`).then(r=>r.json());
    assert.equal(detail.programs[0].institutionId,institution.id);assert.equal(detail.programs[0].tuition.amount,0);assert.equal(detail.programs[0].funding.fullFunding,null);
});
test('unknown institution ID returns 404 and bounded page size',async()=>{
    assert.equal((await fetch(`${base}/api/institutions/does-not-exist`)).status,404);
    const data=await fetch(`${base}/api/institutions?limit=999999&page=-1`).then(r=>r.json());assert.equal(data.limit,100);assert.equal(data.page,1);
});
test('full payload uses gzip caching without repeated directory transfer',async()=>{
    const response=await fetch(`${base}/api/catalog`,{headers:{'Accept-Encoding':'gzip'}});assert.equal(response.headers.get('content-encoding'),'gzip');
    const data=await response.json();assert.ok(data.institutions.length>=10000);assert.equal(data.programs.length,expectedPrograms.length);
    const ids=new Set(data.institutions.map(i=>i.id));assert.ok(data.programs.every(p=>ids.has(p.institutionId)));
    const cached=await fetch(`${base}/api/catalog`,{headers:{'If-None-Match':response.headers.get('etag')}});assert.equal(cached.status,304);
    const plain=await fetch(`${base}/api/catalog`,{headers:{'Accept-Encoding':'gzip;q=0, identity'}});assert.equal(plain.headers.get('content-encoding'),null);await plain.arrayBuffer();
});
test('budget-only zero tuition never becomes a full-funding promise',async()=>{
    const response=await fetch(`${base}/api/recommendations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({countryCode:'DE',degree:'master',currency:'EUR',budget:0,requiresFullFunding:true,citizenshipCode:'GE'})});
    const data=await response.json();assert.equal(data.matches.length,0);assert.ok(data.needsVerification.every(r=>r.status==='needs-verification'));
    assert.ok(data.needsVerification.some(r=>r.missing.some(reason=>reason.includes('დაფინანსების'))));
});
test('unavailable combination has no arbitrary fallback programs',async()=>{
    const data=await fetch(`${base}/api/recommendations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({countryCode:'JP',degree:'phd',language:'ka',budget:1,currency:'EUR'})}).then(r=>r.json());
    assert.equal(data.matches.length,0);assert.equal(data.needsVerification.length,0);assert.equal(data.excludedCount,expectedPrograms.length);
});
test('account operations use SQLite without a MongoDB connection',async()=>{
    const status=await fetch(`${base}/api/auth/status`).then(r=>r.json());
    assert.equal(status.provider,'sqlite');assert.equal(status.ready,true);assert.deepEqual(status.roles,['student','advisor']);
    assert.equal(accountStore.info.persistent,false);
    const response=await fetch(`${base}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'nobody@example.com',password:'irrelevant'})});
    assert.equal(response.status,401);
});

test('student registration creates a real cookie session and isolated profile in SQLite',async()=>{
    const body={name:'API Student',email:'catalog-student@example.com',phone:'+995555123456',password:'StrongPassword123',passwordConfirm:'StrongPassword123',role:'student',termsAccepted:true,studentProfile:{educationLevel:'bachelor',citizenshipCode:'GE',graduationYear:2026}};
    const registration=await fetch(`${base}/api/auth/register`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    assert.equal(registration.status,201);
    const cookie=registration.headers.get('set-cookie');assert.ok(cookie.includes('HttpOnly'));assert.ok(cookie.includes('SameSite=Lax'));
    const result=await registration.json();assert.equal(result.user.role,'student');assert.equal(result.user.email,body.email);assert.equal(result.user.passwordHash,undefined);assert.equal(result.token,undefined);
    const sessionCookie=cookie.split(';')[0];
    const me=await fetch(`${base}/api/auth/me`,{headers:{Cookie:sessionCookie}}).then(r=>r.json());assert.equal(me.user.id,result.user.id);
    const saved=await fetch(`${base}/api/user/profile`,{method:'PUT',headers:{'Content-Type':'application/json',Cookie:sessionCookie},body:JSON.stringify({favorites:['inst_test'],name:'Updated Student'})}).then(r=>r.json());
    assert.deepEqual(saved.user.favorites,['inst_test']);assert.equal(saved.user.name,'Updated Student');
    assert.equal((await fetch(`${base}/api/advisor/profile`,{headers:{Cookie:sessionCookie}})).status,403);
    assert.equal((await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Cookie:sessionCookie}})).status,200);
    assert.equal((await fetch(`${base}/api/auth/me`,{headers:{Cookie:sessionCookie}})).status,401);
});

test('credential CORS allows selected local origins without wildcard access',async()=>{
    const allowed=await fetch(`${base}/api/auth/status`,{headers:{Origin:'http://localhost:5500'}});
    assert.equal(allowed.headers.get('access-control-allow-origin'),'http://localhost:5500');
    assert.equal(allowed.headers.get('access-control-allow-credentials'),'true');
    const forbidden=await fetch(`${base}/api/auth/status`,{headers:{Origin:'https://untrusted.example'}});
    assert.equal(forbidden.headers.get('access-control-allow-origin'),null);
    const mutation=await fetch(`${base}/api/auth/logout`,{method:'POST',headers:{Origin:'https://untrusted.example'}});
    assert.equal(mutation.status,403);
});

test('production credential CORS accepts its own origin and rejects development-port exceptions',async()=>{
    const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
    try{
        const own=await fetch(`${base}/api/auth/status`,{headers:{Origin:base}});
        assert.equal(own.headers.get('access-control-allow-origin'),base);
        assert.equal(own.headers.get('access-control-allow-credentials'),'true');
        const dev=await fetch(`${base}/api/auth/status`,{headers:{Origin:'http://localhost:5500'}});
        assert.equal(dev.headers.get('access-control-allow-origin'),null);
    }finally{process.env.NODE_ENV=previous;}
});
test('server source and credentials are not static public assets',async()=>{
    for(const route of ['/Server/server.js','/Server/.env','/Server/data/accounts.sqlite','/package.json','/scripts/sync-institutions.js'])assert.equal((await fetch(`${base}${route}`)).status,404);
    assert.equal((await fetch(`${base}/catalog-ui.js`)).status,200);
    assert.equal((await fetch(`${base}/account-ui.js`)).status,200);
});
test('program validator rejects fabricated free prices and unowned references',()=>{
    const original=JSON.parse(fs.readFileSync(path.join(__dirname,'../Server/data/programs.json'),'utf8'));
    assert.deepEqual(validatePrograms(original),[]);
    const invalid=structuredClone(original);invalid.programs[0].tuition.amount='';invalid.programs[0].sources=[{url:'javascript:alert(1)',label:'Fake',checkedAt:'2026-10-27'}];
    const errors=validatePrograms(invalid);assert.ok(errors.some(e=>e.includes('tuition')));assert.ok(errors.some(e=>e.includes('references')));
});
test('advanced filters are available through the institution API',async()=>{
    const data=await fetch(`${base}/api/institutions?countryCodes=DE,FI&fields=tech&degrees=master&durationMaxMonths=24`).then(r=>r.json());
    assert.ok(data.total>1&&data.total<20);assert.ok(data.items.every(i=>['DE','FI'].includes(i.countryCode)&&i.programCount>0));
});
test('recommendations include score breakdown and distinguish cohort rates from personal probability',async()=>{
    const data=await fetch(`${base}/api/recommendations`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({countryCodes:['FI'],fields:['tech'],degrees:['master'],requiresFullFunding:false,gpaPercent:85})}).then(r=>r.json());
    const result=[...data.matches,...data.needsVerification].find(r=>r.program.id==='program_helsinki-data-science-msc');assert.ok(result);
    assert.ok(result.scoring.fitScore>=0&&result.scoring.fitScore<=100);assert.ok(Array.isArray(result.scoring.breakdown));
    assert.equal(result.scoring.admissionChance.probability,null);assert.equal(result.scoring.admissionChance.baseline.offers,53);assert.equal(result.scoring.admissionChance.baseline.applicants,528);
});

test('funding API publishes dated official rules and no award promises',async()=>{
    const response=await fetch(`${base}/api/funding`);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.schemes.length,12);
    assert.ok(data.schemes.every(s=>s.sources.length&&s.sources.every(source=>source.url.startsWith('https://')&&source.checkedAt)));
    assert.ok(data.schemes.every(s=>s.awardGuaranteed!==true&&!('fullFunding' in s.coverage)));
});

test('programme detail distinguishes tuition waivers from personal funding eligibility',async()=>{
    const response=await fetch(`${base}/api/programs/program_helsinki-data-science-msc`);assert.equal(response.status,200);
    const data=await response.json();assert.equal(data.program.funding.fullFunding,null);
    const waiver=data.funding.find(a=>a.id==='funding_helsinki-master-waiver');assert.ok(waiver);
    assert.equal(waiver.associationStatus,'listed');assert.equal(waiver.awardGuaranteed,false);
    assert.equal(waiver.coverage.livingSupport,false);assert.ok(waiver.missing.length>0);
    assert.equal((await fetch(`${base}/api/programs/missing`)).status,404);
});

test('funding filter joins the actual programme and institution rather than country alone',async()=>{
    const data=await fetch(`${base}/api/institutions?fundingScheme=funding_helsinki-master-waiver`).then(r=>r.json());
    assert.equal(data.total,1);assert.match(data.items[0].name,/Helsinki/);
    const none=await fetch(`${base}/api/institutions?fundingScheme=funding_undefined-scheme`).then(r=>r.json());assert.equal(none.total,0);
    const mixed=await fetch(`${base}/api/institutions?fundingScheme=funding_helsinki-master-waiver&countryCode=DE`).then(r=>r.json());assert.equal(mixed.total,0);
});

test('imported programme provenance and unknown admissions/financial data survive the public payload',async()=>{
    const data=await fetch(`${base}/catalog.json`).then(r=>r.json());
    const imported=data.programs.filter(p=>p.verificationStatus==='official-directory');assert.ok(imported.length>=1600);
    assert.ok(imported.every(p=>p.provenance.sourceId==='daad-international-programmes'&&p.provenance.checkedAt&&p.institutionId));
    assert.ok(imported.every(p=>p.tuition.amount===null&&p.requirements.gpaMinPercent===null&&p.funding.fullFunding===null));
    assert.ok(data.programs.some(p=>p.id==='program_taltech-cybersecurity-msc'));
    assert.equal(data.metadata.programSources.sourceSnapshots['daad-international-programmes'].listingComplete,true);
    assert.equal(data.metadata.programCoverage.completeness,'partial');
});
