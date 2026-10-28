'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

let sequence = 0;
function registration(role = 'student', patch = {}) {
    const identity = ++sequence;
    const shared = {
        name:role === 'advisor' ? 'Advisor Example' : 'Student Example',
        email:`${role}${identity}@example.com`, phone:'+995555123456',
        password:'StudentPass123', passwordConfirm:'StudentPass123', role, termsAccepted:true
    };
    if (role === 'advisor') shared.advisorProfile = {
        organizationName:'Example Education', position:'Education Advisor',
        website:'https://example.org', bio:'Helping students choose international study programmes.', specialties:['tech','business']
    };
    else shared.studentProfile = {educationLevel:'bachelor',citizenshipCode:'GE',graduationYear:2027};
    return {...shared,...patch};
}
function cookieFrom(response) {
    const rows = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || ''];
    const row = rows.find(value=>/^globaledu_session=/i.test(value));
    return {header:row || '',value:row ? row.split(';',1)[0] : ''};
}
async function openServer(options = {}) {
    const {createAccountStore} = require('../Server/account-store');
    const {createAuthRouter} = require('../Server/auth');
    const store = createAccountStore({filename:options.filename || ':memory:'});
    const app = express(); app.use(express.json({limit:'64kb'}));
    app.use('/api',createAuthRouter({store,cookieSecure:false,rateLimitOptions:{windowMs:60000,max:1000},...options}));
    const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    async function request(route,{method='GET',body,cookie,headers={}} = {}) {
        const response=await fetch(`${base}/api${route}`,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
        const data=await response.json().catch(()=>null);
        return {response,status:response.status,data,cookie:cookieFrom(response)};
    }
    async function close() { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await store.close(); }
    return {store,base,request,close};
}
async function setup(t,options) { const context=await openServer(options);t.after(()=>context.close());return context; }
async function register(context,payload=registration()) {
    const result=await context.request('/auth/register',{method:'POST',body:payload});
    assert.equal(result.status,201,JSON.stringify(result.data));assert.ok(result.cookie.value,'registration must issue the real session cookie');
    return {...result,payload};
}
function noCredentials(value) {
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
        if(key==='fields'&&item&&typeof item==='object'){
            // Validation identifies the password field by name; it must not echo its submitted value.
            for(const message of Object.values(item))assert.equal(typeof message,'string');
            continue;
        }
        assert.ok(!/^(?:password|passwordHash|password_hash|token|sessionToken|tokenHash|token_hash|secret)$/i.test(key),`Private field leaked: ${key}`);
        noCredentials(item);
    }
}

test('auth status reports SQLite readiness without exposing database paths',async t=>{
    const app=await setup(t);const result=await app.request('/auth/status');
    assert.equal(result.status,200);assert.equal(result.data.provider,'sqlite');assert.equal(result.data.ready,true);
    assert.ok(!Object.keys(result.data).some(key=>/path|filename|secret/i.test(key)));noCredentials(result.data);
});

test('student registration persists the role, signs in automatically, and uses an HttpOnly same-site cookie',async t=>{
    const app=await setup(t);const created=await register(app);
    assert.equal(created.data.user.role,'student');assert.ok(created.data.user.id||created.data.user._id);
    assert.equal(created.data.user.email,created.payload.email);assert.equal(created.data.user.studentProfile.citizenshipCode,'GE');
    assert.match(created.cookie.header,/;\s*HttpOnly/i);assert.match(created.cookie.header,/;\s*SameSite=Lax/i);assert.match(created.cookie.header,/;\s*Path=\//i);
    noCredentials(created.data);
    const me=await app.request('/auth/me',{cookie:created.cookie.value});assert.equal(me.status,200);assert.equal(me.data.user.role,'student');assert.equal(me.data.user.email,created.payload.email);noCredentials(me.data);
});

test('advisor registration starts pending and keeps organization/profile data separate',async t=>{
    const app=await setup(t);const created=await register(app,registration('advisor'));
    assert.equal(created.data.user.role,'advisor');assert.equal(created.data.user.advisorProfile.organizationName,'Example Education');
    assert.equal(created.data.user.advisorProfile.verificationStatus,'pending');
    const profile=await app.request('/advisor/profile',{cookie:created.cookie.value});assert.equal(profile.status,200);assert.equal(profile.data.user.advisorProfile.verificationStatus,'pending');noCredentials(profile.data);
});

test('email uniqueness is canonicalized across case and surrounding whitespace',async t=>{
    const app=await setup(t);const payload=registration('student',{email:'Student.Case@Example.com'});
    const first=await register(app,payload);assert.equal(first.data.user.email,'student.case@example.com');
    const duplicate=await app.request('/auth/register',{method:'POST',body:registration('student',{email:'  STUDENT.CASE@example.com  '})});
    assert.equal(duplicate.status,409);
});

test('invalid registration fields never create an account or a session',async t=>{
    const app=await setup(t);
    for(const patch of [
        {name:'A'}, {email:'not-an-email'}, {email:'foo@bar@example.com'}, {phone:'123'}, {role:'admin'}, {termsAccepted:false},
        {password:'Short123',passwordConfirm:'Short123'},
        {password:'OnlyLettersPassword',passwordConfirm:'OnlyLettersPassword'},
        {password:'123456789012',passwordConfirm:'123456789012'},
        {passwordConfirm:'DifferentPass123'}
    ]){
        const result=await app.request('/auth/register',{method:'POST',body:registration('student',patch)});
        assert.equal(result.status,400,`Invalid payload was accepted: ${JSON.stringify(patch)}`);assert.equal(result.cookie.value,'');noCredentials(result.data);
    }
});

test('bcrypt password bounds use UTF-8 bytes and reject silent truncation',async t=>{
    const app=await setup(t);const password='ValidPass123'+'🌍'.repeat(20);
    assert.ok(Buffer.byteLength(password,'utf8')>72);
    const result=await app.request('/auth/register',{method:'POST',body:registration('student',{password,passwordConfirm:password})});
    assert.equal(result.status,400);assert.equal(result.cookie.value,'');
});

test('login validates credentials generically and restores the server-owned profile',async t=>{
    const app=await setup(t);const created=await register(app);
    const bad=await app.request('/auth/login',{method:'POST',body:{email:created.payload.email,password:'WrongPass123'}});
    const unknown=await app.request('/auth/login',{method:'POST',body:{email:'nobody@example.com',password:'WrongPass123'}});
    assert.equal(bad.status,401);assert.equal(unknown.status,401);assert.equal(bad.data.message,unknown.data.message);
    const good=await app.request('/auth/login',{method:'POST',body:{email:`  ${created.payload.email.toUpperCase()}  `,password:created.payload.password,rememberMe:false}});
    assert.equal(good.status,200);assert.ok(good.cookie.value);assert.equal(good.data.user.role,'student');assert.equal(good.data.user.email,created.payload.email);noCredentials(good.data);
});

test('missing, malformed and tampered sessions cannot access an account',async t=>{
    const app=await setup(t);const created=await register(app);
    for(const cookie of ['', 'globaledu_session=not-a-real-session', `${created.cookie.value}changed`]){
        const result=await app.request('/auth/me',{cookie});assert.equal(result.status,401);
    }
    assert.equal((await app.request('/user/profile')).status,401);
});

test('logout revokes the persisted session and clears its cookie',async t=>{
    const app=await setup(t);const created=await register(app);
    const loggedOut=await app.request('/auth/logout',{method:'POST',cookie:created.cookie.value});assert.equal(loggedOut.status,200);
    assert.match(loggedOut.cookie.header,/globaledu_session=/i);assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970|Expires=Thu, 01 Jan 1970/i.test(loggedOut.cookie.header));
    assert.equal((await app.request('/auth/me',{cookie:created.cookie.value})).status,401);
});

test('student and advisor routes enforce the stored role',async t=>{
    const app=await setup(t);const student=await register(app);const advisor=await register(app,registration('advisor'));
    assert.equal((await app.request('/student/profile',{cookie:student.cookie.value})).status,200);
    assert.equal((await app.request('/advisor/profile',{cookie:student.cookie.value})).status,403);
    assert.equal((await app.request('/student/profile',{cookie:advisor.cookie.value})).status,403);
    assert.equal((await app.request('/advisor/profile',{method:'PUT',cookie:student.cookie.value,body:{advisorProfile:{organizationName:'Unauthorized'}}})).status,403);
    assert.equal((await app.request('/student/profile',{method:'PUT',cookie:advisor.cookie.value,body:{studentProfile:{graduationYear:2028}}})).status,403);
});

test('common profile updates preserve favorites and update only the current owner',async t=>{
    const app=await setup(t);const owner=await register(app);const another=await register(app);
    const favorites=['inst_65a4535618e945e7a8fcdec3','program_saarland-computer-science-msc'];
    const saved=await app.request('/user/profile',{method:'PUT',cookie:owner.cookie.value,body:{name:'Updated Student',phone:'+995555987654',favorites,studentProfile:{educationLevel:'master',citizenshipCode:'GE',graduationYear:2028}}});
    assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.user.name,'Updated Student');assert.deepEqual(saved.data.user.favorites,favorites);
    assert.equal(saved.data.user.studentProfile.graduationYear,2028);
    const own=await app.request('/student/profile',{cookie:owner.cookie.value});assert.equal(own.data.user.name,'Updated Student');
    const other=await app.request('/user/profile',{cookie:another.cookie.value});assert.equal(other.data.user.name,another.payload.name);assert.notDeepEqual(other.data.user.favorites,favorites);
});

test('role profiles update through nested allowlisted data',async t=>{
    const app=await setup(t);const student=await register(app);const advisor=await register(app,registration('advisor'));
    const studentSaved=await app.request('/student/profile',{method:'PUT',cookie:student.cookie.value,body:{studentProfile:{educationLevel:'master',citizenshipCode:'GE',graduationYear:2029}}});
    assert.equal(studentSaved.status,200);assert.equal(studentSaved.data.user.studentProfile.graduationYear,2029);
    const advisorSaved=await app.request('/advisor/profile',{method:'PUT',cookie:advisor.cookie.value,body:{advisorProfile:{organizationName:'Updated Education',position:'Senior Advisor',website:'https://example.org/advising',bio:'Student guidance and application support.',specialties:['tech']}}});
    assert.equal(advisorSaved.status,200);assert.equal(advisorSaved.data.user.advisorProfile.organizationName,'Updated Education');assert.equal(advisorSaved.data.user.advisorProfile.verificationStatus,'pending');
});

test('favorites are bounded and invalid role-profile data cannot overwrite a valid profile',async t=>{
    const app=await setup(t);const created=await register(app);
    const overLimit=await app.request('/user/profile',{method:'PUT',cookie:created.cookie.value,body:{favorites:Array.from({length:201},(_,i)=>`inst_${i}`)}});assert.equal(overLimit.status,400);
    const invalidYear=await app.request('/student/profile',{method:'PUT',cookie:created.cookie.value,body:{studentProfile:{graduationYear:'next year'}}});assert.equal(invalidYear.status,400);
    const invalidCountry=await app.request('/student/profile',{method:'PUT',cookie:created.cookie.value,body:{studentProfile:{citizenshipCode:'not-a-country'}}});assert.equal(invalidCountry.status,400);
    const profile=await app.request('/auth/me',{cookie:created.cookie.value});assert.deepEqual(profile.data.user.favorites,[]);assert.equal(profile.data.user.studentProfile.graduationYear,2027);
});

test('profile mass assignment cannot change role, verification, identity, or credentials',async t=>{
    const app=await setup(t);const student=await register(app);const advisor=await register(app,registration('advisor'));
    for(const body of [{role:'advisor'},{id:advisor.data.user.id||advisor.data.user._id},{passwordHash:'fake-hash'},{verificationStatus:'verified'},{email:'changed@example.com'},{advisorProfile:{verificationStatus:'verified'}}]){
        const result=await app.request('/user/profile',{method:'PUT',cookie:student.cookie.value,body});assert.equal(result.status,400,JSON.stringify(body));
    }
    const elevated=await app.request('/advisor/profile',{method:'PUT',cookie:advisor.cookie.value,body:{advisorProfile:{verificationStatus:'verified',organizationName:'Verified Myself'}}});assert.equal(elevated.status,400);
    const me=await app.request('/auth/me',{cookie:student.cookie.value});assert.equal(me.data.user.role,'student');assert.equal(me.data.user.email,student.payload.email);
});

test('foreign origins cannot mutate account state even when a cookie is supplied',async t=>{
    const app=await setup(t);const created=await register(app);
    const foreign=await app.request('/user/profile',{method:'PUT',cookie:created.cookie.value,headers:{Origin:'https://untrusted.example'},body:{name:'Cross Site Change'}});assert.equal(foreign.status,403);
    const foreignLogin=await app.request('/auth/login',{method:'POST',headers:{Origin:'https://untrusted.example'},body:{email:created.payload.email,password:created.payload.password}});assert.equal(foreignLogin.status,403);
    const same=await app.request('/user/profile',{method:'PUT',cookie:created.cookie.value,headers:{Origin:app.base},body:{name:'Same Origin Change'}});assert.equal(same.status,200);
});

test('the login rate limit returns 429 with a retry hint',async t=>{
    const app=await setup(t,{rateLimitOptions:{windowMs:60000,max:2}});const attempts=[];
    for(let index=0;index<4;index++)attempts.push(await app.request('/auth/login',{method:'POST',body:{email:'nobody@example.com',password:'WrongPass123'}}));
    const limited=attempts.find(result=>result.status===429);assert.ok(limited,'repeated authentication attempts should be limited');assert.ok(Number(limited.response.headers.get('retry-after'))>0);
});

test('case variations of the same Express login route cannot bypass its rate limit',async t=>{
    const app=await setup(t,{rateLimitOptions:{windowMs:60000,max:2}});const attempts=[];
    for(const route of ['/auth/login','/AUTH/LOGIN','/auth/Login','/AUTH/Login'])attempts.push(await app.request(route,{method:'POST',body:{email:'nobody@example.com',password:'WrongPass123'}}));
    assert.equal(attempts[0].status,401);assert.equal(attempts[1].status,401);assert.equal(attempts[2].status,429);assert.equal(attempts[3].status,429);
});

test('suspended accounts cannot obtain a login session despite a correct password',async t=>{
    const app=await setup(t);const bcrypt=require('bcryptjs');const payload=registration();
    app.store.createUser({id:'suspended-test-user',name:payload.name,email:payload.email,phone:payload.phone,passwordHash:await bcrypt.hash(payload.password,4),role:'student',studentProfile:payload.studentProfile,advisorProfile:null,favorites:[],accountStatus:'suspended'});
    const result=await app.request('/auth/login',{method:'POST',body:{email:payload.email,password:payload.password}});
    assert.equal(result.status,401);assert.equal(result.cookie.value,'');noCredentials(result.data);
});

test('session expiry and remembered expiry are enforced by the server clock',async t=>{
    let now=Date.now();const app=await setup(t,{clock:()=>now});const created=await register(app);
    now+=13*60*60*1000;assert.equal((await app.request('/auth/me',{cookie:created.cookie.value})).status,401);
    const remembered=await app.request('/auth/login',{method:'POST',body:{email:created.payload.email,password:created.payload.password,rememberMe:true}});assert.equal(remembered.status,200);
    now+=13*60*60*1000;assert.equal((await app.request('/auth/me',{cookie:remembered.cookie.value})).status,200);
    now+=31*24*60*60*1000;assert.equal((await app.request('/auth/me',{cookie:remembered.cookie.value})).status,401);
});

test('real SQLite accounts and sessions survive closing and reopening the store',async t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'globaledu-auth-test-'));
    const filename=path.join(directory,'accounts.sqlite');
    t.after(()=>{
        const resolved=path.resolve(directory),parent=path.resolve(os.tmpdir());
        assert.equal(path.dirname(resolved),parent);assert.ok(path.basename(resolved).startsWith('globaledu-auth-test-'));
        fs.rmSync(resolved,{recursive:true,force:true});
    });
    const first=await openServer({filename});let created;
    try{created=await register(first);}finally{await first.close();}
    const reopened=await openServer({filename});
    try{
        const restored=await reopened.request('/auth/me',{cookie:created.cookie.value});assert.equal(restored.status,200);assert.equal(restored.data.user.email,created.payload.email);
        const login=await reopened.request('/auth/login',{method:'POST',body:{email:created.payload.email,password:created.payload.password}});assert.equal(login.status,200);noCredentials(login.data);
    }finally{await reopened.close();}
});
