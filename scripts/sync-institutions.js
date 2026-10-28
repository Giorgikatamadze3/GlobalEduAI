'use strict';

// Downloads a public directory snapshot. This script never connects to MongoDB.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isIP } = require('node:net');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'Server', 'data', 'institutions.json');
const LICENSE_PATH = path.join(PROJECT_ROOT, 'docs', 'third-party', 'HIPO-LICENSE.txt');
const SOURCE_URL = 'https://raw.githubusercontent.com/Hipo/university-domains-list/master/world_universities_and_domains.json';
const REPOSITORY_URL = 'https://github.com/Hipo/university-domains-list';
const LICENSE_URL = 'https://raw.githubusercontent.com/Hipo/university-domains-list/master/LICENSE.txt';
const SOURCE_NAME = 'Hipo University Domains and Names Data List';
const REGIONS = {
    europe: 'AD AL AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
    'north-america': 'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
    'south-america': 'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
    asia: 'AE AF AM AZ BD BH BN BT CN CY GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
    africa: 'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TG TN TZ UG YT ZA ZM ZW',
    oceania: 'AS AU CC CK CX FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS'
};
const REGION_BY_COUNTRY = new Map(Object.entries(REGIONS).flatMap(([region, codes]) => codes.split(' ').map(code => [code, region])));
const georgianNames = new Intl.DisplayNames(['ka'], { type: 'region', fallback: 'code' });
const COUNTRY_OVERRIDES = { US: 'აშშ', GB: 'დიდი ბრიტანეთი', KR: 'სამხრეთ კორეა', KP: 'ჩრდილოეთ კორეა' };

function normalizeText(value) {
    return typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/gu, ' ').trim() : '';
}

function canonicalDomain(value) {
    if (typeof value !== 'string') return null;
    try {
        const raw = value.trim().replace(/\.$/, '');
        // Domains are hostnames, not arbitrary URLs or addresses.
        if (/[\s/@?#:]/.test(raw)) return null;
        const hostname = new URL(`https://${raw}`).hostname.replace(/^www\./i, '').toLowerCase();
        if (isIP(hostname) || !hostname.includes('.') || hostname.length > 253) return null;
        if (!hostname.split('.').every(label => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) return null;
        return hostname;
    } catch { return null; }
}

function safeWebsite(value) {
    try {
        const parsed = new URL(String(value).trim());
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !canonicalDomain(parsed.hostname)) return null;
        parsed.hash = '';
        return parsed.href;
    } catch { return null; }
}

function normalizeDirectory(raw, retrievedAt, extraMetadata = {}) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100000) throw new Error('Expected a non-empty institution directory array with at most 100,000 rows.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(retrievedAt) || Number.isNaN(Date.parse(retrievedAt))) throw new Error('retrievedAt must be a valid YYYY-MM-DD date.');
    const institutions = new Map();
    const rejected = [];
    let duplicateCount = 0;

    raw.forEach((record, rowIndex) => {
        const name = normalizeText(record?.name);
        const countryCode = normalizeText(record?.alpha_two_code).toUpperCase();
        const countryEnglish = normalizeText(record?.country);
        const domains = [...new Set((Array.isArray(record?.domains) ? record.domains : []).map(canonicalDomain).filter(Boolean))].sort();
        const websites = (Array.isArray(record?.web_pages) ? record.web_pages : []).map(safeWebsite).filter(Boolean);
        if (!name || !/^[A-Z]{2}$/.test(countryCode) || !countryEnglish || !domains.length || !websites.length) {
            rejected.push({ row: rowIndex + 1, name: name || null, reason: 'Missing or invalid name, country, domain, or HTTP(S) website.' });
            return;
        }
        // Preserve independent schools sharing a domain; merge only identical country/name/domain keys.
        const identity = `${countryCode}\u0000${domains[0]}\u0000${name.toLocaleLowerCase('en-US')}`;
        const id = `inst_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
        if (institutions.has(id)) {
            duplicateCount++;
            const existing = institutions.get(id);
            existing.domains = [...new Set([...existing.domains, ...domains])].sort();
            return;
        }
        let translatedCountry;
        try { translatedCountry = COUNTRY_OVERRIDES[countryCode] || georgianNames.of(countryCode); }
        catch { translatedCountry = countryEnglish; }
        institutions.set(id, {
            id, name, countryCode,
            country: translatedCountry && translatedCountry !== countryCode ? translatedCountry : countryEnglish,
            countryEnglish,
            region: REGION_BY_COUNTRY.get(countryCode) || 'other',
            city: null,
            stateProvince: normalizeText(record['state-province']) || null,
            domains,
            website: websites[0],
            source: { name: SOURCE_NAME, url: SOURCE_URL, retrievedAt },
            verificationStatus: 'directory-listed'
        });
    });
    const rows = [...institutions.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.countryCode.localeCompare(b.countryCode) || a.id.localeCompare(b.id));
    const catalog = {
        metadata: {
            sourceName: SOURCE_NAME, sourceUrl: SOURCE_URL, repositoryUrl: REPOSITORY_URL,
            license: 'MIT', licenseUrl: LICENSE_URL, retrievedAt,
            institutionCount: rows.length,
            countryCount: new Set(rows.map(row => row.countryCode)).size,
            upstreamRecordCount: raw.length, duplicateCount, rejectedCount: rejected.length,
            coverageNote: 'Community-maintained institution directory, including universities, colleges and other listed higher-education providers. Not an exhaustive global register, accreditation confirmation, official admissions listing, or proof of active programs. Country count includes territories and the provider code XK. Unknown program facts must remain unknown.',
            geographyNote: 'Broad geographic grouping for browsing, not membership in the EU or eligibility for a scholarship. Transcontinental countries follow a consistent single-region mapping; geography does not determine admissions rights.',
            ...extraMetadata
        },
        institutions: rows
    };
    const errors = validateDirectory(catalog);
    if (errors.length) throw new Error(`Normalized catalog failed validation: ${errors.slice(0, 8).join('; ')}`);
    return { catalog, rejected };
}

function validateDirectory(catalog) {
    const errors = [];
    if (!catalog || !catalog.metadata || !Array.isArray(catalog.institutions)) return ['Expected { metadata, institutions: [] }.'];
    const ids = new Set();
    const countries = new Set();
    for (const [index, row] of catalog.institutions.entries()) {
        const label = `Row ${index + 1}`;
        if (!/^inst_[a-f0-9]{24}$/.test(row.id || '') || ids.has(row.id)) errors.push(`${label}: invalid or duplicate stable ID.`);
        ids.add(row.id);
        if (typeof row.name !== 'string' || !row.name.trim() || typeof row.country !== 'string' || !row.country.trim() || !/^[A-Z]{2}$/.test(row.countryCode || '')) errors.push(`${label}: invalid identity.`);
        countries.add(row.countryCode);
        if (!Array.isArray(row.domains) || !row.domains.length || row.domains.some(domain => canonicalDomain(domain) !== domain)) errors.push(`${label}: invalid domains.`);
        if (!safeWebsite(row.website)) errors.push(`${label}: invalid public website.`);
        if (![...Object.keys(REGIONS), 'other'].includes(row.region)) errors.push(`${label}: invalid region.`);
        if (row.city !== null && typeof row.city !== 'string') errors.push(`${label}: invalid city.`);
        if (row.stateProvince !== null && typeof row.stateProvince !== 'string') errors.push(`${label}: invalid stateProvince.`);
        if (row.verificationStatus !== 'directory-listed' || row.source?.url !== SOURCE_URL || !/^\d{4}-\d{2}-\d{2}$/.test(row.source?.retrievedAt || '')) errors.push(`${label}: missing directory provenance.`);
        if (['price', 'degree', 'lang', 'deadline', 'matchScore', 'scholarships'].some(key => Object.hasOwn(row, key))) errors.push(`${label}: invented program facts do not belong in an institution directory.`);
    }
    if (catalog.metadata.institutionCount !== catalog.institutions.length) errors.push('Institution count does not match rows.');
    if (catalog.metadata.countryCount !== countries.size) errors.push('Country count does not match rows.');
    if (catalog.metadata.license !== 'MIT' || catalog.metadata.licenseUrl !== LICENSE_URL) errors.push('Missing source license.');
    return errors;
}

async function downloadText(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'GlobalEdu-Catalog-Sync/1.0' } });
    if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
    const content = await response.text();
    if (Buffer.byteLength(content) > 30 * 1024 * 1024) throw new Error('Source response exceeds the 30 MB download limit.');
    return { content, etag: response.headers.get('etag') };
}

function writeAtomic(destination, content) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
    try { fs.renameSync(temporary, destination); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

async function main() {
    const args = process.argv.slice(2);
    const allowed = new Set(['--input', '--license-file', '--retrieved-at', '--help']);
    const options = {};
    for (let index = 0; index < args.length; index++) {
        const flag = args[index];
        if (!allowed.has(flag)) throw new Error(`Unknown argument: ${flag}`);
        if (flag === '--help') { console.log('node scripts/sync-institutions.js [--input upstream.json --license-file LICENSE.txt] [--retrieved-at YYYY-MM-DD]\nRefreshes the public directory snapshot; never writes to MongoDB.'); return; }
        if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${flag}`);
        options[flag] = args[++index];
    }
    if (Boolean(options['--input']) !== Boolean(options['--license-file'])) throw new Error('Offline imports require both --input and --license-file.');
    const [upstream, license] = options['--input']
        ? [{ content: fs.readFileSync(path.resolve(options['--input']), 'utf8'), etag: null }, { content: fs.readFileSync(path.resolve(options['--license-file']), 'utf8') }]
        : await Promise.all([downloadText(SOURCE_URL), downloadText(LICENSE_URL)]);
    if (!license.content.includes('The MIT License') || !license.content.includes('Hipo') || !license.content.includes('Permission is hereby granted')) throw new Error('The source license could not be confirmed as the Hipo MIT license. Catalog was not replaced.');
    const retrievedAt = options['--retrieved-at'] || new Date().toISOString().slice(0, 10);
    const raw = JSON.parse(upstream.content);
    if (!Array.isArray(raw) || raw.length < 1000) throw new Error('The downloaded file is not a plausible worldwide directory. Catalog was not replaced.');
    const { catalog, rejected } = normalizeDirectory(raw, retrievedAt, { sourceSha256: crypto.createHash('sha256').update(upstream.content).digest('hex'), sourceEtag: upstream.etag || null });
    if (catalog.institutions.length < 1000 || rejected.length > raw.length * 0.1) throw new Error('Too many source rows are invalid. Review the source manually; catalog was not replaced.');
    // Detect truncated or unexpectedly reduced snapshots before replacing a working catalog.
    if (fs.existsSync(OUTPUT_PATH)) {
        const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
        if (catalog.institutions.length < previous.institutions.length * 0.9) throw new Error('The source would remove over 10% of institutions. Review upstream changes manually; catalog was not replaced.');
    }
    writeAtomic(LICENSE_PATH, license.content);
    writeAtomic(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(JSON.stringify({ file: path.relative(PROJECT_ROOT, OUTPUT_PATH), institutions: catalog.metadata.institutionCount, countriesAndTerritories: catalog.metadata.countryCount, duplicatesMerged: catalog.metadata.duplicateCount, rejected: rejected.length, retrievedAt }, null, 2));
    if (rejected.length) console.log('Rejected source rows:', JSON.stringify(rejected));
}

module.exports = { normalizeDirectory, validateDirectory, canonicalDomain, safeWebsite, SOURCE_URL };
if (require.main === module) main().catch(error => { console.error(`Catalog sync failed: ${error.message}`); process.exitCode = 1; });
