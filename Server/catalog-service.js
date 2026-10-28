'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const Core = require('../catalog-core');
const Scoring = require('../scoring-core');
const Funding = require('../funding-core');
const {computeProgramCoverage} = require('../program-catalog-core');
const { validateDirectory } = require('../scripts/sync-institutions');
const { validatePrograms } = require('../scripts/validate-programs');
const {applyInstitutionOverrides} = require('../scripts/institution-overrides');

function createCatalog({ directory, programCatalog, admissionStatistics = {records:[]}, fundingCatalog = {metadata:{checkedAt:'2026-10-28',schemeCount:0,coverageNote:'No funding snapshot supplied.'},schemes:[]}, programSourceRegistry = {sources:[]} }) {
    directory=applyInstitutionOverrides(directory);
    const errors = [...validateDirectory(directory), ...validatePrograms(programCatalog)];
    errors.push(...Funding.validateFundingCatalog(fundingCatalog).issues);
    if (errors.length) throw new Error(`Catalog validation failed: ${errors.slice(0,8).join('; ')}`);
    const attached = Core.attachInstitutionPrograms(directory.institutions, programCatalog.programs);
    if (attached.unmatchedPrograms.length) {
        throw new Error(`Programs must link to a directory institution: ${attached.unmatchedPrograms.map(p => p.id).join(', ')}`);
    }
    const institutions = attached.institutions;
    const programs = attached.programs;
    const statistics=admissionStatistics.records||[];
    for (const record of statistics) {
        const program=programs.find(p=>p.id===record.programId);
        const assessment=Scoring.validateStats(record,program,{asOf:admissionStatistics.metadata?.updatedAt||record.checkedAt});
        if(!assessment.valid)throw new Error(`Invalid admissions statistics: ${assessment.errors.join('; ')}`);
    }
    const ids = new Map(institutions.map(i => [i.id, i]));
    const programIds = new Map(programs.map(p => [p.id,p]));
    const fundingForProgram = (id,applicant=null,options={}) => {
        const p=programIds.get(id);
        return p ? Funding.fundingForProgram(p,ids.get(p.institutionId),fundingCatalog,applicant,options) : [];
    };
    const fundingForInstitution = (id,applicant=null,options={}) => {
        const institution=ids.get(id);
        return institution ? Funding.fundingForInstitution(institution,programs.filter(p=>p.institutionId===id),fundingCatalog,applicant,options) : [];
    };
    // Store compact associations once per programme; the full, dated rules are
    // published once in payload.funding. Availability never means an award.
    for (const p of programs) {
        const assessments=fundingForProgram(p.id,null,{asOf:fundingCatalog.metadata.checkedAt});
        p.funding={...p.funding,
            opportunityIds:assessments.filter(a=>a.status!=='ineligible').map(a=>a.id),
            scholarships:[...new Set([...(p.funding?.scholarships||[]),...assessments.filter(a=>a.associationStatus==='listed'&&a.status!=='ineligible'&&a.callStatus!=='closed').map(a=>a.id)])]};
    }
    const countryCounts = new Map();
    institutions.forEach(i => {
        const item = countryCounts.get(i.countryCode) || { value:i.countryCode, label:i.country, count:0 };
        item.count++; countryCounts.set(i.countryCode, item);
    });
    const metadata = {
        ...directory.metadata,
        institutionCount:institutions.length,
        countryCount:countryCounts.size,
        programCount:programs.length,
        institutionsWithPrograms:institutions.filter(i=>i.programCount>0).length,
        fundingSchemeCount:fundingCatalog.schemes.length,
        programCoverage:computeProgramCoverage(institutions,programs,programSourceRegistry),
        programSources:programCatalog.metadata,
        countries:[...countryCounts.values()].sort((a,b) => a.label.localeCompare(b.label, 'ka')),
        note:'დირექტორიაში ყოფნა არ ადასტურებს აკრედიტაციას ან მიღების პირობებს. პროგრამების საფასური და მოთხოვნები ინახება ცალკე, წყაროს მითითებით.'
    };
    metadata.admissionStatisticsCount=statistics.length;
    const payload = { metadata, institutions, programs, admissionStatistics:statistics, funding:fundingCatalog };
    const json = JSON.stringify(payload);
    const gzip = zlib.gzipSync(json);
    const etag = `"${crypto.createHash('sha256').update(json).digest('hex').slice(0,24)}"`;

    function listInstitutions(query = {}) {
        const countryCode = String(query.countryCode || '').toUpperCase();
        const text = String(query.query || query.q || '').slice(0,200);
        const region = String(query.region || '');
        const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
        const limit = Math.min(100, Math.max(1, Math.trunc(Number(query.limit)) || 24));
        const list=value=>Array.isArray(value)?value:typeof value==='string'?value.split(',').filter(Boolean):[];
        const prefs={...query,countryCode,query:text,region,countryCodes:list(query.countryCodes),regions:list(query.regions),fields:list(query.fields),subjectFields:list(query.subjectFields),degrees:list(query.degrees),languages:list(query.languages),modes:list(query.modes)};
        for(const key of ['hasPrograms','tuitionKnownOnly','freeTuitionOnly','hasScholarships','sourceFreshOnly','includeUnknownFees','includeExpired','requiresFullFunding']) if(query[key]!==undefined)prefs[key]=query[key]===true||query[key]==='true';
        let filtered = Core.filterCatalogInstitutions(institutions,programs,prefs);
        if (query.hasPrograms === 'true' || query.hasPrograms === true) filtered = filtered.filter(i => i.programCount > 0);
        const pages = Math.max(1, Math.ceil(filtered.length / limit));
        const selectedPage = Math.min(page, pages);
        return {items:filtered.slice((selectedPage - 1)*limit, selectedPage*limit), total:filtered.length, page:selectedPage, pages, limit};
    }
    function recommend(preferences, options = {}) {
        const result=Core.recommendPrograms(programs, institutions, preferences, options);
        const enrich=record=>({...record,scoring:Scoring.scoreProgram(record.program,record.institution,preferences,{...options,statistics,coreEvaluation:record})});
        return {...result,matches:result.matches.map(enrich),needsVerification:result.needsVerification.map(enrich),excluded:result.excluded.map(enrich)};
    }
    return {payload, json, gzip, etag, listInstitutions, recommend, fundingForProgram, fundingForInstitution, institutionById:id => ids.get(id), programById:id=>programIds.get(id)};
}

function loadCatalog() {
    return createCatalog({
        directory:JSON.parse(fs.readFileSync(path.join(__dirname, 'data/institutions.json'), 'utf8')),
        programCatalog:JSON.parse(fs.readFileSync(path.join(__dirname, 'data/programs.json'), 'utf8')),
        admissionStatistics:JSON.parse(fs.readFileSync(path.join(__dirname,'data/admissions-statistics.json'),'utf8')),
        fundingCatalog:JSON.parse(fs.readFileSync(path.join(__dirname,'data/funding.json'),'utf8')),
        programSourceRegistry:JSON.parse(fs.readFileSync(path.join(__dirname,'data/program-source-registry.json'),'utf8'))
    });
}

module.exports = {createCatalog, loadCatalog};
