'use strict';

const {createHash} = require('node:crypto');
const {isIP} = require('node:net');
const Core = require('./catalog-core');

const values = options => new Set(options.map(option => option.value));
const DEGREES = values(Core.DEGREES);
const LANGUAGES = values(Core.LANGUAGES);
const FIELDS = values(Core.SUBFIELDS);
const CATEGORIES = values(Core.FIELDS);
const MODES = new Set(['full-time','part-time','online']);
const TRACKING_KEYS = /^(?:utm_.+|fbclid|gclid|msclkid)$/i;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const clone = value => JSON.parse(JSON.stringify(value));
const known = value => value !== null && value !== undefined && value !== '';
const textKey = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function fail(code,message) { throw Object.assign(new Error(message),{code}); }
function shortText(value,label,maximum = 500,required = false) {
    if (!known(value) && !required) return null;
    if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum || /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_RECORD',`${label} must be a bounded nonempty string.`);
    return value.trim();
}
function validDate(value,label = 'checkedAt') {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DATE',`${label} must be an exact ISO calendar date.`);
    const date = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value) fail('INVALID_DATE',`${label} is not a calendar date.`);
    return value;
}
function checkedDate(value,label = 'checkedAt') {
    const date = validDate(value,label);
    if (date > new Date().toISOString().slice(0,10)) fail('INVALID_DATE',`${label} cannot be in the future.`);
    return date;
}
function safeURL(value,label = 'URL') {
    if (typeof value !== 'string' || value.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(value)) fail('INVALID_URL',`${label} must be a public HTTP(S) URL.`);
    let url;
    try { url = new URL(value); } catch { fail('INVALID_URL',`${label} must be an absolute URL.`); }
    const host = url.hostname.toLowerCase().replace(/\.$/,'');
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || isIP(host.replace(/^\[|\]$/g,'')) || !host.includes('.') ||
        /(?:^|\.)(?:localhost|local|internal|home|lan)$/.test(host)) fail('INVALID_URL',`${label} must use a public hostname without credentials.`);
    url.hostname = host;
    return url;
}
function canonicalProgramURL(value) {
    const url = safeURL(value,'programUrl');
    url.hash = '';
    url.hostname = url.hostname.replace(/^www\./,'');
    for (const key of [...url.searchParams.keys()]) if (TRACKING_KEYS.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/,'') || '/';
    return url.href;
}
function hostOf(value) {
    try { return safeURL(value).hostname.replace(/^www\./,''); } catch { return null; }
}
function sameSite(candidate,domain) { return candidate === domain || candidate.endsWith(`.${domain}`); }
function checkedSource(source,overrideDate) {
    if (!isObject(source)) fail('INVALID_SOURCE','A registered official source is required.');
    if (!['institution','official-directory'].includes(source.kind)) fail('INVALID_SOURCE','Only institution or official-directory sources are supported.');
    const id = shortText(source.id,'source.id',100,true);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('INVALID_SOURCE','source.id must be a stable lowercase identifier.');
    const url = safeURL(source.url,'source.url');
    if (!Array.isArray(source.countryCodes) || !source.countryCodes.length || source.countryCodes.some(code => typeof code !== 'string' || !Core.COUNTRIES[code])) fail('INVALID_SOURCE','A source must declare known country codes.');
    if (source.checkedAt !== undefined) checkedDate(source.checkedAt,'source.checkedAt');
    const checkedAt = checkedDate(overrideDate ?? source.checkedAt);
    const institutionDomains = source.institutionDomains === undefined ? [] : source.institutionDomains;
    if (!Array.isArray(institutionDomains) || institutionDomains.some(domain => typeof domain !== 'string' || !hostOf(domain.includes('://') ? domain : `https://${domain}`))) fail('INVALID_SOURCE','institutionDomains must contain public domain names.');
    return {id,kind:source.kind,url:url.href,host:url.hostname.replace(/^www\./,''),countryCodes:[...new Set(source.countryCodes)],checkedAt,
        label:shortText(source.label || source.name || id,'source.label',300,true),institutionDomains:institutionDomains.map(domain => hostOf(domain.includes('://') ? domain : `https://${domain}`))};
}
function optionalEnum(value,allowed,label) {
    if (!known(value)) return null;
    if (typeof value !== 'string' || !allowed.has(value)) fail('INVALID_ENUM',`${label} must be a supported canonical value or null.`);
    return value;
}
function optionalNumber(value,label,minimum,maximum = Infinity) {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) fail('INVALID_NUMBER',`${label} must be a finite number in its supported range.`);
    return value;
}
function objectOrEmpty(value,label) {
    if (value === undefined || value === null) return {};
    if (!isObject(value)) fail('INVALID_RECORD',`${label} must be an object.`);
    return value;
}
function normalizeLanguageTest(value) {
    if (value === null || value === undefined) return null;
    if (!isObject(value)) fail('INVALID_RECORD','languageTest must be an object.');
    const name = shortText(value.name,'languageTest.name',100,true);
    const components = value.componentMinimums === undefined || value.componentMinimums === null ? null : objectOrEmpty(value.componentMinimums,'componentMinimums');
    if (components && Object.keys(components).some(key => !['reading','listening','speaking','writing'].includes(key))) fail('INVALID_RECORD','Unknown test component.');
    const probe = {name,score:value.minScore ?? null,scoreScale:value.scoreScale,minComponentScore:value.componentsMinScore ?? null};
    const prefs = Core.normalizePreferences({languageTests:[probe]});
    if (prefs.issues.length) fail('INVALID_RECORD','Language-test thresholds need a valid, explicit score scale.');
    if (components && Object.values(components).some(score => Core.normalizePreferences({languageTests:[{name,score,scoreScale:value.scoreScale}]}).issues.length)) fail('INVALID_RECORD','A language-test component threshold is invalid.');
    return {name,minScore:optionalNumber(value.minScore,'languageTest.minScore',0),
        ...(value.scoreScale ? {scoreScale:value.scoreScale} : {}),
        ...(value.componentsMinScore !== undefined ? {componentsMinScore:optionalNumber(value.componentsMinScore,'componentsMinScore',0)} : {}),
        ...(components ? {componentMinimums:clone(components)} : {})};
}

function normalizeProgramRecord(record,source,{checkedAt} = {}) {
    const registry = checkedSource(source,checkedAt);
    if (!isObject(record)) fail('INVALID_RECORD','A program record must be an object.');
    if (record.checkedAt !== undefined) checkedDate(record.checkedAt,'record.checkedAt');
    if (record.sourceId !== undefined && record.sourceId !== registry.id) fail('SOURCE_MISMATCH','Record and registry source IDs differ.');
    const countryCode = shortText(record.countryCode,'countryCode',2,true);
    if (!Core.COUNTRIES[countryCode] || !registry.countryCodes.includes(countryCode)) fail('SOURCE_COUNTRY_MISMATCH','The program country is not covered by this source.');
    const institutionName = shortText(record.institutionName,'institutionName',300,true);
    const title = shortText(record.title,'title',500,true);
    if (!record.institutionWebsite) fail('MISSING_INSTITUTION_WEBSITE','The source did not establish an institution website.');
    const institutionWebsite = safeURL(record.institutionWebsite,'institutionWebsite').href;
    const institutionHost = hostOf(institutionWebsite);
    const programUrl = safeURL(record.programUrl,'programUrl').href;
    const sourceUrl = safeURL(record.sourceUrl || record.programUrl,'sourceUrl').href;
    for (const [name,url] of [['programUrl',programUrl],['sourceUrl',sourceUrl],...(record.listingSourceUrl ? [['listingSourceUrl',record.listingSourceUrl]] : [])]) {
        const parsed = safeURL(url,name),candidate = hostOf(parsed.href);
        if (!sameSite(candidate,registry.host)) fail('SOURCE_MISMATCH',`${name} is outside the registered official source.`);
        const registryPath = new URL(registry.url).pathname.replace(/\/+$/,'');
        if (registry.kind === 'official-directory' && registryPath && parsed.pathname !== registryPath && !parsed.pathname.startsWith(`${registryPath}/`)) fail('SOURCE_MISMATCH',`${name} is outside the registered directory path.`);
    }
    if (registry.kind === 'institution') {
        const owned = registry.institutionDomains.length ? registry.institutionDomains : [registry.host];
        if (!owned.some(domain => sameSite(institutionHost,domain) || sameSite(domain,institutionHost))) fail('SOURCE_MISMATCH','Institution website is outside the registered institution.');
    }
    const degree = optionalEnum(record.degree,DEGREES,'degree');
    const language = optionalEnum(record.language,LANGUAGES,'language');
    const languages = record.languages === undefined ? (language ? [language] : []) : record.languages;
    if (!Array.isArray(languages) || languages.length > LANGUAGES.size || languages.some(item => !LANGUAGES.has(item))) fail('INVALID_ENUM','languages must contain supported codes.');
    if (language && languages.length && !languages.includes(language)) fail('INVALID_RECORD','language must be included in languages.');
    const sourceLanguages = record.sourceLanguages ?? [];
    if (!Array.isArray(sourceLanguages) || sourceLanguages.length > 64) fail('INVALID_RECORD','sourceLanguages must be a bounded list of published labels.');
    const sourceLanguageLabels = [...new Set(sourceLanguages.map(value => shortText(value,'sourceLanguages',200,true)))];
    const field = optionalEnum(record.field,FIELDS,'field');
    const category = optionalEnum(record.category,CATEGORIES,'category');
    if (field && category && Core.SUBFIELDS.find(item => item.value === field).category !== category) fail('INVALID_ENUM','Field and category conflict.');
    const tuitionInput = objectOrEmpty(record.tuition,'tuition');
    const tuition = {
        amount:optionalNumber(tuitionInput.amount,'tuition.amount',0),currency:known(tuitionInput.currency) ? shortText(tuitionInput.currency,'tuition.currency',3,true) : null,
        period:optionalEnum(tuitionInput.period,new Set(['year','program']),'tuition.period'),
        applicantScope:optionalEnum(tuitionInput.applicantScope,new Set(['all','international','non-eu']),'tuition.applicantScope'),
        note:shortText(tuitionInput.note,'tuition.note',4000) || ''
    };
    if (tuition.currency && (!/^[A-Z]{3}$/.test(tuition.currency) || (Intl.supportedValuesOf && !Intl.supportedValuesOf('currency').includes(tuition.currency)))) fail('INVALID_ENUM','Unknown tuition currency.');
    if (tuition.amount !== null && (!tuition.currency || !tuition.period || !tuition.applicantScope)) fail('INVALID_RECORD','A known fee needs its currency, period and applicant scope.');
    const requirementsInput = objectOrEmpty(record.requirements,'requirements');
    const requirements = {
        ...(Object.hasOwn(requirementsInput,'gpaMin4')?{gpaMin4:optionalNumber(requirementsInput.gpaMin4,'gpaMin4',0,4)}:{}),
        gpaMinPercent:optionalNumber(requirementsInput.gpaMinPercent,'gpaMinPercent',0,100),
        languageLevel:optionalEnum(requirementsInput.languageLevel,new Set(['A1','A2','B1','B2','C1','C2']),'languageLevel'),
        languageTest:normalizeLanguageTest(requirementsInput.languageTest),experienceYears:optionalNumber(requirementsInput.experienceYears,'experienceYears',0,100),
        note:shortText(requirementsInput.note,'requirements.note',5000) || ''
    };
    const fundingInput = objectOrEmpty(record.funding,'funding');
    if (fundingInput.fullFunding !== undefined && ![true,false,null].includes(fundingInput.fullFunding)) fail('INVALID_RECORD','fullFunding must be an explicit boolean or null.');
    if (fundingInput.scholarships !== undefined && (!Array.isArray(fundingInput.scholarships) || fundingInput.scholarships.length)) fail('INVALID_RECORD','Funding schemes must be imported through the separate verified funding catalog.');
    const deadlineInput = objectOrEmpty(record.deadline,'deadline');
    const deadline = {date:deadlineInput.date == null ? null : validDate(deadlineInput.date,'deadline.date'),
        cycle:shortText(deadlineInput.cycle,'deadline.cycle',200),note:shortText(deadlineInput.note,'deadline.note',3000) || ''};
    const sourceRecordId = record.sourceRecordId == null ? null : shortText(String(record.sourceRecordId),'sourceRecordId',200,true);
    const provenance = {sourceId:registry.id,sourceRecordId,kind:registry.kind,recordUrl:sourceUrl,
        listingSourceUrl:record.listingSourceUrl ? safeURL(record.listingSourceUrl,'listingSourceUrl').href : null,checkedAt:registry.checkedAt};
    const identity = `${countryCode}|${institutionHost}|${canonicalProgramURL(programUrl)}`;
    const sources = [{url:sourceUrl,label:registry.label,checkedAt:registry.checkedAt,kind:registry.kind,sourceId:registry.id}];
    if (canonicalProgramURL(programUrl) !== canonicalProgramURL(sourceUrl)) sources.push({url:programUrl,label:title,checkedAt:registry.checkedAt,kind:registry.kind,sourceId:registry.id});
    return {
        id:`program_${createHash('sha256').update(identity).digest('hex').slice(0,24)}`,institutionId:null,institutionName,institutionWebsite,countryCode,title,
        field,category,degree,language,languages:[...new Set(languages)].sort(),mode:optionalEnum(record.mode,MODES,'mode'),
        durationMonths:record.durationMonths == null ? null : optionalNumber(record.durationMonths,'durationMonths',Number.MIN_VALUE,1200),
        programUrl,subject:shortText(record.subject,'subject',500),city:shortText(record.city,'city',200),
        ...(record.studyLocation?{studyLocation:{countryCode:optionalEnum(record.studyLocation.countryCode,new Set(Object.keys(Core.COUNTRIES)),'studyLocation.countryCode'),'city':shortText(record.studyLocation.city,'studyLocation.city',200),note:shortText(record.studyLocation.note,'studyLocation.note',1000)}}:{}),
        ...(record.qualificationType?{qualificationType:shortText(record.qualificationType,'qualificationType',100)}:{}),
        sourceLanguages:sourceLanguageLabels,
        tuition,funding:{fullFunding:fundingInput.fullFunding ?? null,scholarships:[]},requirements,deadline,sources,
        verificationStatus:registry.kind === 'official-directory' ? 'official-directory' : 'official-source',updatedAt:registry.checkedAt,provenance,imports:[clone(provenance)]
    };
}

function institutionIndex(directory) {
    const institutions = Array.isArray(directory) ? directory : directory?.institutions;
    if (!Array.isArray(institutions)) fail('INVALID_DIRECTORY','directory must contain institutions.');
    const rows = [];
    for (const institution of institutions) {
        if (!institution || typeof institution.id !== 'string' || !Core.COUNTRIES[institution.countryCode]) continue;
        const domains = [...new Set([hostOf(institution.website),...(institution.domains || []).map(domain => hostOf(`https://${domain}`))].filter(Boolean))];
        rows.push({institution,domains});
    }
    return {institutions,rows};
}
function resolveProgram(program,index) {
    const host = hostOf(program.institutionWebsite);
    const matches = index.rows.filter(row => row.institution.countryCode === program.countryCode && host && row.domains.some(domain => sameSite(host,domain)));
    const exact = matches.filter(row => row.domains.includes(host));
    const candidates = exact.length ? exact : matches;
    if (candidates.length === 1) return {institution:candidates[0].institution,candidates};
    const named = candidates.filter(row => textKey(row.institution.name) === textKey(program.institutionName));
    return {institution:named.length === 1 ? named[0].institution : null,candidates};
}
function institutionKey(program) { return `${program.countryCode}|${program.institutionId || hostOf(program.institutionWebsite)}`; }
function titleKey(program) {
    let title = ` ${textKey(program.title)} `;
    const suffixes = program.degree === 'master' ? ['master of science','master of arts','master of engineering','master of business administration','m sc','m a','m eng','msc','meng','mba'] :
        program.degree === 'bachelor' ? ['bachelor of science','bachelor of arts','bachelor of engineering','b sc','b a','b eng','bsc','beng'] : program.degree === 'phd' ? ['doctor of philosophy','ph d','phd'] : [];
    for (const suffix of suffixes) title = title.replaceAll(` ${suffix} `,' ');
    return `${institutionKey(program)}|${program.degree || 'unknown'}|${title.trim().replace(/\s+/g,' ')}`;
}
function programURLs(program) {
    // Curated records predate programUrl; only their first programme reference
    // is an identity. Shared fee/language-policy pages must never merge courses.
    const urls = [program.programUrl || program.sources?.[0]?.url].filter(Boolean);
    return [...new Set(urls.flatMap(value => { try { return [canonicalProgramURL(value)]; } catch { return []; } }))];
}
function sourceUnion(left,right) {
    const result = clone(left || []);
    const byURL = new Map(result.map((source,index) => [canonicalProgramURL(source.url),index]));
    for (const source of right || []) {
        const key = canonicalProgramURL(source.url);
        if (!byURL.has(key)) { byURL.set(key,result.length);result.push(clone(source)); }
        // Refresh import references, while preserving curated reference dates.
        else if (result[byURL.get(key)].sourceId === source.sourceId && source.checkedAt > result[byURL.get(key)].checkedAt) result[byURL.get(key)] = {...result[byURL.get(key)],checkedAt:source.checkedAt};
    }
    return result;
}
function fillUnknown(existing,incoming) {
    if (!known(existing)) return clone(incoming);
    if (Array.isArray(existing)) return existing.length ? clone(existing) : clone(incoming);
    if (!isObject(existing) || !isObject(incoming)) return clone(existing);
    const result = clone(existing);
    for (const [key,value] of Object.entries(incoming)) result[key] = key in result ? fillUnknown(result[key],value) : clone(value);
    return result;
}
function mergeRecord(existing,incoming) {
    const merged = fillUnknown(existing,incoming);
    // A fee is one scoped fact: never combine a new amount with an older,
    // different currency, period or applicant population.
    if (existing.tuition) {
        const comparable = ['currency','period','applicantScope'].every(key => !known(existing.tuition[key]) || !known(incoming.tuition[key]) || existing.tuition[key] === incoming.tuition[key]);
        if (existing.tuition.amount !== null && existing.tuition.amount !== undefined || !comparable) merged.tuition = clone(existing.tuition);
    }
    if (existing.requirements?.languageTest) merged.requirements.languageTest = clone(existing.requirements.languageTest);
    const sameImport = existing.provenance?.sourceId === incoming.provenance.sourceId;
    const freshImport = sameImport && incoming.provenance.checkedAt >= existing.provenance.checkedAt;
    if (freshImport) {
        for (const field of ['title','field','category','degree','language','mode','durationMonths','subject','city','programUrl']) if (known(incoming[field])) merged[field] = clone(incoming[field]);
        if (incoming.languages.length) merged.languages = clone(incoming.languages);
        if (incoming.sourceLanguages.length) merged.sourceLanguages = clone(incoming.sourceLanguages);
        // Multiple published languages do not establish a sole teaching language.
        if (incoming.sourceLanguages.length > 1 && incoming.language === null) merged.language = null;
        merged.provenance = clone(incoming.provenance);merged.updatedAt = incoming.updatedAt;
    } else if (!existing.provenance) delete merged.provenance;
    merged.id = existing.id;merged.institutionId = incoming.institutionId;
    merged.sources = sourceUnion(existing.sources,incoming.sources);
    const imports = clone(existing.imports || (existing.provenance ? [existing.provenance] : []));
    const key = item => `${item.sourceId}|${item.sourceRecordId || ''}|${item.recordUrl}`;
    const prior = imports.findIndex(item => key(item) === key(incoming.provenance));
    if (prior < 0) imports.push(clone(incoming.provenance));
    else if (incoming.provenance.checkedAt > imports[prior].checkedAt) imports[prior] = clone(incoming.provenance);
    merged.imports = imports.sort((a,b) => key(a).localeCompare(key(b),'en'));
    return merged;
}

function mergeProgramCatalog({existingPrograms = [],records,source,directory,checkedAt} = {}) {
    if (!Array.isArray(existingPrograms) || !Array.isArray(records)) fail('INVALID_ARGUMENT','existingPrograms and records must be arrays.');
    checkedSource(source,checkedAt);
    const index = institutionIndex(directory);
    const programs = clone(existingPrograms);
    const report = {sourceId:source.id,checkedAt:checkedAt ?? source.checkedAt,totalRecords:records.length,accepted:0,updated:0,duplicates:0,unmatched:0,ambiguous:0,invalid:0,sourceComplete:false,completeness:'partial',issues:[]};
    const titleMap = new Map(),urlMap = new Map();
    const incomingTitleIdentities = new Map();
    // A shared title cannot identify which published track a manual record
    // describes. Only an exact URL may claim that manual record in this case.
    for (const record of records) {
        try {
            const candidate=normalizeProgramRecord(record,source,{checkedAt});
            const institution=resolveProgram(candidate,index).institution;
            if(!institution)continue;
            candidate.institutionId=institution.id;
            const key=titleKey(candidate),identity=candidate.provenance.sourceRecordId || canonicalProgramURL(candidate.programUrl);
            if(!incomingTitleIdentities.has(key))incomingTitleIdentities.set(key,new Set());
            incomingTitleIdentities.get(key).add(identity);
        } catch { /* Validation issues are reported by the normal import pass. */ }
    }
    function remember(program,position) {
        const key = titleKey(program);
        if (!titleMap.has(key)) titleMap.set(key,new Set());titleMap.get(key).add(position);
        for (const url of programURLs(program)) {
            const urlKey = `${institutionKey(program)}|${url}`;
            if (!urlMap.has(urlKey)) urlMap.set(urlKey,new Set());urlMap.get(urlKey).add(position);
        }
    }
    for (let position = 0;position < programs.length;position++) {
        const resolved = resolveProgram(programs[position],index);
        if (resolved.institution) programs[position].institutionId = resolved.institution.id;
        remember(programs[position],position);
    }
    function issue(record,recordIndex,code,message,candidates = []) {
        report.issues.push({index:recordIndex,sourceRecordId:record?.sourceRecordId ?? null,title:typeof record?.title === 'string' ? record.title.slice(0,500) : null,
            code,message,...(candidates.length ? {institutionIds:candidates.map(row => row.institution.id)} : {})});
    }
    for (const [recordIndex,record] of records.entries()) {
        let program;
        try { program = normalizeProgramRecord(record,source,{checkedAt}); }
        catch (error) {
            if (error.code === 'MISSING_INSTITUTION_WEBSITE') report.unmatched++;
            else report.invalid++;
            issue(record,recordIndex,error.code || 'INVALID_RECORD',error.message);continue;
        }
        const resolved = resolveProgram(program,index);
        if (!resolved.institution) {
            if (resolved.candidates.length > 1) { report.ambiguous++;issue(record,recordIndex,'AMBIGUOUS_INSTITUTION','Several directory institutions share this identity.',resolved.candidates); }
            else { report.unmatched++;issue(record,recordIndex,'UNMATCHED_INSTITUTION','No institution matches both the country and official domain.'); }
            continue;
        }
        program.institutionId = resolved.institution.id;
        const urlMatches = new Set(programURLs(program).flatMap(url => [...(urlMap.get(`${institutionKey(program)}|${url}`) || [])]));
        const titleMatches = [...(titleMap.get(titleKey(program)) || [])].filter(position => {
            const existing=programs[position];
            if(!existing.provenance&&(incomingTitleIdentities.get(titleKey(program))?.size||0)>1)return false;
            const identities=[existing.provenance,...(existing.imports||[])].filter(item=>item?.sourceId===program.provenance.sourceId&&item.sourceRecordId);
            return !identities.length || identities.some(item=>item.sourceRecordId===program.provenance.sourceRecordId);
        });
        const matches = urlMatches.size ? urlMatches : new Set(titleMatches);
        if (matches.size > 1) { report.ambiguous++;issue(record,recordIndex,'AMBIGUOUS_PROGRAM','Several existing programs match the imported identity.');continue; }
        if (matches.size === 1) {
            const position = [...matches][0];
            const merged = mergeRecord(programs[position],program);
            if (JSON.stringify(merged) === JSON.stringify(programs[position])) report.duplicates++;
            else { programs[position] = merged;report.updated++;remember(merged,position); }
        } else {
            // Hash collisions must never replace an unrelated existing program.
            if (programs.some(existing => existing.id === program.id)) { report.invalid++;issue(record,recordIndex,'PROGRAM_ID_CONFLICT','A program identifier is already used by a different institution.');continue; }
            programs.push(program);remember(program,programs.length - 1);report.accepted++;
        }
    }
    const original = new Set(existingPrograms.map(program => program.id));
    return {programs:[...programs.filter(program => original.has(program.id)),...programs.filter(program => !original.has(program.id)).sort((a,b) => a.id.localeCompare(b.id,'en'))],report};
}

function computeProgramCoverage(institutions,programs,sources = {}) {
    if (!Array.isArray(programs)) fail('INVALID_ARGUMENT','programs must be an array.');
    const index = institutionIndex(institutions);
    const linked = new Set(),counts = new Map(),sourceCounts = new Map();
    let linkedProgramCount = 0;
    for (const program of programs) {
        const match = resolveProgram(program,index).institution;
        if (!match) continue;
        linked.add(match.id);linkedProgramCount++;
        counts.set(match.countryCode,(counts.get(match.countryCode) || 0) + 1);
        const sourceIds = new Set([program.provenance?.sourceId,...(program.imports || []).map(item => item.sourceId),...(program.sources || []).map(item => item.sourceId)].filter(Boolean));
        for (const id of sourceIds) sourceCounts.set(id,(sourceCounts.get(id) || 0) + 1);
    }
    const sourceList = Array.isArray(sources) ? sources : Array.isArray(sources.sources) ? sources.sources : Object.entries(sources).map(([id,value]) => ({id,...(isObject(value) ? value : {})}));
    const countries = [...new Set(index.institutions.map(item => item.countryCode))].sort().map(countryCode => {
        const rows = index.institutions.filter(item => item.countryCode === countryCode);
        return {countryCode,institutionCount:rows.length,institutionsWithPrograms:rows.filter(item => linked.has(item.id)).length,programCount:counts.get(countryCode) || 0};
    });
    const europeCodes='AL AD AT BA BE BG BY CH CZ DE DK EE ES FI FR GB GR HR HU IE IS IT LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK AM AZ CY GE TR KZ'.split(' ');
    const europeCountries=europeCodes.map(countryCode=>countries.find(row=>row.countryCode===countryCode)||{countryCode,institutionCount:0,institutionsWithPrograms:0,programCount:0}).sort((a,b)=>a.countryCode.localeCompare(b.countryCode));
    return {europe:{scope:'51 European countries and education systems, including transcontinental/Caucasus systems, Kazakhstan and Kosovo. This is institutional affiliation, not a guarantee of an on-site campus in every country. All programme coverage remains partial.',countryCount:europeCodes.length,countriesWithPrograms:europeCountries.filter(row=>row.programCount>0).length,countries:europeCountries,completeness:'partial'},institutionCount:index.institutions.length,institutionsWithPrograms:linked.size,institutionsWithoutPrograms:index.institutions.length - linked.size,
        programCount:programs.length,linkedProgramCount,unmatchedProgramCount:programs.length - linkedProgramCount,
        coveragePercent:index.institutions.length ? Math.round(linked.size / index.institutions.length * 10000) / 100 : 0,
        sources:sourceList.map(source => ({id:source.id,kind:source.kind || null,checkedAt:source.checkedAt || null,programCount:sourceCounts.get(source.id) || 0,
            status:sourceCounts.has(source.id) ? 'partial' : 'not-imported',complete:false})),countries,completeness:'partial'};
}

module.exports = {normalizeProgramRecord,mergeProgramCatalog,computeProgramCoverage,canonicalProgramURL};
