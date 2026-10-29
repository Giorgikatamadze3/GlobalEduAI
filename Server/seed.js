'use strict';

// Safe catalog synchronization. Default execution is a local validation/dry run.
// No synthetic institutions are generated and no existing collection is cleared.
const fs = require('node:fs');
const path = require('node:path');
const { validateDirectory } = require('../scripts/sync-institutions');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DIRECTORY_FILE = path.join(__dirname, 'data', 'institutions.json');
const PROGRAMS_FILE = path.join(__dirname, 'data', 'programs.json');

function parseOptions(args) {
    const options = { write: false, exportPath: null, help: false };
    let explicitDryRun = false;
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (arg === '--help') options.help = true;
        else if (arg === '--write') options.write = true;
        else if (arg === '--dry-run') explicitDryRun = true;
        else if (arg === '--export') {
            if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error('--export requires a JSON destination inside this project.');
            options.exportPath = args[++index];
        } else throw new Error(`Unknown option: ${arg}`);
    }
    if (options.write && explicitDryRun) throw new Error('Choose either --write or --dry-run, not both.');
    return options;
}

function loadImportSnapshot() {
    const directory = require('../scripts/institution-supplements').applyInstitutionSupplements(require('../scripts/institution-overrides').applyInstitutionOverrides(JSON.parse(fs.readFileSync(DIRECTORY_FILE, 'utf8'))));
    const directoryErrors = validateDirectory(directory);
    if (directoryErrors.length) throw new Error(`Directory is invalid: ${directoryErrors.slice(0, 3).join('; ')}`);
    const programFile = JSON.parse(fs.readFileSync(PROGRAMS_FILE, 'utf8'));
    const programs = Array.isArray(programFile) ? programFile : programFile.programs;
    if (!Array.isArray(programs)) throw new Error('Program data must contain programs: [].');
    const ids = new Set();
    for (const program of programs) {
        if (!program || typeof program.id !== 'string' || !program.id.trim() || ids.has(program.id)) throw new Error('Programs must have unique stable IDs.');
        ids.add(program.id);
    }
    const Core = require('../catalog-core');
    const attached = Core.attachInstitutionPrograms(directory.institutions, programs);
    if (!attached || !Array.isArray(attached.institutions) || !Array.isArray(attached.programs) || !Array.isArray(attached.unmatchedPrograms)) throw new Error('Catalog linking returned an invalid result.');
    if (attached.unmatchedPrograms.length) throw new Error(`Unmatched program institutions: ${attached.unmatchedPrograms.map(program => program.id || 'unknown').join(', ')}. Review official institution domains before importing.`);
    const institutionIds = new Set(attached.institutions.map(institution => institution.id));
    if (attached.programs.some(program => !institutionIds.has(program.institutionId))) throw new Error('Every program must link to an existing institution.');
    return {
        metadata: {
            directory: directory.metadata,
            programs: Array.isArray(programFile) ? null : programFile.metadata || null,
            institutionCount: attached.institutions.length,
            programCount: attached.programs.length,
            countryCount: new Set(attached.institutions.map(institution => institution.countryCode)).size,
            formatVersion: 1
        },
        institutions: attached.institutions,
        programs: attached.programs
    };
}

function resolveExportDestination(value) {
    const destination = path.resolve(PROJECT_ROOT, value);
    const relative = path.relative(PROJECT_ROOT, destination);
    if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || path.extname(destination).toLowerCase() !== '.json') throw new Error('Export destination must be a JSON file inside this project.');
    if (relative.split(path.sep).some(segment => ['.git', 'node_modules', '.aws', '.codex', '.agents'].includes(segment))) throw new Error('Export destination cannot be inside a protected or dependency directory.');
    if ([DIRECTORY_FILE, PROGRAMS_FILE, path.join(PROJECT_ROOT, 'package.json'), path.join(PROJECT_ROOT, 'package-lock.json')].includes(destination)) throw new Error('Export destination cannot overwrite a source catalog or project manifest.');
    return destination;
}

function exportSnapshot(snapshot, requestedPath) {
    const destination = resolveExportDestination(requestedPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(temporary, destination); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    return path.relative(PROJECT_ROOT, destination);
}

async function upsertCollection(collection, records) {
    await collection.createIndex({ id: 1 }, { unique: true });
    const result = { matched: 0, modified: 0, upserted: 0 };
    for (let index = 0; index < records.length; index += 500) {
        const batch = records.slice(index, index + 500).map(record => ({
            updateOne: { filter: { id: record.id }, update: { $set: record }, upsert: true }
        }));
        const batchResult = await collection.bulkWrite(batch, { ordered: false });
        result.matched += batchResult.matchedCount || 0;
        result.modified += batchResult.modifiedCount || 0;
        result.upserted += batchResult.upsertedCount || 0;
    }
    return result;
}

async function writeSnapshot(snapshot) {
    // Load credentials only for the explicitly authorized write path.
    require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing. Configure Server/.env before using --write.');
    const mongoose = require('mongoose');
    try {
        await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
        const db = mongoose.connection.db;
        return {
            institutions: await upsertCollection(db.collection('institutions'), snapshot.institutions),
            studyprograms: await upsertCollection(db.collection('studyprograms'), snapshot.programs)
        };
    } finally { await mongoose.disconnect(); }
}

async function main(args = process.argv.slice(2)) {
    const options = parseOptions(args);
    if (options.help) {
        console.log('node Server/seed.js [--dry-run] [--export Server/data/catalog-export.json] [--write]\nDefault: validate and print local counts, with no database connection.\n--export: write a validated local JSON snapshot inside the project.\n--write: explicitly upsert institutions and studyprograms by stable ID; never delete existing records.');
        return;
    }
    const snapshot = loadImportSnapshot();
    const summary = {
        mode: options.write ? 'write' : 'dry-run',
        institutions: snapshot.metadata.institutionCount,
        programs: snapshot.metadata.programCount,
        countriesAndTerritories: snapshot.metadata.countryCount,
        collections: ['institutions', 'studyprograms'],
        deletes: 0,
        databaseConnected: false
    };
    if (options.exportPath) summary.exportedFile = exportSnapshot(snapshot, options.exportPath);
    if (options.write) { summary.result = await writeSnapshot(snapshot); summary.databaseConnected = true; }
    console.log(JSON.stringify(summary, null, 2));
}

module.exports = { parseOptions, loadImportSnapshot, resolveExportDestination, exportSnapshot, upsertCollection, main };
if (require.main === module) main().catch(error => {
    const message = String(error.message || error).replace(/mongodb(?:\+srv)?:\/\/[^\s)]+/gi, '[redacted MongoDB URI]');
    console.error(`Catalog import failed: ${message}`);
    process.exitCode = 1;
});
