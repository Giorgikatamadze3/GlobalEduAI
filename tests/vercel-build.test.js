'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {buildPublicSite, PUBLIC_FILES, VENDOR_ASSETS, GENERATED_MARKER} = require('../scripts/build-vercel');
const {loadCatalog} = require('../Server/catalog-service');

const project = path.resolve(__dirname, '..');

function fixture(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'globaledu-vercel-build-'));
    // Only the directory returned by mkdtemp is removed, never a caller path.
    t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
    for (const filename of PUBLIC_FILES) fs.copyFileSync(path.join(project, filename), path.join(directory, filename));
    fs.cpSync(path.join(project, 'assets'), path.join(directory, 'assets'), {recursive:true});
    return directory;
}

function filesIn(directory, prefix = '') {
    return fs.readdirSync(directory, {withFileTypes:true}).flatMap(entry => {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        return entry.isDirectory() ? filesIn(path.join(directory, entry.name), relative) : [relative];
    }).sort();
}

function digest(directory) {
    const hash = crypto.createHash('sha256');
    for (const filename of filesIn(directory)) hash.update(filename).update(fs.readFileSync(path.join(directory, filename)));
    return hash.digest('hex');
}

test('Vercel output contains only approved frontend files, assets and validated catalog data', t => {
    const directory = fixture(t);
    // Typical local files must remain outside the CDN output.
    fs.mkdirSync(path.join(directory, 'Server', 'data'), {recursive:true});
    fs.mkdirSync(path.join(directory, 'node_modules'));
    fs.writeFileSync(path.join(directory, '.env'), 'PRIVATE_EXAMPLE=never-public');
    fs.writeFileSync(path.join(directory, 'Server', '.env'), 'PRIVATE_EXAMPLE=never-public');
    fs.writeFileSync(path.join(directory, 'Server', 'data', 'accounts.sqlite'), 'private database fixture');
    fs.writeFileSync(path.join(directory, 'Server', 'server.js'), 'private server fixture');

    const result = buildPublicSite({projectRoot:directory});
    const vendorAssets = VENDOR_ASSETS.filter(asset => !asset.optional || fs.existsSync(asset.source));
    const projectAssets = filesIn(path.join(project, 'assets')).map(file => `assets/${file}`);
    const expected = [...PUBLIC_FILES, ...projectAssets, ...vendorAssets.map(asset => asset.filename), 'catalog.json', GENERATED_MARKER].sort();
    assert.deepEqual(result.files, expected);
    assert.deepEqual(filesIn(result.outputDirectory), expected);
    assert.equal(fs.existsSync(path.join(result.outputDirectory, 'Server')), false);
    assert.equal(fs.existsSync(path.join(result.outputDirectory, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(result.outputDirectory, '.env')), false);
    for (const filename of [...PUBLIC_FILES, ...projectAssets]) {
        assert.deepEqual(fs.readFileSync(path.join(result.outputDirectory, filename)), fs.readFileSync(path.join(project, filename)), filename);
    }
    for (const asset of vendorAssets) {
        assert.deepEqual(fs.readFileSync(path.join(result.outputDirectory, asset.filename)), fs.readFileSync(asset.source), asset.filename);
    }
    assert.ok(expected.includes('assets/vendor/pdf-lib.min.js'));
    assert.ok(expected.includes('assets/vendor/pdf-lib.LICENSE.md'));
    assert.equal(expected.some(filename => filename.endsWith('.map')), false);

    const catalog = JSON.parse(fs.readFileSync(path.join(result.outputDirectory, 'catalog.json'), 'utf8'));
    const source = loadCatalog().payload;
    assert.deepEqual(catalog, source);
    assert.equal(catalog.metadata.institutionCount, catalog.institutions.length);
    assert.equal(catalog.metadata.programCount, catalog.programs.length);
    assert.equal(catalog.metadata.countryCount, new Set(catalog.institutions.map(item => item.countryCode)).size);
    assert.equal(catalog.metadata.admissionStatisticsCount, catalog.admissionStatistics.length);
    assert.ok(catalog.institutions.length >= 10000);
    assert.ok(catalog.metadata.countryCount >= 190);
    assert.ok(catalog.programs.length >= 1600);
    assert.equal(catalog.funding.schemes.length,12);
    assert.equal(catalog.metadata.programCoverage.completeness,'partial');
    assert.ok(catalog.programs.every(program => program.sources.length > 0));
    assert.ok(result.catalogBytes > 4_500_000, 'The full catalog is a CDN asset rather than an oversized function response.');
});

test('rebuilding owned public output is deterministic and removes stale generated assets', t => {
    const directory = fixture(t);
    const first = buildPublicSite({projectRoot:directory});
    const initial = digest(first.outputDirectory);
    fs.writeFileSync(path.join(first.outputDirectory, 'assets', 'stale.png'), 'old generated image');
    buildPublicSite({projectRoot:directory});
    assert.equal(fs.existsSync(path.join(first.outputDirectory, 'assets', 'stale.png')), false);
    assert.equal(digest(first.outputDirectory), initial);
});

test('an unrecognized public directory is preserved rather than recursively replaced', t => {
    const directory = fixture(t);
    const output = path.join(directory, 'public');
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(output, 'keep-me.txt'), 'user-owned file');
    assert.throws(() => buildPublicSite({projectRoot:directory}), /unrecognized public file/);
    assert.equal(fs.readFileSync(path.join(output, 'keep-me.txt'), 'utf8'), 'user-owned file');
});

test('an unexpected asset type stops the build before modifying a previous output', t => {
    const directory = fixture(t);
    const result = buildPublicSite({projectRoot:directory});
    const previous = digest(result.outputDirectory);
    fs.writeFileSync(path.join(directory, 'assets', '.env'), 'PRIVATE_EXAMPLE=never-public');
    assert.throws(() => buildPublicSite({projectRoot:directory}), /Unexpected public asset type/);
    assert.equal(digest(result.outputDirectory), previous);
});

test('a public directory link cannot redirect build cleanup outside the project', t => {
    const directory = fixture(t);
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'globaledu-vercel-outside-'));
    t.after(() => fs.rmSync(outside, {recursive:true, force:true}));
    fs.writeFileSync(path.join(outside, 'keep-me.txt'), 'outside the build root');
    try {
        fs.symlinkSync(outside, path.join(directory, 'public'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
            t.skip('This environment cannot create directory links.');
            return;
        }
        throw error;
    }
    assert.throws(() => buildPublicSite({projectRoot:directory}), /outside the project root/);
    assert.equal(fs.readFileSync(path.join(outside, 'keep-me.txt'), 'utf8'), 'outside the build root');
});

test('Vercel uses the native Express entry and retains private catalog JSON in the function', () => {
    const config = JSON.parse(fs.readFileSync(path.join(project, 'vercel.json'), 'utf8'));
    assert.equal(config.framework, 'express');
    assert.equal(config.buildCommand, 'npm run build');
    assert.equal(config.functions['app.js'].maxDuration, 60);
    const includeFiles=config.functions['app.js'].includeFiles;
    assert.ok(includeFiles.length<=256,'Vercel limits includeFiles patterns to 256 characters');
    const runtimeFiles=new Set(fs.globSync(includeFiles,{cwd:project}).map(file=>file.split(path.sep).join('/')));
    for(const file of ['institutions','programs','admissions-statistics','funding','program-source-registry','institution-domain-overrides'])assert.ok(runtimeFiles.has(`Server/data/${file}.json`),`${file} JSON must remain in the runtime fallback`);
    for(const file of PUBLIC_FILES)assert.ok(runtimeFiles.has(file),`${file} must remain in the runtime fallback`);
    assert.ok(![...runtimeFiles].some(file=>/\.env|accounts\.sqlite/.test(file)));
    assert.equal(config.builds, undefined);
    assert.equal(config.routes, undefined);
    assert.equal(config.rewrites, undefined);
    const entry = fs.readFileSync(path.join(project, 'app.js'), 'utf8');
    assert.match(entry, /require\('express'\)/);
    assert.match(entry, /require\('\.\/Server\/server'\)/);
    assert.match(entry, /app\.use\(server\)/);
    assert.match(entry, /module\.exports\s*=\s*app/);
    assert.doesNotMatch(entry, /\.listen\s*\(/);
});
