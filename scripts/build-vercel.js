'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {loadCatalog} = require('../Server/catalog-service');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_FILES = Object.freeze([
    'index.html', 'i18n.js', 'style.css', 'ai-agent.css', 'script.js', 'catalog-core.js',
    'scoring-core.js', 'catalog-ui.js', 'discovery-ui.js', 'ai-agent-ui.js',
    'account-ui.js', 'student-profile-core.js', 'academic-profile-ui.js', 'account-workspace.css', 'student-workspace-core.js', 'student-workspace.js', 'preview-data.js', 'scholarships.js', 'funding-core.js', 'funding-ui.js', 'funding.css'
]);
const PDF_LIB_ROOT = path.dirname(require.resolve('pdf-lib/package.json'));
const VENDOR_ASSETS = Object.freeze([
    Object.freeze({filename:'assets/vendor/pdf-lib.min.js', source:require.resolve('pdf-lib/dist/pdf-lib.min.js')}),
    Object.freeze({filename:'assets/vendor/pdf-lib.LICENSE.md', source:path.join(PDF_LIB_ROOT, 'LICENSE.md'), optional:true})
]);
const ASSET_EXTENSIONS = new Set([
    '.avif', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.ogg', '.wav', '.webm'
]);
const GENERATED_MARKER = '.globaledu-generated.json';
const MARKER_CONTENT = JSON.stringify({generator:'globaledu-vercel-build', version:1}) + '\n';

function publicPath(root, relative) {
    const target = path.resolve(root, relative);
    const within = path.relative(root, target);
    if (!within || within.startsWith(`..${path.sep}`) || within === '..' || path.isAbsolute(within)) {
        throw new Error(`Build path must remain inside its root: ${relative}`);
    }
    return target;
}

function listFiles(directory, prefix = '') {
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Build directories must be real directories, not symbolic links.');
    }
    const files = [];
    for (const name of fs.readdirSync(directory).sort()) {
        const relative = prefix ? `${prefix}/${name}` : name;
        const absolute = publicPath(directory, name);
        const entry = fs.lstatSync(absolute);
        if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in build files: ${relative}`);
        if (entry.isDirectory()) files.push(...listFiles(absolute, relative));
        else if (entry.isFile()) files.push(relative);
        else throw new Error(`Unsupported build file: ${relative}`);
    }
    return files;
}

function allowedAsset(relative) {
    return relative.startsWith('assets/') &&
        relative.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.')) &&
        ASSET_EXTENSIONS.has(path.extname(relative).toLowerCase());
}

function assertReplaceableOutput(root, outputDirectory, expectedFiles) {
    if (!fs.existsSync(outputDirectory)) return;
    const stat = fs.lstatSync(outputDirectory);
    if (stat.isSymbolicLink() || !stat.isDirectory() ||
        path.relative(root, fs.realpathSync(outputDirectory)) !== 'public') {
        throw new Error('Refusing to replace a public directory outside the project root.');
    }
    const existingFiles = listFiles(outputDirectory);
    const markerPath = publicPath(outputDirectory, GENERATED_MARKER);
    const generated = existingFiles.includes(GENERATED_MARKER) &&
        fs.readFileSync(markerPath, 'utf8') === MARKER_CONTENT;
    const allowed = new Set(expectedFiles);
    for (const filename of existingFiles) {
        const previouslyGenerated = generated &&
            (PUBLIC_FILES.includes(filename) || VENDOR_ASSETS.some(asset => asset.filename === filename) || filename === 'catalog.json' ||
                filename === GENERATED_MARKER || allowedAsset(filename));
        if (!allowed.has(filename) && !previouslyGenerated) {
            throw new Error(`Refusing to replace an unrecognized public file: ${filename}`);
        }
    }
    if (existingFiles.includes(GENERATED_MARKER) && !generated) {
        throw new Error('Refusing to replace a public directory with an unrecognized build marker.');
    }
}

// projectRoot is overridable for isolated packaging tests. Catalog data always
// comes from the repository's validated catalog service, never from user files.
function buildPublicSite({projectRoot = PROJECT_ROOT} = {}) {
    const root = fs.realpathSync(projectRoot);
    const outputDirectory = publicPath(root, 'public');
    if (path.relative(root, outputDirectory) !== 'public') {
        throw new Error('Build output must be the project public directory.');
    }

    // Validate every source and the catalog before replacing an earlier build.
    const assets = listFiles(publicPath(root, 'assets')).map(file => `assets/${file}`);
    for (const asset of assets) {
        if (!allowedAsset(asset)) throw new Error(`Unexpected public asset type: ${asset}`);
    }
    const sourceFiles = [...PUBLIC_FILES, ...assets].sort();
    for (const filename of sourceFiles) {
        const source = publicPath(root, filename);
        const stat = fs.lstatSync(source);
        if (!stat.isFile() || stat.isSymbolicLink() || path.relative(root, fs.realpathSync(source)) !== filename.split('/').join(path.sep)) {
            throw new Error(`Public source must be a regular project file: ${filename}`);
        }
    }
    // Copy specific browser dependencies, never an entire node_modules tree.
    const vendorAssets = VENDOR_ASSETS.filter(asset => !asset.optional || fs.existsSync(asset.source));
    for (const asset of vendorAssets) {
        const stat = fs.lstatSync(asset.source);
        if (!stat.isFile() || stat.isSymbolicLink()) {
            throw new Error(`Vendor asset must be a regular dependency file: ${asset.filename}`);
        }
    }
    const catalog = loadCatalog();
    const catalogJSON = JSON.stringify(catalog.payload) + '\n';
    const expectedFiles = [...sourceFiles, ...vendorAssets.map(asset => asset.filename), 'catalog.json', GENERATED_MARKER].sort();
    assertReplaceableOutput(root, outputDirectory, expectedFiles);

    // The resolved target was checked above; only this owned output is removed.
    fs.rmSync(outputDirectory, {recursive:true, force:true});
    fs.mkdirSync(outputDirectory);
    for (const filename of sourceFiles) {
        const destination = publicPath(outputDirectory, filename);
        fs.mkdirSync(path.dirname(destination), {recursive:true});
        fs.copyFileSync(publicPath(root, filename), destination);
    }
    for (const asset of vendorAssets) {
        const destination = publicPath(outputDirectory, asset.filename);
        fs.mkdirSync(path.dirname(destination), {recursive:true});
        fs.copyFileSync(asset.source, destination);
    }
    // CDN assets avoid the function response-size limit for the full directory.
    fs.writeFileSync(publicPath(outputDirectory, 'catalog.json'), catalogJSON);
    fs.writeFileSync(publicPath(outputDirectory, GENERATED_MARKER), MARKER_CONTENT);

    return {
        outputDirectory,
        files:expectedFiles,
        catalogBytes:Buffer.byteLength(catalogJSON),
        institutionCount:catalog.payload.institutions.length,
        countryCount:catalog.payload.metadata.countryCount,
        programCount:catalog.payload.programs.length,
        admissionStatisticsCount:catalog.payload.admissionStatistics.length
    };
}

if (require.main === module) {
    try {
        const result = buildPublicSite();
        console.log(`Built ${result.files.length} public files: ${result.institutionCount} institutions, ${result.programCount} programs, ${result.catalogBytes} catalog bytes.`);
    } catch (error) {
        console.error(`Vercel static build failed: ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = {buildPublicSite, PUBLIC_FILES, VENDOR_ASSETS, GENERATED_MARKER};
