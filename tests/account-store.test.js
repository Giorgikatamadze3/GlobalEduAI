'use strict';

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Worker } = require('node:worker_threads');
const { createAccountStore } = require('../Server/account-store');
const temporaryDirectories = new Set();
after(() => {
    const temporaryRoot = path.resolve(os.tmpdir());
    for (const directory of temporaryDirectories) {
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), temporaryRoot);
        assert(path.basename(resolved).startsWith('globaledu-account-store-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});

const stamp = '2026-10-27T09:00:00.000Z';
const expires = '2026-11-03T09:00:00.000Z';
const digest = value => createHash('sha256').update(value).digest('hex');
function user(overrides = {}) {
    return {id:randomUUID(),name:'ანა მაისურაძე',email:`student-${randomUUID()}@example.com`,phone:'+995555123456',passwordHash:'$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345',role:'student',studentProfile:{educationLevel:'bachelor',citizenshipCode:'GE',graduationYear:2026},favorites:['inst_sample'],createdAt:stamp,updatedAt:stamp,...overrides};
}
function tempDatabase(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globaledu-account-store-'));
    temporaryDirectories.add(directory);
    return path.join(directory,'nested','accounts.sqlite');
}
function memory(t) { const store = createAccountStore({filename:':memory:'}); t.after(() => store.close()); return store; }

test('accounts persist across store reopen with profile JSON and consent audit fields', t => {
    const filename = tempDatabase(t);
    const input = user({email:'  Anna@Example.COM  ',termsAcceptedAt:stamp,termsVersion:'2026-10-27'});
    const first = createAccountStore({filename});
    const created = first.createUser(input);
    assert.equal(created.email,'anna@example.com');
    assert.equal(created.termsAcceptedAt,stamp); assert.equal(created.termsVersion,'2026-10-27');
    assert.equal(created.accountStatus,'active');
    assert.equal(created.advisorProfile,null);
    first.close();
    const second = createAccountStore({filename}); t.after(() => second.close());
    assert.deepEqual(second.findById(input.id),created);
    assert.deepEqual(second.findByEmail('ANNA@EXAMPLE.COM'),created);
    assert.deepEqual(second.info,{provider:'sqlite',persistent:true,schemaVersion:1});
    assert.equal(second.info.filename,undefined);
});

test('normalized email uniqueness is enforced across independent database connections', t => {
    const filename = tempDatabase(t);
    const first = createAccountStore({filename}); const second = createAccountStore({filename});
    t.after(() => {first.close();second.close();});
    first.createUser(user({email:' Duplicate@Example.COM '}));
    assert.throws(() => second.createUser(user({email:'duplicate@example.com'})),{code:'EMAIL_EXISTS'});
    assert.equal(second.findByEmail(' duplicate@example.com ').email,'duplicate@example.com');
    const reader = new DatabaseSync(filename); t.after(() => reader.close());
    assert.equal(reader.prepare('SELECT count(*) count FROM users').get().count,1);
});

test('simultaneous signup attempts produce one user and one EMAIL_EXISTS result', {timeout:10000}, async t => {
    const filename = tempDatabase(t);
    const setup = createAccountStore({filename}); setup.close();
    const gate = new SharedArrayBuffer(4);
    let ready = 0;
    const workers = [];
    const results = await Promise.all([' race@example.com ','RACE@EXAMPLE.COM'].map(email => new Promise((resolve,reject) => {
        const worker = new Worker(`
            const { parentPort, workerData } = require('node:worker_threads');
            const { createAccountStore } = require(workerData.module);
            let store;
            try {
                store = createAccountStore({filename:workerData.filename});
                parentPort.postMessage({type:'ready'});
                Atomics.wait(new Int32Array(workerData.gate),0,0);
                let result;
                try { result={status:'created',id:store.createUser(workerData.user).id}; }
                catch(error) { result={status:'error',code:error.code}; }
                store.close();store=null;
                parentPort.postMessage({type:'result',result});
            } finally { if(store)store.close(); }
        `, {eval:true,workerData:{module:path.resolve(__dirname,'../Server/account-store.js'),filename,gate,user:user({email})}});
        workers.push(worker);
        worker.on('message', message => {
            if(message.type==='ready' && ++ready===2) { Atomics.store(new Int32Array(gate),0,1);Atomics.notify(new Int32Array(gate),0,2); }
            if(message.type==='result') resolve(message.result);
        });
        worker.on('error',reject);
        worker.on('exit',code => { if(code!==0)reject(new Error(`Worker exited ${code}`)); });
    })));
    t.after(async () => {await Promise.all(workers.map(worker=>worker.terminate()));});
    assert.equal(results.filter(result=>result.status==='created').length,1);
    assert.equal(results.filter(result=>result.code==='EMAIL_EXISTS').length,1);
    const reopened=createAccountStore({filename});t.after(()=>reopened.close());
    assert.equal(reopened.findByEmail('race@example.com').email,'race@example.com');
});

test('invalid roles are rejected by repository and database CHECK constraint', t => {
    const filename = tempDatabase(t); const store = createAccountStore({filename}); t.after(() => store.close());
    assert.throws(() => store.createUser(user({role:'admin'})),{code:'INVALID_ROLE'});
    const valid = store.createUser(user());
    const raw = new DatabaseSync(filename); t.after(() => raw.close());
    assert.throws(() => raw.prepare('UPDATE users SET role = ? WHERE id = ?').run('admin',valid.id),/CHECK constraint failed/);
    assert.equal(store.findById(valid.id).role,'student');
});

test('profile updates preserve immutable credentials, role, status and consent', t => {
    const store = memory(t); const created = store.createUser(user({termsAcceptedAt:stamp,termsVersion:'2026-10-27'}));
    for (const patch of [{role:'advisor'},{passwordHash:'new-hash'},{email:'new@example.com'},{accountStatus:'suspended'},{termsVersion:'forged'},{unknown:true}]) assert.throws(() => store.updateUser(created.id,patch),{code:'INVALID_UPDATE'});
    const updated = store.updateUser(created.id,{name:'ნინო მაისურაძე',phone:'+995555000000',studentProfile:{educationLevel:'master'},favorites:['p1','p1','p2']});
    assert.equal(updated.role,'student'); assert.equal(updated.email,created.email); assert.equal(updated.passwordHash,created.passwordHash);
    assert.equal(updated.termsAcceptedAt,stamp); assert.equal(updated.termsVersion,'2026-10-27');
    assert.equal(updated.studentProfile.citizenshipCode,'GE'); assert.equal(updated.studentProfile.educationLevel,'master');
    assert.deepEqual(updated.favorites,['p1','p2']);
});

test('advisor profiles default to pending and cannot grant their own verification', t => {
    const store = memory(t);
    const created = store.createUser(user({role:'advisor',studentProfile:null,advisorProfile:{organizationName:'Example Agency',position:'Consultant',website:'https://example.com',bio:'Profile',specialties:['Germany','Scholarships']}}));
    assert.equal(created.advisorProfile.verificationStatus,'pending');
    assert.equal(created.studentProfile,null);
    assert.throws(() => store.updateUser(created.id,{advisorProfile:{verificationStatus:'verified'}}),{code:'INVALID_INPUT'});
    assert.throws(() => store.updateUser(created.id,{advisorProfile:{website:'javascript:alert(1)'}}),{code:'INVALID_INPUT'});
    assert.equal(store.findById(created.id).advisorProfile.verificationStatus,'pending');
});

test('returned records are isolated copies and another user profile remains unchanged', t => {
    const store = memory(t); const first = store.createUser(user()); const second = store.createUser(user({name:'Other Student',studentProfile:{educationLevel:'school',citizenshipCode:'US',graduationYear:2027},favorites:['other']}));
    first.studentProfile.citizenshipCode='FR'; first.favorites.push('forged');
    store.updateUser(first.id,{studentProfile:{graduationYear:2028},favorites:['one']});
    assert.equal(store.findById(first.id).studentProfile.citizenshipCode,'GE');
    assert.deepEqual(store.findById(second.id),second);
    assert.equal(store.findById('missing'),null); assert.equal(store.findByEmail('missing@example.com'),null);
    assert.equal(store.updateUser('missing',{name:'No match'}),null);
});

test('sessions store only digests, persist across restart and expire at the exact boundary', t => {
    const filename = tempDatabase(t); let store = createAccountStore({filename});
    const created = store.createUser(user()); const rawToken='a-secret-opaque-session-token'; const idHash=digest(rawToken);
    assert.throws(() => store.createSession({idHash:rawToken,userId:created.id,createdAt:stamp,expiresAt:expires}),{code:'INVALID_SESSION_HASH'});
    store.createSession({idHash,userId:created.id,createdAt:stamp,expiresAt:expires});store.close();
    store=createAccountStore({filename});t.after(() => store.close());
    const active=store.findSession(idHash,'2026-11-03T08:59:59.999Z');
    assert.equal(active.userId,created.id);assert.equal(active.idHash,idHash);assert.equal(active.token,undefined);
    assert.equal(store.findSession(idHash,expires),null);assert.equal(store.findSession(idHash,'2026-12-01T00:00:00.000Z'),null);
    const raw=new DatabaseSync(filename);t.after(() => raw.close());
    assert.deepEqual(raw.prepare('PRAGMA table_info(sessions)').all().map(column=>column.name),['id_hash','user_id','expires_at','created_at']);
    assert.equal(JSON.stringify(raw.prepare('SELECT * FROM sessions').all()).includes(rawToken),false);
    assert.equal(store.pruneSessions(expires),1);assert.equal(store.pruneSessions(expires),0);
});

test('session deletion is scoped by user and foreign keys cascade on user removal', t => {
    const filename=tempDatabase(t);const store=createAccountStore({filename});t.after(()=>store.close());
    const first=store.createUser(user());const second=store.createUser(user());
    const one=digest('one'),two=digest('two'),other=digest('other');
    for(const [idHash,userId] of [[one,first.id],[two,first.id],[other,second.id]])store.createSession({idHash,userId,createdAt:stamp,expiresAt:expires});
    assert.equal(store.deleteSession(one),true);assert.equal(store.deleteSession(one),false);
    assert.equal(store.deleteUserSessions(first.id),1);assert.equal(store.findSession(two,stamp),null);assert.equal(store.findSession(other,stamp).userId,second.id);
    const raw=new DatabaseSync(filename);t.after(()=>raw.close());raw.exec('PRAGMA foreign_keys=ON');
    raw.prepare('DELETE FROM users WHERE id=?').run(second.id);
    assert.equal(raw.prepare('SELECT count(*) count FROM sessions').get().count,0);
    assert.throws(()=>store.createSession({idHash:digest('missing'),userId:randomUUID(),createdAt:stamp,expiresAt:expires}),{code:'USER_NOT_FOUND'});
});

test('session dates canonicalize offsets and reject expired intervals', t => {
    const store=memory(t);const created=store.createUser(user());
    const hash=digest('offset');
    const session=store.createSession({idHash:hash,userId:created.id,createdAt:'2026-10-27T13:00:00+04:00',expiresAt:'2026-10-27T15:00:00+04:00'});
    assert.equal(session.createdAt,'2026-10-27T09:00:00.000Z');
    assert.equal(store.findSession(hash,'2026-10-27T14:59:59+04:00').userId,created.id);
    assert.equal(store.findSession(hash,'2026-10-27T15:00:00+04:00'),null);
    assert.throws(()=>store.createSession({idHash:digest('bad'),userId:created.id,createdAt:expires,expiresAt:stamp}),{code:'INVALID_SESSION_EXPIRY'});
    assert.equal(store.findSession('raw-token',stamp),null);
});

test('schema migration version, WAL and database constraints persist on disk', t => {
    const filename=tempDatabase(t);const store=createAccountStore({filename});t.after(()=>store.close());
    const raw=new DatabaseSync(filename);t.after(()=>raw.close());
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version,1);
    assert.equal(raw.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
    assert(raw.prepare('PRAGMA index_list(users)').all().some(index=>index.unique===1));
    assert.equal(store.info.persistent,true);
});
