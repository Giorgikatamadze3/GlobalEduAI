'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { newDb, DataType } = require('pg-mem');
const { createPostgresAccountStore, connectionOptions } = require('../Server/postgres-account-store');
const { createAccountStore } = require('../Server/account-store');
const { migrateAccounts, optionsFromArgs } = require('../scripts/migrate-accounts-postgres');

const stamp = '2026-10-27T09:00:00.000Z';
const expiry = '2026-11-03T09:00:00.000Z';
const digest = value => createHash('sha256').update(value).digest('hex');
const user = (overrides = {}) => ({ id: randomUUID(), name: 'Test Student', email: `${randomUUID()}@example.com`, phone: '+995555123456', passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ12345', role: 'student', studentProfile: { educationLevel: 'bachelor', citizenshipCode: 'GE', graduationYear: 2026 }, favorites: ['inst_sample'], createdAt: stamp, updatedAt: stamp, ...overrides });

function database() {
    // pg-mem skips rechecking CREATE TABLE IF NOT EXISTS definitions when present.
    const db = newDb({ noAstCoverageCheck: true });
    // Register real Postgres built-ins missing from pg-mem. Production SQL stays unchanged.
    db.public.registerFunction({ name: 'pg_advisory_xact_lock', args: [DataType.integer], returns: DataType.integer, implementation: () => 1, impure: true });
    db.public.registerFunction({ name: 'length', args: [DataType.text], returns: DataType.integer, implementation: value => [...value].length });
    db.public.registerFunction({ name: 'trim', args: [DataType.text], returns: DataType.text, implementation: value => value.trim() });
    db.public.registerFunction({ name: 'jsonb_typeof', args: [DataType.jsonb], returns: DataType.text, allowNullArguments: true, implementation: value => value === null || typeof value === 'symbol' ? 'null' : Array.isArray(value) ? 'array' : typeof value });
    db.public.registerOperator({ operator: '~', left: DataType.text, right: DataType.text, returns: DataType.bool, implementation: (value, pattern) => new RegExp(pattern).test(value) });
    const { Pool } = db.adapters.createPg();
    return { db, newPool: () => {
        const pool = new Pool();
        const query = pool.query.bind(pool);
        // pg-mem enforces constraints, but omits pg's structured constraint field
        // (and mislabels every unique index as a primary key in its message).
        pool.query = async (...args) => {
            try { return await query(...args); }
            catch (error) {
                if (error.code === '23505') {
                    if (/Key \(email\)=/.test(error.message)) error.constraint = 'globaledu_users_email_key';
                    else if (/Key \(id\)=/.test(error.message)) error.constraint = 'globaledu_users_pkey';
                    else if (/Key \(id_hash\)=/.test(error.message)) error.constraint = 'globaledu_sessions_pkey';
                }
                if (/violates foreign key constraint on table "globaledu_sessions_user_id_fkey"/.test(error.message)) {
                    error.code = '23503'; error.constraint = 'globaledu_sessions_user_id_fkey';
                }
                throw error;
            }
        };
        return pool;
    } };
}
function setup(t) {
    const context = database();
    const pool = context.newPool();
    const store = createPostgresAccountStore({ pool });
    t.after(() => store.close());
    return { ...context, pool, store };
}

test('Postgres schema initializes lazily, is versioned and survives independent pool reopening', async t => {
    const { db, newPool } = database();
    const first = createPostgresAccountStore({ pool: newPool() });
    assert.deepEqual(db.public.many('SELECT table_name FROM information_schema.tables'), []);
    const ready = first.ready();
    assert.equal(first.ready(), ready);
    assert.deepEqual(await ready, { provider: 'postgres', persistent: true, schemaVersion: 1 });
    const created = await first.createUser(user({ email: '  ANNA@Example.COM ', termsAcceptedAt: stamp, termsVersion: '2026-10-27' }));
    await first.close();
    const second = createPostgresAccountStore({ pool: newPool() }); t.after(() => second.close());
    assert.deepEqual(await second.findById(created.id), created);
    assert.equal((await second.findByEmail(' Anna@Example.com ')).id, created.id);
    assert.equal(created.createdAt, stamp); assert.equal(created.updatedAt, stamp);
    assert.equal(created.termsAcceptedAt, stamp); assert.equal(created.termsVersion, '2026-10-27');
    assert.equal(created.advisorProfile, null);
    assert.deepEqual(db.public.many('SELECT version FROM globaledu_schema_migrations'), [{ version: 1 }]);
    assert.equal(second.info.connectionString, undefined);
});

test('unique normalized emails and IDs return compatible repository error codes', async t => {
    const { store, pool } = setup(t);
    const original = await store.createUser(user({ email: 'Duplicate@Example.COM' }));
    await assert.rejects(store.createUser(user({ email: ' duplicate@example.com ' })), { code: 'EMAIL_EXISTS' });
    await assert.rejects(store.createUser(user({ id: original.id })), { code: 'USER_EXISTS' });
    const results = await Promise.allSettled([store.createUser(user({ email: 'RACE@example.com' })), store.createUser(user({ email: ' race@example.com ' }))]);
    assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
    assert.equal(results.find(value => value.status === 'rejected').reason.code, 'EMAIL_EXISTS');
    assert.equal(Number((await pool.query('SELECT count(*) AS count FROM globaledu_users')).rows[0].count), 2);
});

test('roles, account status, profile JSON and pending verification are constrained by actual SQL', async t => {
    const { store, pool } = setup(t);
    await assert.rejects(store.createUser(user({ role: 'admin' })), { code: 'INVALID_ROLE' });
    const created = await store.createUser(user());
    for (const [sql, values] of [
        ['UPDATE globaledu_users SET role=$1 WHERE id=$2', ['admin', created.id]],
        ['UPDATE globaledu_users SET account_status=$1 WHERE id=$2', ['unknown', created.id]],
        ['UPDATE globaledu_users SET student_profile=$1::jsonb WHERE id=$2', ['[]', created.id]],
        ['UPDATE globaledu_users SET favorites=$1::jsonb WHERE id=$2', ['{}', created.id]],
        ['UPDATE globaledu_users SET advisor_profile=$1::jsonb WHERE id=$2', ['{}', created.id]],
        ['UPDATE globaledu_users SET advisor_profile=$1::jsonb WHERE id=$2', ['{"verificationStatus":"verified"}', created.id]]
    ]) await assert.rejects(pool.query(sql, values));
    assert.equal((await store.findById(created.id)).role, 'student');
});

test('profile updates lock the row, merge JSON fields and protect credentials and consent', async t => {
    const { store, pool } = setup(t);
    const originalQuery = pool.query.bind(pool);
    const trace = [];
    pool.query = (sql, values) => { trace.push(sql); return originalQuery(sql, values); };
    const created = await store.createUser(user({ termsAcceptedAt: stamp, termsVersion: '2026-10-27' }));
    for (const patch of [{ role: 'advisor' }, { email: 'new@example.com' }, { passwordHash: 'forged' }, { accountStatus: 'suspended' }, { termsVersion: 'forged' }, { unknown: true }]) await assert.rejects(store.updateUser(created.id, patch), { code: 'INVALID_UPDATE' });
    const updated = await store.updateUser(created.id, { name: 'Updated Student', studentProfile: { educationLevel: 'master' }, favorites: ['p1', 'p1', 'p2'] });
    assert.equal(updated.studentProfile.citizenshipCode, 'GE'); assert.equal(updated.studentProfile.educationLevel, 'master');
    assert.deepEqual(updated.favorites, ['p1', 'p2']);
    for (const key of ['id', 'email', 'role', 'passwordHash', 'accountStatus', 'termsAcceptedAt', 'termsVersion', 'createdAt']) assert.deepEqual(updated[key], created[key]);
    assert(trace.some(sql => /FOR UPDATE/.test(sql)));
    assert(trace.includes('BEGIN')); assert(trace.includes('COMMIT'));
    assert.equal(await store.updateUser('missing', { name: 'Missing' }), null);
    await assert.rejects(store.updateUser(created.id, { studentProfile: { graduationYear: '2027' } }), { code: 'INVALID_INPUT' });
    assert(trace.includes('ROLLBACK'));
    assert.equal((await store.findById(created.id)).studentProfile.graduationYear, 2026);
});

test('advisor pending defaults, safe URLs and returned profile isolation match SQLite behavior', async t => {
    const { store } = setup(t);
    const advisor = await store.createUser(user({ role: 'advisor', studentProfile: null, advisorProfile: { organizationName: 'Example Agency', website: 'https://example.com', specialties: ['Germany'] } }));
    assert.equal(advisor.advisorProfile.verificationStatus, 'pending');
    await assert.rejects(store.updateUser(advisor.id, { advisorProfile: { verificationStatus: 'verified' } }), { code: 'INVALID_INPUT' });
    for (const website of ['javascript:alert(1)', 'https://user:pass@example.com']) await assert.rejects(store.updateUser(advisor.id, { advisorProfile: { website } }), { code: 'INVALID_INPUT' });
    const other = await store.createUser(user());
    advisor.advisorProfile.specialties.push('forged'); other.studentProfile.citizenshipCode = 'FR';
    assert.deepEqual((await store.findById(advisor.id)).advisorProfile.specialties, ['Germany']);
    assert.equal((await store.findById(other.id)).studentProfile.citizenshipCode, 'GE');
    assert.equal(await store.findById('missing'), null); assert.equal(await store.findByEmail('missing@example.com'), null);
});

test('session hashes, canonical UTC dates, exact expiry and inactive users are enforced', async t => {
    const { store, pool } = setup(t);
    const created = await store.createUser(user());
    const hash = digest('opaque-secret-token');
    await assert.rejects(store.createSession({ idHash: 'opaque-secret-token', userId: created.id, createdAt: stamp, expiresAt: expiry }), { code: 'INVALID_SESSION_HASH' });
    const session = await store.createSession({ idHash: hash, userId: created.id, createdAt: '2026-10-27T13:00:00+04:00', expiresAt: expiry });
    assert.equal(session.createdAt, stamp);
    assert.equal((await store.findSession(hash, '2026-11-03T08:59:59.999Z')).userId, created.id);
    assert.equal(await store.findSession(hash, expiry), null);
    assert.equal(await store.findSession('raw', stamp), null);
    await assert.rejects(store.createSession({ idHash: hash, userId: created.id, createdAt: stamp, expiresAt: expiry }), { code: 'SESSION_EXISTS' });
    await assert.rejects(store.createSession({ idHash: digest('bad-expiry'), userId: created.id, createdAt: expiry, expiresAt: stamp }), { code: 'INVALID_SESSION_EXPIRY' });
    await pool.query("UPDATE globaledu_users SET account_status='suspended' WHERE id=$1", [created.id]);
    assert.equal(await store.findSession(hash, stamp), null);
    const rows = (await pool.query('SELECT * FROM globaledu_sessions')).rows;
    assert.equal(JSON.stringify(rows).includes('opaque-secret-token'), false);
    assert.deepEqual(Object.keys(rows[0]).sort(), ['created_at', 'expires_at', 'id_hash', 'user_id']);
    assert.equal(await store.pruneSessions(expiry), 1); assert.equal(await store.pruneSessions(expiry), 0);
});

test('session deletion, user scope and foreign key cascade execute in Postgres SQL', async t => {
    const { store, pool } = setup(t);
    const first = await store.createUser(user()); const second = await store.createUser(user());
    const one = digest('one'); const two = digest('two'); const other = digest('other');
    for (const [idHash, userId] of [[one, first.id], [two, first.id], [other, second.id]]) await store.createSession({ idHash, userId, createdAt: stamp, expiresAt: expiry });
    assert.equal(await store.deleteSession(one), true); assert.equal(await store.deleteSession(one), false);
    assert.equal(await store.deleteUserSessions(first.id), 1);
    assert.equal((await store.findSession(other, stamp)).userId, second.id);
    await pool.query('DELETE FROM globaledu_users WHERE id=$1', [second.id]);
    assert.equal(Number((await pool.query('SELECT count(*) AS count FROM globaledu_sessions')).rows[0].count), 0);
    await assert.rejects(store.createSession({ idHash: digest('missing'), userId: randomUUID(), createdAt: stamp, expiresAt: expiry }), { code: 'USER_NOT_FOUND' });
    await assert.rejects(pool.query('INSERT INTO globaledu_sessions (id_hash,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', ['raw-token', first.id, stamp, expiry]));
});

test('future schema versions are refused and close is idempotent', async t => {
    const { store, newPool } = setup(t);
    await store.ready();
    const direct = newPool(); t.after(() => direct.end());
    await direct.query('INSERT INTO globaledu_schema_migrations (version) VALUES (2)');
    const future = createPostgresAccountStore({ pool: newPool() }); t.after(() => future.close());
    await assert.rejects(future.ready(), { code: 'UNSUPPORTED_SCHEMA' });
    await store.close(); await store.close();
    await assert.rejects(store.ready(), { code: 'STORE_CLOSED' });
});

test('configuration is validated without network and unsafe TLS modes are refused', async () => {
    assert.throws(() => createPostgresAccountStore(), { code: 'DATABASE_NOT_CONFIGURED' });
    for (const connectionString of ['https://example.com/db', 'invalid', 'postgres://user:password@example.com/db?sslmode=disable', 'postgres://user:password@example.com/db?sslmode=no-verify']) assert.throws(() => createPostgresAccountStore({ connectionString }), { code: 'INVALID_DATABASE_CONFIG' });
    const store = createPostgresAccountStore({ connectionString: 'postgresql://user:placeholder@example.invalid/db?sslmode=require' });
    await store.close(); // No ready call: no network connection and no instantiated pg Pool.
    const options = connectionOptions('postgresql://user:placeholder@example.invalid/db?sslmode=require&ssl=no-verify&uselibpqcompat=true');
    assert.deepEqual(options.ssl, { rejectUnauthorized: true });
    assert.equal(options.max, 5); assert.equal(options.idleTimeoutMillis, 10000); assert.equal(options.connectionTimeoutMillis, 10000);
    const client = new (require('pg').Client)(options);
    assert.equal(client.connectionParameters.ssl.rejectUnauthorized, true);
});

function sqliteFixture(t, records, withSession = false) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globaledu-postgres-migration-'));
    const filename = path.join(directory, 'accounts.sqlite');
    const source = createAccountStore({ filename });
    try {
        for (const record of records) source.createUser(record);
        if (withSession) source.createSession({ idHash: digest('sqlite-only-session'), userId: records[0].id, createdAt: stamp, expiresAt: expiry });
    } finally { source.close(); }
    t.after(() => {
        const resolved = path.resolve(directory);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert(path.basename(resolved).startsWith('globaledu-postgres-migration-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    return filename;
}

test('SQLite migration defaults to aggregate-only dry-run and never touches the Postgres pool', async t => {
    const records = [user(), user({ role: 'advisor', studentProfile: null, advisorProfile: { organizationName: 'Test Agency' } })];
    const sourceFilename = sqliteFixture(t, records, true);
    const summary = await migrateAccounts({ sourceFilename, pool: new Proxy({}, { get() { throw new Error('Postgres must not be accessed in dry-run.'); } }) });
    assert.deepEqual(summary, { mode: 'dry-run', sourceProvider: 'sqlite', targetProvider: 'postgres', users: 2, students: 1, advisors: 1, sessionsNotMigrated: 1, willOverwrite: false });
    const output = execFileSync(process.execPath, ['scripts/migrate-accounts-postgres.js', '--source', sourceFilename], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, DATABASE_URL: 'postgres://not-used:not-a-secret@example.invalid/no-network' } });
    assert.deepEqual(JSON.parse(output), summary);
    for (const record of records) for (const value of [record.id, record.email, record.passwordHash]) assert.equal(output.includes(value), false);
    assert.equal(optionsFromArgs([]).write, false);
    assert.throws(() => optionsFromArgs(['--write', '--dry-run']), { code: 'INVALID_ARGUMENT' });
    assert.throws(() => optionsFromArgs(['--unknown']), { code: 'INVALID_ARGUMENT' });
});

test('explicit fixture migration preserves account credentials and consent, skips identical users, and omits all sessions', async t => {
    const record = user({ termsAcceptedAt: stamp, termsVersion: '2026-10-27' });
    const advisor = user({ role: 'advisor', studentProfile: null, advisorProfile: { organizationName: 'Agency', specialties: ['Scholarships'] } });
    const sourceFilename = sqliteFixture(t, [record, advisor], true);
    const { newPool } = database();
    const result = await migrateAccounts({ sourceFilename, write: true, pool: newPool() });
    assert.equal(result.imported, 2); assert.equal(result.alreadyPresent, 0); assert.equal(result.sessionsNotMigrated, 1);
    const store = createPostgresAccountStore({ pool: newPool() }); t.after(() => store.close());
    const imported = await store.findById(record.id);
    assert.equal(imported.passwordHash, record.passwordHash); assert.equal(imported.role, record.role);
    assert.equal(imported.termsAcceptedAt, stamp); assert.equal(imported.termsVersion, record.termsVersion);
    assert.deepEqual(imported.studentProfile, record.studentProfile); assert.deepEqual(imported.favorites, record.favorites);
    assert.equal(await store.findSession(digest('sqlite-only-session'), stamp), null);
    const second = await migrateAccounts({ sourceFilename, write: true, pool: newPool() });
    assert.equal(second.imported, 0); assert.equal(second.alreadyPresent, 2);
});

test('migration preflight refuses credential or ID conflicts before inserting any new account', async t => {
    const fresh = user({ id: 'a-fresh-user' });
    const conflicting = user({ id: 'z-existing-user', email: 'existing@example.com' });
    const sourceFilename = sqliteFixture(t, [fresh, conflicting]);
    const { newPool } = database();
    const store = createPostgresAccountStore({ pool: newPool() }); t.after(() => store.close());
    const cloud = await store.createUser({ ...conflicting, passwordHash: '$2b$10$differentCloudPasswordHashStillPreserved1234567890' });
    await assert.rejects(migrateAccounts({ sourceFilename, write: true, pool: newPool() }), { code: 'IMPORT_CONFLICT' });
    assert.equal(await store.findById(fresh.id), null);
    assert.deepEqual(await store.findById(cloud.id), cloud);
});
