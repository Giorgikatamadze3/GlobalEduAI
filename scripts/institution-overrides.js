'use strict';

const checkedOverrides = require('../Server/data/institution-domain-overrides.json');

function validDomain(value) {
    return typeof value === 'string' && /^[a-z\d](?:[a-z\d.-]*[a-z\d])?\.[a-z]{2,}$/.test(value) &&
        value.split('.').every(label => label && !label.startsWith('-') && !label.endsWith('-'));
}

function validURL(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && validDomain(url.hostname); }
    catch { return false; }
}

function applyInstitutionOverrides(directory, registry = checkedOverrides) {
    if (!directory || !Array.isArray(directory.institutions) || !Array.isArray(registry?.overrides)) {
        throw new Error('Institution overrides require a directory and an explicit override registry.');
    }
    let institutions = [...directory.institutions];
    const overrideIds = new Set();
    for (const override of registry.overrides) {
        if (!override || typeof override.id !== 'string' || overrideIds.has(override.id) ||
            !/^inst_[a-f\d]{24}$/.test(override.institutionId || '') || !/^[A-Z]{2}$/.test(override.countryCode || '') ||
            typeof override.institutionName !== 'string' || !override.institutionName.trim() ||
            !Array.isArray(override.knownDomains) || !override.knownDomains.length || !override.knownDomains.every(validDomain) ||
            !Array.isArray(override.additionalDomains) || !override.additionalDomains.length || !override.additionalDomains.every(validDomain) ||
            !validURL(override.website) || !override.additionalDomains.includes(new URL(override.website).hostname) ||
            !/^\d{4}-\d{2}-\d{2}$/.test(override.checkedAt || '') ||
            !Array.isArray(override.sources) || !override.sources.length ||
            !override.sources.every(source => validURL(source.url) && (!source.resolvedUrl || validURL(source.resolvedUrl)) && source.checkedAt === override.checkedAt)) {
            throw new Error('Institution domain override is invalid or lacks dated official evidence.');
        }
        overrideIds.add(override.id);
        let candidates = institutions.map((row, index) => ({row, index})).filter(({row}) => row.id === override.institutionId);
        if (!candidates.length) {
            // If upstream adopts the new official domain, its generated ID can
            // change. An exact name/country/verified-domain triple retains the
            // established local identity; fuzzy/name-only matching is not used.
            candidates = institutions.map((row, index) => ({row, index})).filter(({row}) =>
                row.countryCode === override.countryCode && row.name === override.institutionName &&
                row.domains?.some(domain => override.knownDomains.includes(domain)));
        }
        if (!candidates.length) continue;
        if (candidates.length !== 1) throw new Error(`Ambiguous institution domain override: ${override.id}`);
        const {row, index} = candidates[0];
        if (row.countryCode !== override.countryCode || row.name !== override.institutionName ||
            !row.domains?.some(domain => override.knownDomains.includes(domain))) {
            throw new Error(`Institution override identity does not match its evidence: ${override.id}`);
        }
        const proof = {
            overrideId:override.id, addedDomains:[...override.additionalDomains],
            checkedAt:override.checkedAt, sources:structuredClone(override.sources)
        };
        institutions[index] = {
            ...row, id:override.institutionId,
            domains:[...new Set([...row.domains, ...override.additionalDomains])].sort(),
            website:override.website,
            domainOverrides:[...(row.domainOverrides || []).filter(item => item.overrideId !== override.id), proof]
        };
    }
    return {...directory, institutions};
}

module.exports = {applyInstitutionOverrides};
