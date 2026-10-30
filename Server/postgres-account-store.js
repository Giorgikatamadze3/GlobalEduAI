'use strict';

const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;
const MIGRATION_LOCK = 1195721793;
const USER_ROLES = new Set(['student', 'advisor']);
const UPDATE_FIELDS = new Set(['name', 'phone', 'studentProfile', 'advisorProfile', 'favorites']);

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw failure('INVALID_INPUT', `${label} must be an object.`);
    return value;
}
function text(value, label, { required = false, max = 200 } = {}) {
    if (value == null && !required) return '';
    if (typeof value !== 'string') throw failure('INVALID_INPUT', `${label} must be a string.`);
    const result = value.trim();
    if ((required && !result) || result.length > max) throw failure('INVALID_INPUT', `${label} is empty or too long.`);
    return result;
}
function normalizedEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
function isoDate(value, label, fallback) {
    const selected = value == null ? fallback : value;
    if (typeof selected !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(selected)) throw failure('INVALID_INPUT', `${label} must be an ISO timestamp with timezone.`);
    const date = new Date(selected);
    if (Number.isNaN(date.getTime())) throw failure('INVALID_INPUT', `${label} is invalid.`);
    return date.toISOString();
}
function stringArray(value, label, maximum, itemMaximum) {
    if (!Array.isArray(value) || value.length > maximum) throw failure('INVALID_INPUT', `${label} must be a bounded array.`);
    return [...new Set(value.map(item => text(item, label, { required: true, max: itemMaximum })))];
}
function studentProfile(value) {
    if (value === null) return null;
    const input = object(value, 'studentProfile');
    const allowed = new Set(['educationLevel', 'citizenshipCode', 'graduationYear', ...require('../student-profile-core').EXTRA_FIELDS]);
    if (Object.keys(input).some(key => !allowed.has(key))) throw failure('INVALID_INPUT', 'Unknown student profile field.');
    const educationLevel = input.educationLevel == null ? null : text(input.educationLevel, 'educationLevel', { max: 100 });
    const citizenshipCode = input.citizenshipCode == null || input.citizenshipCode === '' ? null : text(input.citizenshipCode, 'citizenshipCode', { required: true, max: 2 }).toUpperCase();
    if (citizenshipCode !== null && !/^[A-Z]{2}$/.test(citizenshipCode)) throw failure('INVALID_INPUT', 'citizenshipCode must be a two-letter code.');
    const graduationYear = input.graduationYear == null || input.graduationYear === '' ? null : input.graduationYear;
    if (graduationYear !== null && (!Number.isInteger(graduationYear) || graduationYear < 1900 || graduationYear > 2200)) throw failure('INVALID_INPUT', 'graduationYear must be a valid integer year.');
    return { educationLevel, citizenshipCode, graduationYear, ...require('../student-profile-core').normalizeExtras(input) };
}
function advisorProfile(value) {
    if (value === null) return null;
    const input = object(value, 'advisorProfile');
    const allowed = new Set(['organizationName', 'position', 'website', 'bio', 'specialties', 'verificationStatus']);
    if (Object.keys(input).some(key => !allowed.has(key))) throw failure('INVALID_INPUT', 'Unknown advisor profile field.');
    if (input.verificationStatus != null && input.verificationStatus !== 'pending') throw failure('INVALID_INPUT', 'Advisor verification cannot be granted through profile updates.');
    const website = text(input.website, 'website', { max: 2048 });
    if (website) {
        let url;
        try { url = new URL(website); } catch { throw failure('INVALID_INPUT', 'Advisor website must be an HTTP(S) URL.'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('INVALID_INPUT', 'Advisor website must be an HTTP(S) URL without credentials.');
    }
    return {
        organizationName: text(input.organizationName, 'organizationName'),
        position: text(input.position, 'position'),
        website,
        bio: text(input.bio, 'bio', { max: 5000 }),
        specialties: stringArray(input.specialties || [], 'specialties', 30, 100),
        verificationStatus: 'pending'
    };
}
function sessionHash(value) {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw failure('INVALID_SESSION_HASH', 'Session IDs must be SHA-256 hex digests, never raw tokens.');
    return value;
}
function timestamp(value) { return value == null ? null : new Date(value).toISOString(); }
function jsonCopy(value) { return JSON.parse(JSON.stringify(value)); }
function unpackUser(row) {
    if (!row) return null;
    return {
        id: row.id, name: row.name, email: row.email, phone: row.phone,
        passwordHash: row.password_hash, role: row.role,
        studentProfile: jsonCopy(row.student_profile), advisorProfile: jsonCopy(row.advisor_profile), favorites: jsonCopy(row.favorites),
        accountStatus: row.account_status, termsAcceptedAt: timestamp(row.terms_accepted_at), termsVersion: row.terms_version,
        createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at)
    };
}
function unpackSession(row) {
    return row ? { idHash: row.id_hash, userId: row.user_id, expiresAt: timestamp(row.expires_at), createdAt: timestamp(row.created_at) } : null;
}
function normalizeUser(record) {
    object(record, 'user');
    if (!USER_ROLES.has(record.role)) throw failure('INVALID_ROLE', 'Role must be student or advisor.');
    const id = text(record.id || randomUUID(), 'id', { required: true, max: 128 });
    const name = text(record.name, 'name', { required: true });
    const email = normalizedEmail(record.email);
    if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('INVALID_INPUT', 'A valid normalized email is required.');
    const phone = text(record.phone, 'phone', { max: 40 });
    const passwordHash = text(record.passwordHash, 'passwordHash', { required: true, max: 1024 });
    if (passwordHash.length < 20) throw failure('INVALID_INPUT', 'passwordHash must contain a password hash.');
    const accountStatus = record.accountStatus || 'active';
    if (!['active', 'suspended'].includes(accountStatus)) throw failure('INVALID_INPUT', 'Unknown account status.');
    const createdAt = isoDate(record.createdAt, 'createdAt', new Date().toISOString());
    const updatedAt = isoDate(record.updatedAt, 'updatedAt', createdAt);
    const termsAcceptedAt = record.termsAcceptedAt == null ? null : isoDate(record.termsAcceptedAt, 'termsAcceptedAt');
    const termsVersion = record.termsVersion == null ? null : text(record.termsVersion, 'termsVersion', { required: true, max: 64 });
    const student = studentProfile(record.studentProfile === undefined ? (record.role === 'student' ? {} : null) : record.studentProfile);
    const advisor = advisorProfile(record.advisorProfile === undefined ? (record.role === 'advisor' ? {} : null) : record.advisorProfile);
    const favorites = stringArray(record.favorites || [], 'favorites', 500, 200);
    return { id, name, email, phone, passwordHash, role: record.role, studentProfile: student, advisorProfile: advisor, favorites, accountStatus, termsAcceptedAt, termsVersion, createdAt, updatedAt };
}
const INSERT_USER = `INSERT INTO globaledu_users
    (id, name, email, phone, password_hash, role, student_profile, advisor_profile, favorites, account_status, terms_accepted_at, terms_version, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14) RETURNING *`;
function userValues(user) {
    return [user.id, user.name, user.email, user.phone, user.passwordHash, user.role, JSON.stringify(user.studentProfile), JSON.stringify(user.advisorProfile), JSON.stringify(user.favorites), user.accountStatus, user.termsAcceptedAt, user.termsVersion, user.createdAt, user.updatedAt];
}
function mappedError(error) {
    if (error.code === '23505') {
        if (['globaledu_users_email_key', 'globaledu_users_email_casefold'].includes(error.constraint)) return failure('EMAIL_EXISTS', 'An account with this email already exists.');
        if (error.constraint === 'globaledu_users_pkey') return failure('USER_EXISTS', 'This account ID already exists.');
        if (error.constraint === 'globaledu_sessions_pkey') return failure('SESSION_EXISTS', 'This session hash already exists.');
    }
    if (error.code === '23503' && error.constraint === 'globaledu_sessions_user_id_fkey') return failure('USER_NOT_FOUND', 'A session requires an existing user.');
    return error;
}
function connectionOptions(connectionString) {
    if (typeof connectionString !== 'string' || !connectionString.trim()) throw failure('DATABASE_NOT_CONFIGURED', 'A Postgres connection string is required.');
    let url;
    try { url = new URL(connectionString); } catch { throw failure('INVALID_DATABASE_CONFIG', 'Invalid Postgres connection string.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw failure('INVALID_DATABASE_CONFIG', 'A Postgres connection string is required.');
    const sslmode = url.searchParams.get('sslmode');
    if (sslmode && !['require', 'verify-ca', 'verify-full'].includes(sslmode)) throw failure('INVALID_DATABASE_CONFIG', 'Postgres TLS certificate verification is required.');
    // pg parses connection-string TLS parameters after pool options. Strip these so
    // neither sslmode=require nor a URL flag can turn certificate verification off.
    for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
    return { connectionString: url.toString(), ssl: { rejectUnauthorized: true }, max: 5, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 };
}

function createPostgresAccountStore({ connectionString, pool: injectedPool } = {}) {
    if (injectedPool && (typeof injectedPool.query !== 'function' || typeof injectedPool.connect !== 'function' || typeof injectedPool.end !== 'function')) throw failure('INVALID_DATABASE_CONFIG', 'A compatible Postgres pool is required.');
    const options = injectedPool ? null : connectionOptions(connectionString);
    let pool = injectedPool || null;
    let readiness = null;
    let closed = false;
    let closing = null;
    const info = Object.freeze({ provider: 'postgres', persistent: true, schemaVersion: SCHEMA_VERSION });
    function getPool() {
        if (!pool) {
            const { Pool } = require('pg');
            pool = new Pool(options);
            // Idle connection failures are handled by the pool replacing the client;
            // in-flight operations still reject and the application reports failure.
            pool.on('error', () => {});
        }
        return pool;
    }
    async function transaction(work) {
        const client = await getPool().connect();
        try {
            await client.query('BEGIN');
            const result = await work(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try { await client.query('ROLLBACK'); } catch { /* Preserve the initiating failure. */ }
            throw mappedError(error);
        } finally { client.release(); }
    }
    async function migrate() {
        await transaction(async client => {
            await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
            await client.query(`CREATE TABLE IF NOT EXISTS globaledu_schema_migrations (
                version INTEGER PRIMARY KEY CHECK(version > 0), applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
            )`);
            const result = await client.query('SELECT MAX(version) AS version FROM globaledu_schema_migrations');
            const version = Number(result.rows[0].version || 0);
            if (version > SCHEMA_VERSION) throw failure('UNSUPPORTED_SCHEMA', 'Account database schema is newer than this application.');
            if (version === 0) {
                await client.query(`CREATE TABLE globaledu_users (
                    id TEXT PRIMARY KEY CHECK(length(id) BETWEEN 1 AND 128),
                    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
                    email TEXT NOT NULL CONSTRAINT globaledu_users_email_key UNIQUE CHECK(length(email) BETWEEN 3 AND 320 AND email = lower(trim(email))),
                    phone TEXT NOT NULL CHECK(length(phone) <= 40),
                    password_hash TEXT NOT NULL CHECK(length(password_hash) BETWEEN 20 AND 1024),
                    role TEXT NOT NULL CHECK(role IN ('student','advisor')),
                    student_profile JSONB NOT NULL CHECK(jsonb_typeof(student_profile) IN ('object','null')),
                    advisor_profile JSONB NOT NULL CHECK(jsonb_typeof(advisor_profile) IN ('object','null')),
                    favorites JSONB NOT NULL CHECK(jsonb_typeof(favorites) = 'array'),
                    account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active','suspended')),
                    terms_accepted_at TIMESTAMPTZ,
                    terms_version TEXT,
                    created_at TIMESTAMPTZ NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL,
                    CHECK(jsonb_typeof(advisor_profile) = 'null' OR (advisor_profile->>'verificationStatus' IS NOT NULL AND advisor_profile->>'verificationStatus' = 'pending'))
                )`);
                await client.query('CREATE UNIQUE INDEX globaledu_users_email_casefold ON globaledu_users (lower(trim(email)))');
                await client.query(`CREATE TABLE globaledu_sessions (
                    id_hash TEXT PRIMARY KEY CHECK(id_hash ~ '^[a-f0-9]{64}$'),
                    user_id TEXT NOT NULL CONSTRAINT globaledu_sessions_user_id_fkey REFERENCES globaledu_users(id) ON DELETE CASCADE,
                    expires_at TIMESTAMPTZ NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL,
                    CHECK(expires_at > created_at)
                )`);
                await client.query('CREATE INDEX globaledu_sessions_user_id ON globaledu_sessions(user_id)');
                await client.query('CREATE INDEX globaledu_sessions_expires_at ON globaledu_sessions(expires_at)');
                await client.query('INSERT INTO globaledu_schema_migrations (version) VALUES ($1)', [SCHEMA_VERSION]);
            }
        });
        return info;
    }
    function ready() {
        if (closed) return Promise.reject(failure('STORE_CLOSED', 'The account store is closed.'));
        if (!readiness) readiness = migrate();
        return readiness;
    }
    async function query(sql, values) {
        await ready();
        try { return await getPool().query(sql, values); } catch (error) { throw mappedError(error); }
    }
    return {
        info, ready,
        async createUser(record) {
            const user = normalizeUser(record);
            const result = await query(INSERT_USER, userValues(user));
            return unpackUser(result.rows[0]);
        },
        async findByEmail(email) {
            const result = await query('SELECT * FROM globaledu_users WHERE email = $1 LIMIT 1', [normalizedEmail(email)]);
            return unpackUser(result.rows[0]);
        },
        async findById(id) {
            if (typeof id !== 'string') return null;
            return unpackUser((await query('SELECT * FROM globaledu_users WHERE id = $1 LIMIT 1', [id])).rows[0]);
        },
        async updateUser(id, patch) {
            object(patch, 'patch');
            if (Object.keys(patch).some(key => !UPDATE_FIELDS.has(key))) throw failure('INVALID_UPDATE', 'Only name, phone, profiles and favorites can be updated.');
            if (typeof id !== 'string') return null;
            await ready();
            return transaction(async client => {
                const current = unpackUser((await client.query('SELECT * FROM globaledu_users WHERE id = $1 FOR UPDATE', [id])).rows[0]);
                if (!current) return null;
                const name = Object.hasOwn(patch, 'name') ? text(patch.name, 'name', { required: true }) : current.name;
                const phone = Object.hasOwn(patch, 'phone') ? text(patch.phone, 'phone', { max: 40 }) : current.phone;
                const student = Object.hasOwn(patch, 'studentProfile') ? studentProfile(patch.studentProfile === null ? null : { ...current.studentProfile, ...object(patch.studentProfile, 'studentProfile') }) : current.studentProfile;
                const advisor = Object.hasOwn(patch, 'advisorProfile') ? advisorProfile(patch.advisorProfile === null ? null : { ...current.advisorProfile, ...object(patch.advisorProfile, 'advisorProfile') }) : current.advisorProfile;
                const favorites = Object.hasOwn(patch, 'favorites') ? stringArray(patch.favorites, 'favorites', 500, 200) : current.favorites;
                const result = await client.query(`UPDATE globaledu_users SET name=$1, phone=$2, student_profile=$3::jsonb,
                    advisor_profile=$4::jsonb, favorites=$5::jsonb, updated_at=$6 WHERE id=$7 RETURNING *`,
                [name, phone, JSON.stringify(student), JSON.stringify(advisor), JSON.stringify(favorites), new Date().toISOString(), id]);
                return unpackUser(result.rows[0]);
            });
        },
        async createSession(record) {
            object(record, 'session');
            const idHash = sessionHash(record.idHash);
            const userId = text(record.userId, 'userId', { required: true, max: 128 });
            const createdAt = isoDate(record.createdAt, 'createdAt', new Date().toISOString());
            const expiresAt = isoDate(record.expiresAt, 'expiresAt');
            if (expiresAt <= createdAt) throw failure('INVALID_SESSION_EXPIRY', 'A session must expire after it was created.');
            const result = await query('INSERT INTO globaledu_sessions (id_hash,user_id,expires_at,created_at) VALUES ($1,$2,$3,$4) RETURNING *', [idHash, userId, expiresAt, createdAt]);
            return unpackSession(result.rows[0]);
        },
        async findSession(idHash, nowISO = new Date().toISOString()) {
            if (typeof idHash !== 'string' || !/^[a-f0-9]{64}$/.test(idHash)) return null;
            const now = isoDate(nowISO, 'nowISO');
            const result = await query(`SELECT s.* FROM globaledu_sessions s INNER JOIN globaledu_users u ON u.id=s.user_id
                WHERE s.id_hash=$1 AND s.expires_at > $2 AND u.account_status='active' LIMIT 1`, [idHash, now]);
            return unpackSession(result.rows[0]);
        },
        async deleteSession(idHash) {
            if (typeof idHash !== 'string' || !/^[a-f0-9]{64}$/.test(idHash)) return false;
            return (await query('DELETE FROM globaledu_sessions WHERE id_hash=$1', [idHash])).rowCount > 0;
        },
        async deleteUserSessions(userId) {
            if (typeof userId !== 'string') return 0;
            return (await query('DELETE FROM globaledu_sessions WHERE user_id=$1', [userId])).rowCount;
        },
        async pruneSessions(nowISO = new Date().toISOString()) {
            return (await query('DELETE FROM globaledu_sessions WHERE expires_at <= $1', [isoDate(nowISO, 'nowISO')])).rowCount;
        },
        close() {
            if (!closing) {
                closed = true;
                closing = (async () => {
                    if (readiness) try { await readiness; } catch { /* Close failed initializations too. */ }
                    if (pool) await pool.end();
                })();
            }
            return closing;
        }
    };
}

module.exports = { createPostgresAccountStore, normalizeUser, userValues, INSERT_USER, connectionOptions };
