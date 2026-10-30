'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA_VERSION = 1;
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
function unpackUser(row) {
    if (!row) return null;
    return {
        id: row.id, name: row.name, email: row.email, phone: row.phone,
        passwordHash: row.password_hash, role: row.role,
        studentProfile: JSON.parse(row.student_profile),
        advisorProfile: JSON.parse(row.advisor_profile),
        favorites: JSON.parse(row.favorites),
        accountStatus: row.account_status,
        termsAcceptedAt: row.terms_accepted_at, termsVersion: row.terms_version,
        createdAt: row.created_at, updatedAt: row.updated_at
    };
}
function unpackSession(row) {
    return row ? { idHash: row.id_hash, userId: row.user_id, expiresAt: row.expires_at, createdAt: row.created_at } : null;
}

function createAccountStore({ filename = path.join(__dirname, 'data', 'accounts.sqlite') } = {}) {
    if (typeof filename !== 'string' || !filename.trim()) throw failure('INVALID_INPUT', 'A SQLite filename is required.');
    const memory = filename === ':memory:';
    const databaseFile = memory ? filename : path.resolve(filename);
    if (!memory) fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
    const db = new DatabaseSync(databaseFile);
    let closed = false;
    try {
        db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
        // Serialize schema inspection with migration so simultaneous first opens cannot race.
        db.exec('BEGIN IMMEDIATE;');
        const version = db.prepare('PRAGMA user_version').get().user_version;
        if (version > SCHEMA_VERSION) throw failure('UNSUPPORTED_SCHEMA', 'Account database schema is newer than this application.');
        if (version === 0) {
            db.exec(`CREATE TABLE users (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
                    email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK(length(email) BETWEEN 3 AND 320),
                    phone TEXT NOT NULL CHECK(length(phone) <= 40),
                    password_hash TEXT NOT NULL CHECK(length(password_hash) BETWEEN 20 AND 1024),
                    role TEXT NOT NULL CHECK(role IN ('student', 'advisor')),
                    student_profile TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(student_profile) AND json_type(student_profile) IN ('object', 'null')),
                    advisor_profile TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(advisor_profile) AND json_type(advisor_profile) IN ('object', 'null')),
                    favorites TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(favorites) AND json_type(favorites) = 'array'),
                    account_status TEXT NOT NULL DEFAULT 'active' CHECK(account_status IN ('active', 'suspended')),
                    terms_accepted_at TEXT,
                    terms_version TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE sessions (
                    id_hash TEXT PRIMARY KEY NOT NULL CHECK(length(id_hash) = 64 AND id_hash NOT GLOB '*[^0-9a-f]*'),
                    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    CHECK(expires_at > created_at)
                );
                CREATE INDEX sessions_user_id ON sessions(user_id);
                CREATE INDEX sessions_expires_at ON sessions(expires_at);
                PRAGMA user_version = 1;`);
        }
        db.exec('COMMIT;');
    } catch (error) {
        try { db.exec('ROLLBACK;'); } catch { /* No active migration transaction. */ }
        db.close();
        throw error;
    }

    const statements = {
        insertUser: db.prepare(`INSERT INTO users
            (id, name, email, phone, password_hash, role, student_profile, advisor_profile, favorites, account_status, terms_accepted_at, terms_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
        findByEmail: db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE LIMIT 1'),
        findById: db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1'),
        updateUser: db.prepare('UPDATE users SET name = ?, phone = ?, student_profile = ?, advisor_profile = ?, favorites = ?, updated_at = ? WHERE id = ?'),
        insertSession: db.prepare('INSERT INTO sessions (id_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
        findSession: db.prepare(`SELECT s.* FROM sessions s INNER JOIN users u ON u.id = s.user_id
            WHERE s.id_hash = ? AND s.expires_at > ? AND u.account_status = 'active' LIMIT 1`),
        deleteSession: db.prepare('DELETE FROM sessions WHERE id_hash = ?'),
        deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
        pruneSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?')
    };

    return {
        info: Object.freeze({ provider: 'sqlite', persistent: !memory, schemaVersion: SCHEMA_VERSION }),
        createUser(record) {
            object(record, 'user');
            const role = record.role;
            if (!USER_ROLES.has(role)) throw failure('INVALID_ROLE', 'Role must be student or advisor.');
            const id = text(record.id || randomUUID(), 'id', { required: true, max: 128 });
            const name = text(record.name, 'name', { required: true });
            const email = normalizedEmail(record.email);
            if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw failure('INVALID_INPUT', 'A valid normalized email is required.');
            const phone = text(record.phone, 'phone', { max: 40 });
            const passwordHash = text(record.passwordHash, 'passwordHash', { required: true, max: 1024 });
            if (passwordHash.length < 20) throw failure('INVALID_INPUT', 'passwordHash must contain a password hash.');
            const status = record.accountStatus || 'active';
            if (!['active', 'suspended'].includes(status)) throw failure('INVALID_INPUT', 'Unknown account status.');
            const now = new Date().toISOString();
            const createdAt = isoDate(record.createdAt, 'createdAt', now);
            const updatedAt = isoDate(record.updatedAt, 'updatedAt', createdAt);
            const termsAcceptedAt = record.termsAcceptedAt == null ? null : isoDate(record.termsAcceptedAt, 'termsAcceptedAt');
            const termsVersion = record.termsVersion == null ? null : text(record.termsVersion, 'termsVersion', { required: true, max: 64 });
            const student = studentProfile(record.studentProfile === undefined ? (role === 'student' ? {} : null) : record.studentProfile);
            const advisor = advisorProfile(record.advisorProfile === undefined ? (role === 'advisor' ? {} : null) : record.advisorProfile);
            const favorites = stringArray(record.favorites || [], 'favorites', 500, 200);
            try {
                statements.insertUser.run(id, name, email, phone, passwordHash, role, JSON.stringify(student), JSON.stringify(advisor), JSON.stringify(favorites), status, termsAcceptedAt, termsVersion, createdAt, updatedAt);
            } catch (error) {
                if (String(error.message).includes('UNIQUE constraint failed: users.email')) throw failure('EMAIL_EXISTS', 'An account with this email already exists.');
                if (String(error.message).includes('UNIQUE constraint failed: users.id')) throw failure('USER_EXISTS', 'This account ID already exists.');
                throw error;
            }
            return unpackUser(statements.findById.get(id));
        },
        findByEmail(email) { return unpackUser(statements.findByEmail.get(normalizedEmail(email))); },
        findById(id) { return typeof id === 'string' ? unpackUser(statements.findById.get(id)) : null; },
        updateUser(id, patch) {
            object(patch, 'patch');
            if (Object.keys(patch).some(key => !UPDATE_FIELDS.has(key))) throw failure('INVALID_UPDATE', 'Only name, phone, profiles and favorites can be updated.');
            const current = typeof id === 'string' ? unpackUser(statements.findById.get(id)) : null;
            if (!current) return null;
            const name = Object.hasOwn(patch, 'name') ? text(patch.name, 'name', { required: true }) : current.name;
            const phone = Object.hasOwn(patch, 'phone') ? text(patch.phone, 'phone', { max: 40 }) : current.phone;
            const student = Object.hasOwn(patch, 'studentProfile') ? studentProfile(patch.studentProfile === null ? null : { ...current.studentProfile, ...object(patch.studentProfile, 'studentProfile') }) : current.studentProfile;
            const advisor = Object.hasOwn(patch, 'advisorProfile') ? advisorProfile(patch.advisorProfile === null ? null : { ...current.advisorProfile, ...object(patch.advisorProfile, 'advisorProfile') }) : current.advisorProfile;
            const favorites = Object.hasOwn(patch, 'favorites') ? stringArray(patch.favorites, 'favorites', 500, 200) : current.favorites;
            statements.updateUser.run(name, phone, JSON.stringify(student), JSON.stringify(advisor), JSON.stringify(favorites), new Date().toISOString(), current.id);
            return unpackUser(statements.findById.get(current.id));
        },
        createSession(record) {
            object(record, 'session');
            const idHash = sessionHash(record.idHash);
            const userId = text(record.userId, 'userId', { required: true, max: 128 });
            const createdAt = isoDate(record.createdAt, 'createdAt', new Date().toISOString());
            const expiresAt = isoDate(record.expiresAt, 'expiresAt');
            if (expiresAt <= createdAt) throw failure('INVALID_SESSION_EXPIRY', 'A session must expire after it was created.');
            try { statements.insertSession.run(idHash, userId, expiresAt, createdAt); }
            catch (error) {
                if (String(error.message).includes('FOREIGN KEY constraint failed')) throw failure('USER_NOT_FOUND', 'A session requires an existing user.');
                if (String(error.message).includes('UNIQUE constraint failed: sessions.id_hash')) throw failure('SESSION_EXISTS', 'This session hash already exists.');
                throw error;
            }
            return { idHash, userId, expiresAt, createdAt };
        },
        findSession(idHash, nowISO = new Date().toISOString()) {
            if (typeof idHash !== 'string' || !/^[a-f0-9]{64}$/.test(idHash)) return null;
            return unpackSession(statements.findSession.get(idHash, isoDate(nowISO, 'nowISO')));
        },
        deleteSession(idHash) {
            if (typeof idHash !== 'string' || !/^[a-f0-9]{64}$/.test(idHash)) return false;
            return statements.deleteSession.run(idHash).changes > 0;
        },
        deleteUserSessions(userId) { return typeof userId === 'string' ? statements.deleteUserSessions.run(userId).changes : 0; },
        pruneSessions(nowISO = new Date().toISOString()) { return statements.pruneSessions.run(isoDate(nowISO, 'nowISO')).changes; },
        close() { if (!closed) { db.close(); closed = true; } }
    };
}

module.exports = { createAccountStore };
