'use strict';

const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createPostgresAccountStore, normalizeUser, userValues, INSERT_USER, connectionOptions } = require('../Server/postgres-account-store');

const DEFAULT_SOURCE = path.resolve(__dirname, '../Server/data/accounts.sqlite');
function failure(code, message) { return Object.assign(new Error(message), { code }); }

function optionsFromArgs(args) {
    const result = { sourceFilename: DEFAULT_SOURCE, write: false, help: false };
    let mode = null;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === '--help') result.help = true;
        else if (argument === '--write' || argument === '--dry-run') {
            if (mode) throw failure('INVALID_ARGUMENT', 'Choose one migration mode.');
            mode = argument; result.write = argument === '--write';
        } else if (argument === '--source') {
            const value = args[++index];
            if (!value || value.startsWith('--')) throw failure('INVALID_ARGUMENT', '--source requires an existing SQLite filename.');
            result.sourceFilename = path.resolve(value);
        } else throw failure('INVALID_ARGUMENT', 'Unknown account migration option.');
    }
    if (result.help && args.length !== 1) throw failure('INVALID_ARGUMENT', 'Use --help by itself.');
    return result;
}
function fromSqlite(row) {
    return normalizeUser({
        id: row.id, name: row.name, email: row.email, phone: row.phone, passwordHash: row.password_hash, role: row.role,
        studentProfile: JSON.parse(row.student_profile), advisorProfile: JSON.parse(row.advisor_profile), favorites: JSON.parse(row.favorites),
        accountStatus: row.account_status, termsAcceptedAt: row.terms_accepted_at, termsVersion: row.terms_version,
        createdAt: row.created_at, updatedAt: row.updated_at
    });
}

async function migrateAccounts({ sourceFilename = DEFAULT_SOURCE, write = false, connectionString, pool: injectedPool } = {}) {
    if (typeof sourceFilename !== 'string' || !sourceFilename.trim() || sourceFilename === ':memory:') throw failure('INVALID_ARGUMENT', 'An existing SQLite source file is required.');
    // readOnly prevents a typo or missing source from creating a new database.
    const sqlite = new DatabaseSync(path.resolve(sourceFilename), { readOnly: true });
    let users;
    let summary;
    try {
        const version = sqlite.prepare('PRAGMA user_version').get().user_version;
        if (version !== 1) throw failure('UNSUPPORTED_SCHEMA', 'Migration requires the version 1 SQLite account schema.');
        const count = sqlite.prepare(`SELECT count(*) AS users,
            sum(CASE WHEN role='student' THEN 1 ELSE 0 END) AS students,
            sum(CASE WHEN role='advisor' THEN 1 ELSE 0 END) AS advisors FROM users`).get();
        const sessions = sqlite.prepare('SELECT count(*) AS count FROM sessions').get().count;
        summary = { mode: write ? 'write' : 'dry-run', sourceProvider: 'sqlite', targetProvider: 'postgres', users: count.users, students: count.students || 0, advisors: count.advisors || 0, sessionsNotMigrated: sessions, willOverwrite: false };
        if (!write) return summary;
        // Validate the entire source before creating any cloud schema or opening a transaction.
        users = sqlite.prepare('SELECT * FROM users ORDER BY id').all().map(fromSqlite);
    } finally { sqlite.close(); }

    const pool = injectedPool || new (require('pg').Pool)(connectionOptions(connectionString));
    const store = createPostgresAccountStore({ pool });
    let client;
    try {
        await store.ready();
        client = await pool.connect();
        await client.query('BEGIN');
        // Serialize simultaneous copies; normal application writes remain protected
        // by uniqueness constraints, and any race rolls the entire copy back.
        await client.query('SELECT pg_advisory_xact_lock($1)', [1195721794]);
        const pending = [];
        let alreadyPresent = 0;
        for (const user of users) {
            const existing = (await client.query('SELECT id,email,password_hash,role FROM globaledu_users WHERE id=$1 OR email=$2 FOR UPDATE', [user.id, user.email])).rows;
            if (existing.length === 0) pending.push(user);
            else if (existing.length === 1 && existing[0].id === user.id && existing[0].email === user.email && existing[0].password_hash === user.passwordHash && existing[0].role === user.role) alreadyPresent++;
            else throw failure('IMPORT_CONFLICT', 'An existing cloud account conflicts with the source. No accounts were overwritten.');
        }
        for (const user of pending) await client.query(INSERT_USER, userValues(user));
        await client.query('COMMIT');
        return { ...summary, imported: pending.length, alreadyPresent };
    } catch (error) {
        if (client) try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
        throw error;
    } finally {
        if (client) client.release();
        await store.close();
    }
}

async function main(args = process.argv.slice(2)) {
    const options = optionsFromArgs(args);
    if (options.help) {
        console.log('node scripts/migrate-accounts-postgres.js [--dry-run | --write] [--source <existing SQLite file>]\nDefault: read-only aggregate counts, no Postgres connection.\n--write copies users in one transaction using DATABASE_URL, preserves password hashes and consent, skips identical IDs/email/hash/role, and aborts on conflicts. Sessions are never migrated. Back up the source first.');
        return;
    }
    if (options.write) {
        require('dotenv').config({ path: path.resolve(__dirname, '../Server/.env'), quiet: true });
        options.connectionString = process.env.DATABASE_URL;
    }
    console.log(JSON.stringify(await migrateAccounts(options), null, 2));
}

if (require.main === module) main().catch(error => {
    // pg errors may contain full statements and personal records. Emit only a safe label.
    const safeCodes = new Set(['INVALID_ARGUMENT', 'UNSUPPORTED_SCHEMA', 'IMPORT_CONFLICT', 'DATABASE_NOT_CONFIGURED', 'INVALID_DATABASE_CONFIG', 'INVALID_INPUT', 'INVALID_ROLE']);
    console.error(`Account migration failed: ${safeCodes.has(error.code) ? error.code : 'MIGRATION_FAILED'}`);
    process.exitCode = 1;
});
module.exports = { migrateAccounts, optionsFromArgs, main };
