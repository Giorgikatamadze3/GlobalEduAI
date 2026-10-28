'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const {createHash} = require('node:crypto');
const express = require('express');
const {createAccountStore} = require('../Server/account-store');
const {createAuthRouter} = require('../Server/auth');

let sequence = 0;
function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise,resolve};
}
function registration(role = 'student',patch = {}) {
    const payload = {
        name:role === 'student' ? 'Async Student' : 'Async Advisor',
        email:`async-${role}-${++sequence}@example.com`,phone:'+995555123456',
        password:'StudentPass123',passwordConfirm:'StudentPass123',role,termsAccepted:true
    };
    if (role === 'student') payload.studentProfile = {educationLevel:'bachelor',citizenshipCode:'GE',graduationYear:2027};
    else payload.advisorProfile = {organizationName:'Async Education',position:'Student Advisor',website:'https://example.org',bio:'Application guidance.',specialties:['tech']};
    return {...payload,...patch};
}
function cookieFrom(response) {
    const rows = response.headers.getSetCookie();
    return (rows.find(row => row.startsWith('globaledu_session=')) || '').split(';',1)[0];
}
function sessionHash(cookie) {
    return createHash('sha256').update(cookie.slice('globaledu_session='.length)).digest('hex');
}

// Execute the real SQLite repository after an asynchronous boundary. The router
// must work with promises without replacing persistence with canned mock users.
function asyncRepository() {
    const sqlite = createAccountStore({filename:':memory:'});
    const holds = new Map();
    const completed = [];
    const store = {info:Object.freeze({...sqlite.info,provider:'postgres'})};
    for (const [name,method] of Object.entries(sqlite)) {
        if (typeof method !== 'function') continue;
        store[name] = async (...args) => {
            await Promise.resolve();
            const hold = holds.get(name);
            if (hold) {
                holds.delete(name);
                hold.entered.resolve();
                await hold.released.promise;
            }
            const result = method.apply(sqlite,args);
            completed.push(name);
            return result;
        };
    }
    store.ready = async () => {
        await Promise.resolve();
        const hold = holds.get('ready');
        if (hold) {
            holds.delete('ready');hold.entered.resolve();await hold.released.promise;
        }
        completed.push('ready');
        return true;
    };
    const allHolds = [];
    function holdNext(name) {
        assert.ok(typeof store[name] === 'function');
        const hold = {entered:deferred(),released:deferred()};
        holds.set(name,hold);allHolds.push(hold);
        return {entered:hold.entered.promise,release:() => hold.released.resolve()};
    }
    return {store,sqlite,completed,holdNext,releaseAll:() => allHolds.forEach(hold => hold.released.resolve())};
}
async function setup(t,{clock = () => Date.now()} = {}) {
    const repository = asyncRepository();
    const app = express();
    app.use(express.json({limit:'64kb'}));
    app.use('/api',createAuthRouter({store:repository.store,cookieSecure:false,clock,rateLimitOptions:{windowMs:60000,max:1000}}));
    const server = app.listen(0,'127.0.0.1');
    await once(server,'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    t.after(async () => {
        repository.releaseAll();server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await repository.store.close();
    });
    async function request(route,{method = 'GET',body,cookie} = {}) {
        const response = await fetch(`${base}${route}`,{
            method,signal:AbortSignal.timeout(15000),
            headers:{...(body === undefined ? {} : {'Content-Type':'application/json'}),...(cookie ? {Cookie:cookie} : {})},
            ...(body === undefined ? {} : {body:JSON.stringify(body)})
        });
        return {status:response.status,data:await response.json(),cookie:cookieFrom(response),response};
    }
    async function register(payload = registration()) {
        const result = await request('/auth/register',{method:'POST',body:payload});
        assert.equal(result.status,201,JSON.stringify(result.data));
        assert.match(result.cookie,/^globaledu_session=[a-f0-9]{64}$/);
        return {...result,payload};
    }
    return {...repository,request,register};
}
async function assertStillPending(promise) {
    let settled = false;
    promise.then(() => { settled = true; },() => { settled = true; });
    await new Promise(resolve => setTimeout(resolve,30));
    assert.equal(settled,false,'HTTP success must wait for the repository operation to finish');
}
async function waitForHeldOperation(hold,pending) {
    await Promise.race([
        hold.entered,
        pending.then(() => { throw new Error('The route responded without calling the asynchronous repository operation'); })
    ]);
}

test('async repository status reports its actual provider after readiness resolves',async t => {
    const app = await setup(t);
    const hold = app.holdNext('ready');
    const pending = app.request('/auth/status');
    await waitForHeldOperation(hold,pending);
    try { await assertStillPending(pending); } finally { hold.release(); }
    const result = await pending;
    assert.equal(result.status,200);assert.equal(result.data.provider,'postgres');assert.equal(result.data.ready,true);
    assert.ok(!Object.keys(result.data).some(key => /path|filename|connection|password/i.test(key)));
});

test('rejected async database readiness reports unavailable without leaking credentials or creating users',async t => {
    const app = await setup(t);
    const sensitive = 'postgresql://private-user:private-password@database.invalid/accounts';
    app.store.ready = async () => { await Promise.resolve();throw new Error(sensitive); };
    const status = await app.request('/auth/status');
    assert.equal(status.status,503);assert.equal(status.data.provider,'postgres');assert.equal(status.data.ready,false);
    const payload = registration();
    const created = await app.request('/auth/register',{method:'POST',body:payload});
    assert.equal(created.status,503);assert.equal(created.cookie,'');assert.equal(created.data.code,'AUTH_DATABASE_UNAVAILABLE');
    assert.equal(app.sqlite.findByEmail(payload.email),null);
    for (const result of [status,created]) {
        assert.doesNotMatch(JSON.stringify(result.data),/private-user|private-password|database\.invalid|postgresql:\/\//);
    }
});

test('async registration commits the user and hashed session before issuing a usable cookie',async t => {
    const app = await setup(t);
    const hold = app.holdNext('createSession');
    const payload = registration();
    const pending = app.request('/auth/register',{method:'POST',body:payload});
    await waitForHeldOperation(hold,pending);
    try { await assertStillPending(pending); } finally { hold.release(); }
    const created = await pending;
    assert.equal(created.status,201,JSON.stringify(created.data));
    assert.equal(created.data.user.role,'student');assert.equal(created.data.user.email,payload.email);
    assert.match(created.cookie,/^globaledu_session=[a-f0-9]{64}$/);
    assert.equal(created.data.token,undefined);assert.equal(created.data.user.passwordHash,undefined);
    const persisted = app.sqlite.findByEmail(payload.email);
    assert.notEqual(persisted.passwordHash,payload.password);assert.match(persisted.passwordHash,/^\$2[aby]\$/);
    assert.equal(app.sqlite.findSession(sessionHash(created.cookie)).userId,persisted.id);
    const me = await app.request('/auth/me',{cookie:created.cookie});
    assert.equal(me.status,200);assert.equal(me.data.user.id,persisted.id);
    assert.ok(app.completed.includes('createUser'));assert.ok(app.completed.includes('pruneSessions'));
    assert.ok(app.completed.includes('findSession'));assert.ok(app.completed.includes('findById'));
});

test('async login awaits credential lookup, rotates the previous session, and preserves canonical email uniqueness',async t => {
    const app = await setup(t);
    const created = await app.register();
    const duplicate = await app.request('/auth/register',{method:'POST',body:registration('student',{email:`  ${created.payload.email.toUpperCase()}  `})});
    assert.equal(duplicate.status,409);
    const incorrect = await app.request('/auth/login',{method:'POST',body:{email:created.payload.email,password:'WrongPassword123'}});
    assert.equal(incorrect.status,401);assert.equal(incorrect.cookie,'');
    const login = await app.request('/auth/login',{method:'POST',cookie:created.cookie,body:{email:created.payload.email.toUpperCase(),password:created.payload.password,rememberMe:true}});
    assert.equal(login.status,200,JSON.stringify(login.data));assert.notEqual(login.cookie,created.cookie);
    assert.equal(login.data.user.id,created.data.user.id);assert.equal(login.data.user.passwordHash,undefined);
    assert.equal((await app.request('/auth/me',{cookie:created.cookie})).status,401);
    assert.equal((await app.request('/auth/me',{cookie:login.cookie})).status,200);
    assert.ok(login.response.headers.getSetCookie().some(row => /Max-Age=2592000/.test(row)));
});

test('concurrent async registrations cannot create two accounts for one canonical email',async t => {
    const app = await setup(t);
    const payload = registration();
    const attempts = await Promise.all([
        app.request('/auth/register',{method:'POST',body:payload}),
        app.request('/auth/register',{method:'POST',body:registration('advisor',{email:payload.email.toUpperCase()})})
    ]);
    assert.deepEqual(attempts.map(result => result.status).sort(),[201,409]);
    const accepted = attempts.find(result => result.status === 201);
    const duplicate = attempts.find(result => result.status === 409);
    assert.equal(duplicate.cookie,'');assert.equal(duplicate.data.user,undefined);
    assert.equal(app.sqlite.findByEmail(payload.email).id,accepted.data.user.id);
    assert.equal((await app.request('/auth/me',{cookie:accepted.cookie})).status,200);
});

test('async profile updates return persisted owner data and enforce server-owned roles',async t => {
    const app = await setup(t);
    const student = await app.register();
    const advisor = await app.register(registration('advisor'));
    const hold = app.holdNext('updateUser');
    const pending = app.request('/user/profile',{method:'PUT',cookie:student.cookie,body:{name:'Saved Async Student',favorites:['program_saarland-computer-science-msc'],studentProfile:{graduationYear:2029}}});
    await waitForHeldOperation(hold,pending);
    try { await assertStillPending(pending); } finally { hold.release(); }
    const saved = await pending;
    assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.user.name,'Saved Async Student');
    assert.equal(saved.data.user.studentProfile.graduationYear,2029);
    assert.deepEqual(saved.data.user.favorites,['program_saarland-computer-science-msc']);
    const restored = await app.request('/student/profile',{cookie:student.cookie});
    assert.deepEqual(restored.data.user,saved.data.user);
    assert.equal((await app.request('/advisor/profile',{cookie:student.cookie})).status,403);
    assert.equal((await app.request('/student/profile',{cookie:advisor.cookie})).status,403);
    const advisorSaved = await app.request('/advisor/profile',{method:'PUT',cookie:advisor.cookie,body:{advisorProfile:{organizationName:'Persisted Async Education',specialties:['business']}}});
    assert.equal(advisorSaved.status,200);assert.equal(advisorSaved.data.user.advisorProfile.organizationName,'Persisted Async Education');
    assert.equal(advisorSaved.data.user.advisorProfile.verificationStatus,'pending');
    const elevated = await app.request('/advisor/profile',{method:'PUT',cookie:advisor.cookie,body:{advisorProfile:{verificationStatus:'verified'}}});
    assert.equal(elevated.status,400);
    const unchanged = await app.request('/advisor/profile',{cookie:advisor.cookie});
    assert.equal(unchanged.data.user.name,advisor.payload.name);assert.equal(unchanged.data.user.role,'advisor');
    assert.equal(app.sqlite.findById(student.data.user.id).name,'Saved Async Student');
});

test('async logout waits for persisted revocation before returning success',async t => {
    const app = await setup(t);
    const created = await app.register();
    const hold = app.holdNext('deleteSession');
    const pending = app.request('/auth/logout',{method:'POST',cookie:created.cookie});
    await waitForHeldOperation(hold,pending);
    assert.ok(app.sqlite.findSession(sessionHash(created.cookie)));
    try { await assertStillPending(pending); } finally { hold.release(); }
    const result = await pending;
    assert.equal(result.status,200);assert.equal(app.sqlite.findSession(sessionHash(created.cookie)),null);
    assert.equal((await app.request('/auth/me',{cookie:created.cookie})).status,401);
    assert.ok(result.response.headers.getSetCookie().some(row => /Expires=Thu, 01 Jan 1970/.test(row)));
});

test('async session reads enforce normal and remembered expiry using the server clock',async t => {
    let now = Date.now();
    const app = await setup(t,{clock:() => now});
    const created = await app.register();
    now += 12 * 3600000 + 1;
    assert.equal((await app.request('/auth/me',{cookie:created.cookie})).status,401);
    const login = await app.request('/auth/login',{method:'POST',body:{email:created.payload.email,password:created.payload.password,rememberMe:true}});
    assert.equal(login.status,200);
    now += 29 * 86400000;
    assert.equal((await app.request('/auth/me',{cookie:login.cookie})).status,200);
    now += 86400000 + 1;
    assert.equal((await app.request('/auth/me',{cookie:login.cookie})).status,401);
});
