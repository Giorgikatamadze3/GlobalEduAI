'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {applyInstitutionOverrides} = require('../scripts/institution-overrides');
const {normalizeDirectory, validateDirectory} = require('../scripts/sync-institutions');
const registry = require('../Server/data/institution-domain-overrides.json');
const target = registry.overrides[0];

function directory(row = {}) {
    return {metadata:{institutionCount:1}, institutions:[{
        id:target.institutionId, name:target.institutionName, countryCode:'EE',
        domains:['ttu.ee'], website:'http://www.ttu.ee/', source:{url:'unchanged-upstream', retrievedAt:'2026-10-27'},
        verificationStatus:'directory-listed', ...row
    }]};
}

test('verified TalTech alias preserves stable identity and upstream provenance without mutating input', () => {
    const original = directory();
    const snapshot = structuredClone(original);
    const corrected = applyInstitutionOverrides(original);
    const row = corrected.institutions[0];
    assert.deepEqual(original, snapshot);
    assert.equal(row.id, target.institutionId);
    assert.deepEqual(row.domains, ['taltech.ee','ttu.ee']);
    assert.equal(row.website, 'https://taltech.ee/');
    assert.deepEqual(row.source, original.institutions[0].source);
    assert.equal(row.verificationStatus, 'directory-listed');
    assert.equal(row.domainOverrides.length, 1);
    assert.equal(row.domainOverrides[0].checkedAt, '2026-10-28');
    assert.ok(row.domainOverrides[0].sources.some(source => source.url === 'https://www.ttu.ee/' && source.resolvedUrl === 'https://taltech.ee/'));
    assert.deepEqual(applyInstitutionOverrides(corrected), corrected);
});

test('the override never matches another institution by its name alone', () => {
    const other = directory({id:'inst_aaaaaaaaaaaaaaaaaaaaaaaa', domains:['unrelated.ee']});
    assert.deepEqual(applyInstitutionOverrides(other), other);
    const wrongCountry = directory({countryCode:'FI'});
    assert.throws(() => applyInstitutionOverrides(wrongCountry), /identity does not match/);
});

test('upstream adoption of the verified new domain retains the established local ID', () => {
    const refreshed = directory({id:'inst_aaaaaaaaaaaaaaaaaaaaaaaa', domains:['taltech.ee'], website:'https://taltech.ee/'});
    assert.equal(applyInstitutionOverrides(refreshed).institutions[0].id, target.institutionId);
    const ambiguous = {...refreshed, institutions:[...refreshed.institutions, {...refreshed.institutions[0], id:'inst_bbbbbbbbbbbbbbbbbbbbbbbb'}]};
    assert.throws(() => applyInstitutionOverrides(ambiguous), /Ambiguous/);
});

test('directory normalization reapplies the checked alias after a refresh', () => {
    const {catalog} = normalizeDirectory([{
        name:'Tallinn University of Technology', alpha_two_code:'EE', country:'Estonia',
        domains:['ttu.ee'], web_pages:['http://www.ttu.ee/'], 'state-province':null
    }], '2026-10-28');
    assert.equal(catalog.institutions[0].id, target.institutionId);
    assert.deepEqual(catalog.institutions[0].domains, ['taltech.ee','ttu.ee']);
    assert.deepEqual(validateDirectory(catalog), []);
});

test('invalid wildcard domains and missing evidence cannot become trusted aliases', () => {
    const invalid = structuredClone(registry);
    invalid.overrides[0].additionalDomains = ['*.ee'];
    assert.throws(() => applyInstitutionOverrides(directory(), invalid), /invalid/);
    const unsupported = structuredClone(registry);
    unsupported.overrides[0].sources = [];
    assert.throws(() => applyInstitutionOverrides(directory(), unsupported), /evidence/);
});
