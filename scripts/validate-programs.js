'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Core = require('../catalog-core');

function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}
function host(value) {
    try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password ? url.hostname.replace(/^www\./,'') : null; }
    catch { return null; }
}
function validatePrograms(catalog) {
    const errors = [];
    if (!catalog || !Array.isArray(catalog.programs) || !catalog.metadata) return ['Expected {metadata,programs:[]}'];
    if (catalog.metadata.programCount !== catalog.programs.length) errors.push('Program metadata count must match records.');
    const ids = new Set();
    const values = options => new Set(options.map(option=>option.value));
    const degrees=values(Core.DEGREES), languages=values(Core.LANGUAGES), categories=values(Core.FIELDS);
    for (const [index,p] of catalog.programs.entries()) {
        const label = p?.id || `row ${index}`;
        if (!p || typeof p !== 'object') { errors.push(`${label}: invalid record`); continue; }
        if (typeof p.id !== 'string' || !/^program_[a-z0-9-]+$/.test(p.id) || ids.has(p.id)) errors.push(`${label}: missing, invalid, or duplicate ID`);
        ids.add(p.id);
        if (!p.title || !p.institutionName || !host(p.institutionWebsite)) errors.push(`${label}: program/institution identity required`);
        if (!/^[A-Z]{2}$/.test(p.countryCode || '')) errors.push(`${label}: country code required`);
        if (!degrees.has(p.degree) || !languages.has(p.language) || !categories.has(p.category) || !p.field) errors.push(`${label}: invalid degree, language, or field taxonomy`);
        if (!['full-time','part-time','online'].includes(p.mode)) errors.push(`${label}: invalid mode`);
        if (p.durationMonths !== null && (!Number.isFinite(p.durationMonths) || p.durationMonths<=0)) errors.push(`${label}: invalid duration`);
        if (!p.tuition || !(p.tuition.amount === null || (typeof p.tuition.amount === 'number' && Number.isFinite(p.tuition.amount) && p.tuition.amount>=0))) errors.push(`${label}: unknown tuition must be null, known tuition nonnegative`);
        if (!/^[A-Z]{3}$/.test(p.tuition?.currency || '') || !['year','program'].includes(p.tuition?.period)) errors.push(`${label}: currency/period required`);
        if (!['non-eu','international','all'].includes(p.tuition?.applicantScope)) errors.push(`${label}: applicant fee scope required`);
        if (![true,false,null].includes(p.funding?.fullFunding)) errors.push(`${label}: fullFunding must be explicit boolean/null`);
        if (p.requirements?.gpaMinPercent != null && (typeof p.requirements.gpaMinPercent !== 'number' || p.requirements.gpaMinPercent<0 || p.requirements.gpaMinPercent>100)) errors.push(`${label}: GPA threshold must be explicitly percent`);
        if (p.deadline?.date !== null && !validDate(p.deadline?.date)) errors.push(`${label}: deadline must be exact ISO date or null`);
        if (!validDate(p.updatedAt) || p.verificationStatus !== 'official-source') errors.push(`${label}: source status/date missing`);
        if (!Array.isArray(p.sources) || !p.sources.length || p.sources.some(source=>!host(source.url)||!validDate(source.checkedAt)||!source.label)) errors.push(`${label}: dated HTTP(S) references required`);
        const base = host(p.institutionWebsite);
        if (!p.sources?.some(source=>{const candidate=host(source.url);return candidate&&base&&(candidate===base||candidate.endsWith(`.${base}`));})) errors.push(`${label}: at least one institution-owned source required`);
        if ('price' in p || 'matchScore' in p) errors.push(`${label}: legacy invented price/score fields prohibited`);
    }
    return errors;
}
if (require.main === module) {
    const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../Server/data/programs.json'),'utf8'));
    const errors=validatePrograms(catalog);
    if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
    else console.log(`Programs valid: ${catalog.programs.length} official-source records; unknown numeric facts preserved.`);
}
module.exports={validatePrograms,validDate};
