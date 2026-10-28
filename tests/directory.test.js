'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeDirectory, validateDirectory, safeWebsite, canonicalDomain } = require('../scripts/sync-institutions');
const { parseOptions, resolveExportDestination, upsertCollection } = require('../Server/seed');
const root = path.resolve(__dirname, '..');
const fixture = (name = 'Example University', code = 'DE', domain = 'example.edu') => ({
    name, alpha_two_code: code, country: code === 'DE' ? 'Germany' : 'Canada', domains: [domain], web_pages: [`https://www.${domain}/`], 'state-province': null
});

test('normalization preserves stable identity across source order, whitespace, case and www aliases', () => {
    const source = [fixture(), fixture('Other University', 'CA', 'other.edu')];
    const first = normalizeDirectory(source, '2026-10-27').catalog;
    const second = normalizeDirectory([{ ...source[1] }, { ...source[0], name:' Example   University ', domains:['WWW.EXAMPLE.EDU'] }], '2026-10-28').catalog;
    assert.deepEqual(first.institutions.map(row => row.id), second.institutions.map(row => row.id));
    assert.equal(first.institutions[0].country, 'გერმანია');
    assert.equal(first.institutions[0].city, null);
});

test('deduplication merges only identical identity keys, keeping distinct colleges sharing a domain', () => {
    const { catalog } = normalizeDirectory([fixture(), fixture('EXAMPLE UNIVERSITY'), fixture('Example Medical School'), fixture('Example University', 'CA')], '2026-10-27');
    assert.equal(catalog.institutions.length, 3);
    assert.equal(catalog.metadata.duplicateCount, 1);
    assert.equal(new Set(catalog.institutions.map(row => row.id)).size, 3);
});

test('invalid records are rejected rather than converted into plausible universities', () => {
    const { catalog, rejected } = normalizeDirectory([fixture(), {...fixture(), name:''}, {...fixture(), alpha_two_code:'invalid'}, {...fixture(), web_pages:['javascript:alert(1)']}], '2026-10-27');
    assert.equal(catalog.institutions.length, 1);
    assert.equal(rejected.length, 3);
    assert.throws(() => normalizeDirectory({}, '2026-10-27'), /array/);
    assert.throws(() => normalizeDirectory([fixture()], 'invalid-date'), /YYYY-MM-DD/);
});

test('directory entries never infer admissions, fees, programs, deadlines, or scholarships', () => {
    const { catalog } = normalizeDirectory([{...fixture('Berlin Free Medical University'), city:'Berlin', price:0, scholarships:['DAAD'], degree:'Medicine'}], '2026-10-27');
    const row = catalog.institutions[0];
    assert.equal(row.city, null);
    for (const key of ['price','degree','lang','deadline','matchScore','scholarships']) assert.equal(Object.hasOwn(row,key), false);
    row.price = 0;
    assert(validateDirectory(catalog).some(error => error.includes('invented program facts')));
});

test('source URL normalization rejects executable schemes, credentials and IP targets', () => {
    for (const unsafe of ['javascript:alert(1)','data:text/html,test','file:///tmp/test','https://user:secret@example.edu','http://127.0.0.1','http://[::1]','https://localhost']) assert.equal(safeWebsite(unsafe), null);
    assert.equal(safeWebsite('https://www.example.edu/admissions#apply'), 'https://www.example.edu/admissions');
    assert.equal(canonicalDomain('WWW.Example.EDU'), 'example.edu');
    assert.equal(canonicalDomain('example.edu/path'), null);
});

test('published snapshot has complete counts, unique identities, all six populated regions and source provenance', () => {
    const catalog = JSON.parse(fs.readFileSync(path.join(root, 'Server/data/institutions.json'), 'utf8'));
    assert.deepEqual(validateDirectory(catalog), []);
    assert(catalog.institutions.length >= 10000);
    assert(catalog.metadata.countryCount >= 190);
    assert.equal(new Set(catalog.institutions.map(row => row.id)).size, catalog.metadata.institutionCount);
    const counts = catalog.institutions.reduce((result,row) => (result[row.region] = (result[row.region] || 0) + 1,result), {});
    for (const region of ['europe','asia','africa','north-america','south-america','oceania']) assert(counts[region] > 0);
    assert.equal(Object.values(counts).reduce((a,b) => a+b,0), catalog.metadata.institutionCount);
    assert.equal(catalog.metadata.sourceSha256.length, 64);
    assert(catalog.institutions.every(row => row.verificationStatus === 'directory-listed' && row.source.retrievedAt === catalog.metadata.retrievedAt));
});

test('import defaults to dry-run with no credential or database requirement', () => {
    const env = {...process.env, MONGO_URI:'mongodb://127.0.0.1:1/this-must-never-be-opened'};
    const result = spawnSync(process.execPath, ['Server/seed.js'], {cwd:root,env,encoding:'utf8',timeout:5000});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.mode, 'dry-run');
    assert.equal(summary.databaseConnected, false);
    assert.equal(summary.deletes, 0);
    assert(summary.institutions >= 10000);
    assert(summary.programs > 0);
});

test('import options require an explicit write and export cannot overwrite source or escape project', () => {
    assert.equal(parseOptions([]).write, false);
    assert.equal(parseOptions(['--write']).write, true);
    assert.throws(() => parseOptions(['--dry-run','--write']), /Choose either/);
    assert.throws(() => parseOptions(['--export']), /requires/);
    assert.throws(() => resolveExportDestination('../elsewhere.json'), /inside/);
    assert.throws(() => resolveExportDestination('Server/data/institutions.json'), /overwrite/);
    assert.throws(() => resolveExportDestination('node_modules/catalog.json'), /protected/);
    assert.throws(() => resolveExportDestination('Server/.env'), /JSON file/);
    assert.equal(resolveExportDestination('Server/data/catalog-export.json'), path.join(root,'Server/data/catalog-export.json'));
});

test('upsert batching is idempotent, preserves unrelated entries and uses stable ID predicates', async () => {
    const database = new Map([['unrelated', {id:'unrelated', name:'Preserved'}]]);
    const calls = [];
    const collection = {
        async createIndex(spec,options) { assert.deepEqual(spec,{id:1}); assert.equal(options.unique,true); },
        async bulkWrite(batch) {
            calls.push(batch.length);
            assert(batch.length <= 500);
            let matchedCount = 0; let upsertedCount = 0;
            for (const operation of batch) {
                assert.deepEqual(Object.keys(operation),['updateOne']);
                const update = operation.updateOne;
                assert.equal(update.upsert,true);
                assert.deepEqual(update.filter,{id:update.update.$set.id});
                database.has(update.filter.id) ? matchedCount++ : upsertedCount++;
                database.set(update.filter.id,{...database.get(update.filter.id),...update.update.$set});
            }
            return {matchedCount,modifiedCount:matchedCount,upsertedCount};
        },
        deleteMany() { assert.fail('Catalog import must never delete records.'); },
        drop() { assert.fail('Catalog import must never drop collections.'); }
    };
    const records = Array.from({length:1001},(_,index) => ({id:`stable_${index}`,name:`Example ${index}`}));
    const first = await upsertCollection(collection,records);
    const second = await upsertCollection(collection,records);
    assert.equal(first.upserted,1001); assert.equal(second.upserted,0); assert.equal(second.matched,1001);
    assert.equal(database.size,1002); assert.equal(database.get('unrelated').name,'Preserved');
    assert.deepEqual(calls,[500,500,1,500,500,1]);
});
