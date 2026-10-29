(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.FundingCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const STATUSES = Object.freeze(['listed', 'potential', 'ineligible', 'needs-verification']);
    const DEGREES = ['bachelor', 'master', 'phd'];
    const EU_EEA_CH = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO CH'.split(' '));
    const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
    const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const text = value => typeof value === 'string' ? value.trim() : '';
    const canonical = value => text(value).normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const copy = value => JSON.parse(JSON.stringify(value));
    function safeUrl(value) {
        try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
        catch { return null; }
    }
    function domain(value) {
        const input = text(value).toLowerCase();
        if (!input) return '';
        try { const url = new URL(input.includes('://') ? input : `https://${input}`); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.hostname.replace(/^www\./, '').replace(/\.$/, '') : ''; }
        catch { return ''; }
    }
    const hostMatches = (actual, allowed) => actual === allowed || actual.endsWith(`.${allowed}`);
    function domainsFor(program, institution) {
        const programHost = domain(program && program.institutionWebsite);
        const institutionHosts = [...new Set([...(Array.isArray(institution && institution.domains) ? institution.domains : []), institution && institution.website].map(domain).filter(Boolean))];
        return { programHost, institutionHosts, all: [...new Set([programHost, ...institutionHosts].filter(Boolean))] };
    }
    function date(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
    }
    function asOfDate(options) {
        const value = options && options.asOf;
        if (value === undefined) return new Date().toISOString().slice(0, 10);
        const checked = date(value);
        if (!checked) throw Object.assign(new Error('asOf must be a valid YYYY-MM-DD date.'), { code: 'INVALID_FUNDING_DATE' });
        return checked;
    }
    function validateFundingCatalog(catalog) {
        const issues = [];
        if (!record(catalog) || !record(catalog.metadata) || !Array.isArray(catalog.schemes)) return { valid: false, issues: ['Funding catalog requires metadata and schemes.'], schemeCount: 0 };
        const add = (id, message) => issues.push(`${id}: ${message}`);
        if (!date(catalog.metadata.checkedAt)) issues.push('metadata.checkedAt must be a valid date.');
        if (catalog.metadata.schemeCount !== catalog.schemes.length) issues.push('metadata.schemeCount does not match schemes.');
        if (!text(catalog.metadata.coverageNote)) issues.push('metadata.coverageNote is required.');
        const ids = new Set();
        for (const scheme of catalog.schemes) {
            if (!record(scheme)) { issues.push('Scheme must be an object.'); continue; }
            const id = scheme.id || '(missing id)';
            if (!/^funding_[a-z0-9-]+$/.test(id) || ids.has(id)) add(id, 'ID must be unique and stable.');
            ids.add(id);
            if (!text(scheme.title) || !text(scheme.provider)) add(id, 'title and provider are required.');
            if (!['external', 'institution', 'listed-program'].includes(scheme.relationship)) add(id, 'Unknown relationship.');
            const scope = scheme.scope;
            if (!record(scope)) { add(id, 'scope is required.'); continue; }
            const scopeArrays = ['countryCodes', 'degrees', 'fields', 'programIds', 'institutionDomains', 'institutionNames', 'programBindings'];
            if (scopeArrays.some(key => !Array.isArray(scope[key]))) {
                for (const key of scopeArrays) if (!Array.isArray(scope[key])) add(id, `scope.${key} must be an array.`);
                continue;
            }
            for (const key of ['fields', 'programIds', 'institutionNames']) if (!scope[key].every(value => text(value))) add(id, `scope.${key} must contain nonempty strings.`);
            if (!(scope.countryCodes || []).every(code => /^[A-Z]{2}$/.test(code))) add(id, 'Country codes must be ISO alpha-2 codes.');
            if (!(scope.degrees || []).length || !(scope.degrees || []).every(degree => DEGREES.includes(degree))) add(id, 'Known degree scope is required.');
            if (!(scope.institutionDomains || []).every(host => host === domain(host) && host.includes('.') && !host.includes('/'))) add(id, 'Invalid institution domain.');
            const sourceUrls = new Set();
            if (!Array.isArray(scheme.sources) || !scheme.sources.length) add(id, 'Official sources are required.');
            else for (const source of scheme.sources) {
                if (!record(source) || !safeUrl(source.url) || !text(source.label) || !date(source.checkedAt)) add(id, 'Source needs a safe URL, label and checkedAt date.');
                else {
                    sourceUrls.add(source.url);
                    if (source.checkedAt > catalog.metadata.checkedAt) add(id, 'A source cannot be checked after the catalog snapshot date.');
                }
            }
            for (const binding of scope.programBindings || []) {
                if (!record(binding)) { add(id, 'Program binding must be an object.'); continue; }
                if (!record(binding) || !Array.isArray(binding.institutionDomains) || !binding.institutionDomains.length || !binding.institutionDomains.every(host => host === domain(host) && host.includes('.')) || !Array.isArray(binding.titles) || !binding.titles.length || !binding.titles.every(title => text(title)) || !sourceUrls.has(binding.sourceUrl)) add(id, 'Each program binding requires institution domains AND exact titles with an included official source.');
                if (binding.call && !validCall(binding.call)) add(id, 'Invalid program-binding call dates.');
            }
            if (scheme.relationship === 'listed-program' && !(scope.programBindings || []).length && !(scope.programIds || []).length) add(id, 'Listed-program schemes require exact programme scope.');
            if (scheme.relationship === 'institution' && !(scope.institutionDomains || []).length && !(scope.institutionNames || []).length) add(id, 'Institution scheme requires explicit institution scope.');
            if (!record(scheme.coverage) || !['tuitionFull', 'livingSupport'].every(key => own(scheme.coverage, key) && [true, false, null].includes(scheme.coverage[key]))) add(id, 'Coverage booleans must explicitly be true, false or null.');
            else {
                if (own(scheme.coverage, 'fullFunding') || own(scheme, 'fullFunding') || scheme.awardGuaranteed === true) add(id, 'An opportunity must not assert full funding or a guaranteed award.');
                if (scheme.coverage.amount !== null && (typeof scheme.coverage.amount !== 'number' || !Number.isFinite(scheme.coverage.amount) || scheme.coverage.amount < 0)) add(id, 'Coverage amount must be nonnegative or null.');
                if (scheme.coverage.currency !== null && !/^[A-Z]{3}$/.test(scheme.coverage.currency)) add(id, 'Coverage currency must be explicit ISO code or null.');
                if (scheme.coverage.amount !== null && (!scheme.coverage.currency || !scheme.coverage.period)) add(id, 'A published amount needs currency and period.');
                if (!text(scheme.coverage.note)) add(id, 'Coverage limitations must be described.');
            }
            if (!validCall(scheme.call)) add(id, 'Call dates/status are invalid; never infer an annual deadline.');
            const conditions = scheme.conditions;
            if (!record(conditions)) { add(id, 'conditions are required.'); continue; }
            const allowed = new Set(['modes', 'languages', 'durationMonths', 'excludedFields', 'excludedQualificationTypes', 'excludedProgramTitles', 'tuitionFeeLiable', 'excludeEuEeaSwiss', 'excludedCitizenshipCodes', 'excludedResidenceCodes', 'minExperienceYears', 'minPostGraduationWorkHours', 'minGpa4', 'maxAge', 'enrollment', 'checks', 'exclusions']);
            if (Object.keys(conditions).some(key => !allowed.has(key))) add(id, 'Unknown applicability condition.');
            const conditionArrays = ['modes', 'languages', 'excludedFields', 'excludedQualificationTypes', 'excludedProgramTitles', 'excludedCitizenshipCodes', 'excludedResidenceCodes', 'checks', 'exclusions'];
            if (conditionArrays.some(key => conditions[key] !== undefined && !Array.isArray(conditions[key]))) {
                for (const key of conditionArrays) if (conditions[key] !== undefined && !Array.isArray(conditions[key])) add(id, `conditions.${key} must be an array.`);
                continue;
            }
            for (const key of conditionArrays.filter(value => !['checks', 'exclusions'].includes(value))) if (conditions[key] && !conditions[key].every(value => text(value))) add(id, `conditions.${key} must contain nonempty strings.`);
            for (const key of ['tuitionFeeLiable', 'excludeEuEeaSwiss']) if (conditions[key] !== undefined && typeof conditions[key] !== 'boolean') add(id, `conditions.${key} must be boolean.`);
            for (const key of ['minExperienceYears', 'minPostGraduationWorkHours', 'maxAge']) if (conditions[key] != null && (typeof conditions[key] !== 'number' || !Number.isFinite(conditions[key]) || conditions[key] < 0)) add(id, `Invalid ${key}.`);
            if (conditions.durationMonths != null && (!record(conditions.durationMonths) || !['min', 'max'].some(key => conditions.durationMonths[key] != null) || !['min', 'max'].every(key => conditions.durationMonths[key] == null || Number.isFinite(conditions.durationMonths[key]) && conditions.durationMonths[key] >= 0) || conditions.durationMonths.min != null && conditions.durationMonths.max != null && conditions.durationMonths.min > conditions.durationMonths.max || conditions.durationMonths.degrees !== undefined && (!Array.isArray(conditions.durationMonths.degrees) || !conditions.durationMonths.degrees.every(degree => DEGREES.includes(degree))))) add(id, 'Invalid duration range.');
            for (const check of conditions.checks || []) if (!record(check) || !['program', 'institution', 'applicant'].includes(check.subject) || !/^[a-zA-Z][a-zA-Z0-9]*$/.test(check.key) || ![true, false].includes(check.expected) || !text(check.label)) add(id, 'Invalid explicit applicability check.');
            for (const exclusion of conditions.exclusions || []) if (!record(exclusion) || !Array.isArray(exclusion.institutionDomains) || !exclusion.institutionDomains.length || !exclusion.institutionDomains.every(host => host === domain(host)) || !sourceUrls.has(exclusion.sourceUrl) || !text(exclusion.reason)) add(id, 'Institution exclusion requires official evidence.');
            if (conditions.minGpa4 != null && (typeof conditions.minGpa4 !== 'number' || !Number.isFinite(conditions.minGpa4) || conditions.minGpa4 < 0 || conditions.minGpa4 > 4)) add(id, 'Invalid 4-point GPA condition.');
            if (conditions.enrollment != null && (!record(conditions.enrollment) || !record(conditions.enrollment.minSemesterByDegree) || !Object.entries(conditions.enrollment.minSemesterByDegree).every(([key, value]) => DEGREES.includes(key) && Number.isInteger(value) && value > 0))) add(id, 'Invalid enrollment condition.');
        }
        return { valid: issues.length === 0, issues, schemeCount: catalog.schemes.length };
    }
    function validCall(call) {
        return record(call) && ['opensAt', 'deadline'].every(key => own(call, key) && (call[key] === null || date(call[key]))) && (!call.opensAt || !call.deadline || call.opensAt <= call.deadline) && [null, 'applicant', 'institution'].includes(call.deadlineScope) && [undefined, 'unknown', 'open', 'closed', 'upcoming', 'suspended'].includes(call.observedStatus) && (!call.observedStatus || call.observedStatus === 'unknown' || date(call.checkedAt));
    }
    function checkedCatalog(catalog) {
        const validation = validateFundingCatalog(catalog);
        if (!validation.valid) throw Object.assign(new Error('Invalid funding catalog.'), { code: 'INVALID_FUNDING_CATALOG', issues: validation.issues });
        return catalog;
    }
    function callStatus(call, asOf) {
        if (call.checkedAt && asOf >= call.checkedAt && call.observedStatus === 'suspended') return 'closed';
        if (call.deadline && asOf > call.deadline) return 'closed';
        if (call.opensAt && asOf < call.opensAt) return 'not-yet-open';
        if (call.opensAt && call.deadline && asOf >= call.opensAt && asOf <= call.deadline) return 'open';
        if (call.checkedAt && asOf >= call.checkedAt && call.observedStatus === 'closed') return 'closed';
        return 'unknown';
    }
    function assess(program, institution, scheme, applicant, asOf) {
        const scope = scheme.scope, conditions = scheme.conditions;
        const reasons = [], missing = [], structuralMissing = [];
        let rejected = false;
        const fail = message => { rejected = true; reasons.push(message); };
        const unknown = (message, structural = false) => { missing.push(message); if (structural) structuralMissing.push(message); };
        const hosts = domainsFor(program, institution);
        const country = text(program && program.countryCode || institution && institution.countryCode).toUpperCase();
        const degree = text(program && program.degree).toLowerCase();
        const field = text(program && program.field).toLowerCase();
        let association = scheme.relationship === 'external' ? 'potential' : 'unknown';
        if (program && institution && program.institutionId && institution.id && program.institutionId !== institution.id) fail('პროგრამა ამ უნივერსიტეტს არ ეკუთვნის.');
        if (program && institution && program.countryCode && institution.countryCode && program.countryCode !== institution.countryCode) fail('პროგრამისა და უნივერსიტეტის ქვეყნები არ ემთხვევა.');
        if (hosts.programHost && hosts.institutionHosts.length && !hosts.institutionHosts.some(host => hostMatches(host, hosts.programHost) || hostMatches(hosts.programHost, host))) fail('პროგრამისა და უნივერსიტეტის დომენები არ ემთხვევა.');
        if (scope.countryCodes.length) {
            if (!country) unknown('სწავლის ქვეყანა დასაზუსტებელია.', true);
            else if (!scope.countryCodes.includes(country)) fail('სწავლის ქვეყანა ამ სქემის ფარგლებს სცდება.');
        }
        if (!degree) unknown('კონკრეტული პროგრამის აკადემიური საფეხური დასაზუსტებელია.', true);
        else if (!scope.degrees.includes(degree)) fail('აკადემიური საფეხური არ შეესაბამება სქემას.');
        if (scope.fields.length) {
            if (!field) unknown('პროგრამის დარგი დასაზუსტებელია.', true);
            else if (!scope.fields.includes(field)) fail('პროგრამის დარგი ამ სქემის ფარგლებს სცდება.');
        }
        const matchesDomain = expected => hosts.all.some(host => expected.some(allowed => hostMatches(host, allowed)));
        let matchedBinding = null;
        if (scheme.relationship === 'listed-program') {
            const title = canonical(program && program.title);
            matchedBinding = scope.programBindings.find(binding => matchesDomain(binding.institutionDomains) && binding.titles.some(candidate => canonical(candidate) === title));
            const directId = program && scope.programIds.includes(program.id);
            if (matchedBinding || directId) association = 'listed';
            else if (hosts.all.length && scope.programBindings.length && !scope.programBindings.some(binding => matchesDomain(binding.institutionDomains))) fail('უნივერსიტეტი ამ სქემის დადასტურებულ მონაწილე დაწესებულებებს არ ემთხვევა.');
            else if (!program || !title || !hosts.all.length) unknown('სქემის ოფიციალურ სიასთან პროგრამის ზუსტი კავშირი დასადასტურებელია.', true);
            else fail('პროგრამა ამ მონაცემთა კრებულში დადასტურებულ მონაწილე კურსებს არ ემთხვევა; მონაწილეობის დასადასტურებლად იხილე ოფიციალური სია.');
        } else if (scope.institutionDomains.length || scope.institutionNames.length) {
            const name = canonical(institution && institution.name || program && program.institutionName);
            if (matchesDomain(scope.institutionDomains) || !hosts.all.length && name && scope.institutionNames.some(candidate => canonical(candidate) === name)) association = 'listed';
            else if (!hosts.all.length && !name) unknown('უნივერსიტეტის იდენტიფიკაცია დასადასტურებელია.', true);
            else fail('უნივერსიტეტი ამ სქემის დადასტურებულ ინსტიტუციურ ფარგლებს სცდება.');
        }
        for (const exclusion of conditions.exclusions || []) if (matchesDomain(exclusion.institutionDomains) && (!exclusion.cycle || exclusion.cycle === scheme.call.cycle)) fail(exclusion.reason);
        if ((conditions.excludedFields || []).length) {
            // An arts category also contains humanities; only exact subjects are exclusions.
            if (!field) unknown('შეამოწმე, ხომ არ ეხება პროგრამას დისციპლინის გამონაკლისი.', true);
            else if (conditions.excludedFields.includes(field)) fail('ამ დისციპლინას ცალკე დაფინანსების სქემა სჭირდება.');
        }
        const qualification = text(program && program.qualificationType).toLowerCase();
        if ((conditions.excludedQualificationTypes || []).includes(qualification)) fail('პროგრამის კვალიფიკაცია სქემიდან გამორიცხულია.');
        const titlePhrase = ` ${canonical(program && program.title)} `;
        if ((conditions.excludedQualificationTypes || []).some(value => titlePhrase.includes(` ${canonical(value)} `))) fail('პროგრამის სათაურში მითითებული კვალიფიკაცია სქემიდან გამორიცხულია.');
        if ((conditions.excludedProgramTitles || []).some(value => canonical(value) === canonical(program && program.title))) fail('ამ კონკრეტულ პროგრამას საკუთარი დაფინანსების სქემა აქვს და უნივერსიტეტის საერთო შეღავათი ავტომატურად არ ეხება.');
        for (const [key, allowed, label] of [['mode', conditions.modes || [], 'სწავლის ფორმატი'], ['language', conditions.languages || [], 'სწავლების ენა']]) if (allowed.length) {
            const actual = text(program && program[key]);
            if (!actual) unknown(`${label} დასაზუსტებელია.`, true);
            else if (!allowed.includes(actual)) fail(`${label} არ შეესაბამება მოთხოვნას.`);
        }
        if (conditions.durationMonths && (!conditions.durationMonths.degrees || conditions.durationMonths.degrees.includes(degree))) {
            const duration = program && program.durationMonths;
            if (typeof duration !== 'number' || !Number.isFinite(duration)) unknown('პროგრამის ხანგრძლივობა დასაზუსტებელია.', true);
            else if (conditions.durationMonths.min != null && duration < conditions.durationMonths.min || conditions.durationMonths.max != null && duration > conditions.durationMonths.max) fail('პროგრამის ხანგრძლივობა მოთხოვნილ დიაპაზონს სცდება.');
        }
        const citizenships = [...new Set([applicant && applicant.citizenshipCode, ...(Array.isArray(applicant && applicant.citizenshipCodes) ? applicant.citizenshipCodes : [])].map(value => text(value).toUpperCase()).filter(Boolean))];
        if (conditions.excludeEuEeaSwiss || (conditions.excludedCitizenshipCodes || []).length) {
            if (!citizenships.length) unknown('მოქალაქეობა და შესაძლო ორმაგი მოქალაქეობა დასაზუსტებელია.');
            else if (citizenships.some(code => conditions.excludeEuEeaSwiss && EU_EEA_CH.has(code) || (conditions.excludedCitizenshipCodes || []).includes(code))) fail('მითითებულ მოქალაქეობას ამ სქემის გამონაკლისი ეხება.');
        }
        if ((conditions.excludedResidenceCodes || []).length) {
            const residence = text(applicant && applicant.residenceCountryCode).toUpperCase();
            if (!residence) unknown('საცხოვრებელი ქვეყნის მოთხოვნა დასაზუსტებელია.');
            else if (conditions.excludedResidenceCodes.includes(residence)) fail('მითითებულ რეზიდენტობას ამ სქემის გამონაკლისი ეხება.');
        }
        if (conditions.tuitionFeeLiable === true) {
            const liable = applicant && applicant.tuitionFeeLiable;
            if (liable === false || program && program.tuition && program.tuition.amount === 0 && program.tuition.applicantScope === 'all') fail('სწავლის საფასურის გადახდის ვალდებულების გარეშე ეს შეღავათი არ გამოიყენება.');
            else if (liable !== true) unknown('შეამოწმე სწავლის საფასურის გადახდის პირადი ვალდებულება და ბინადრობის გამონაკლისები.');
        }
        for (const [condition, key, label] of [['minExperienceYears', 'experienceYears', 'რელევანტური სამუშაო გამოცდილება'], ['minPostGraduationWorkHours', 'postGraduationWorkHours', 'დიპლომის მიღების შემდეგ სამუშაო საათები']]) if (conditions[condition] != null) {
            const value = applicant && applicant[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) unknown(`${label} დასაზუსტებელია.`);
            else if (value < conditions[condition]) fail(`${label}: მინიმალური მოთხოვნა არ სრულდება.`);
        }
        if (conditions.minGpa4 != null) {
            const value = applicant && applicant.gpa4;
            if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 4) unknown('საჭიროა დადასტურებული GPA 0–4 სკალაზე. პროცენტული ქულა ავტომატურად არ გადაითვლება.');
            else if (value < conditions.minGpa4) fail('გამოქვეყნებული მინიმალური GPA 0–4 სკალაზე არ სრულდება.');
        }
        if (conditions.maxAge != null) {
            const age = applicant && applicant.age;
            if (!Number.isInteger(age) || age < 0) unknown('ასაკისა და დაბადების თარიღის შესაბამისობა მიმდინარე კონკურსის წესებით დასაზუსტებელია.');
            else if (age > conditions.maxAge) fail('მითითებული ასაკი სქემის ზღვარს სცდება.');
        }
        for (const check of conditions.checks || []) {
            const context = check.subject === 'program' ? program : check.subject === 'institution' ? institution : applicant;
            const actual = context && context[check.key];
            if (actual !== true && actual !== false) unknown(check.label, check.subject !== 'applicant');
            else if (actual !== check.expected) fail(check.label);
        }
        if (conditions.enrollment) {
            if (!applicant || applicant.enrolled !== true) {
                if (applicant && applicant.enrolled === false) fail('სქემა უკვე ჩარიცხულ სტუდენტებს ეხება.');
                else unknown('საჭიროა უნივერსიტეტში მიმდინარე ჩარიცხვის დადასტურება.');
            }
            const semester = applicant && applicant.semester;
            let minimum = conditions.enrollment.minSemesterByDegree[degree];
            if (degree === 'master' && conditions.enrollment.masterFirstSemesterIfTumBachelor && applicant && applicant.priorTumBachelor === true) minimum = 1;
            if (minimum) {
                if (!Number.isInteger(semester) || semester < 1) unknown('მიმდინარე სასწავლო სემესტრი დასაზუსტებელია.');
                else if (semester < minimum) fail(`საჭიროა მინიმუმ ${minimum}-ე სასწავლო სემესტრი.`);
            }
        }
        const call = matchedBinding && matchedBinding.call ? matchedBinding.call : scheme.call;
        const timing = callStatus(call, asOf);
        if (timing === 'closed') reasons.push('მითითებული კონკურსი დახურულია; შემდეგი მიღების ვადა ავტომატურად არ იგულისხმება.');
        if (timing === 'not-yet-open') reasons.push('გამოქვეყნებული კონკურსი ჯერ არ გახსნილა.');
        if (timing === 'unknown') unknown('მიმდინარე მიღების ვადა და კონკურსის გახსნილობა ოფიციალურ წყაროში გადაამოწმე.');
        const oldestCheck = scheme.sources.map(source => source.checkedAt).sort()[0];
        const stale = asOf < oldestCheck || new Date(`${asOf}T00:00:00Z`) - new Date(`${oldestCheck}T00:00:00Z`) > 366 * 86400000;
        if (stale) unknown('წყაროს თარიღი მიმდინარე შეფასებასთან ახლიდან გადასამოწმებელია.', true);
        let status = rejected ? 'ineligible' : structuralMissing.length || timing === 'closed' || timing === 'not-yet-open' ? 'needs-verification' : association === 'listed' ? 'listed' : 'potential';
        // A national external possibility never becomes a sourced programme award.
        if (!rejected && scheme.relationship === 'external' && !structuralMissing.length && timing !== 'closed' && timing !== 'not-yet-open') status = 'potential';
        if (association === 'listed') reasons.unshift('ოფიციალური წყარო აკავშირებს სქემას ამ უნივერსიტეტთან ან კონკრეტულ პროგრამასთან.');
        else if (!rejected) reasons.unshift('ეს გარე დაფინანსების შესაძლო გზაა; კონკრეტული პროგრამის მონაწილეობა გარანტირებული არ არის.');
        return {
            ...copy(scheme), status, associationStatus: association, reasons: [...new Set(reasons)], missing: [...new Set(missing)],
            eligibilityStatus: rejected ? 'ineligible' : missing.length || timing === 'closed' || timing === 'not-yet-open' ? 'needs-verification' : 'meets-known-conditions',
            call: copy(call), callStatus: timing, programId: program && program.id || null, institutionId: institution && institution.id || program && program.institutionId || null,
            awardGuaranteed: false, asOf
        };
    }
    function fundingForProgram(program, institution, fundingCatalog, applicant = null, options = {}) {
        checkedCatalog(fundingCatalog);
        if (program != null && !record(program) || institution != null && !record(institution) || applicant != null && !record(applicant)) throw Object.assign(new Error('Funding context must use objects or null.'), { code: 'INVALID_FUNDING_CONTEXT' });
        const asOf = asOfDate(options);
        return fundingCatalog.schemes.map(scheme => assess(program, institution, scheme, applicant, asOf));
    }
    function fundingForInstitution(institution, programs, fundingCatalog, applicant = null, options = {}) {
        checkedCatalog(fundingCatalog);
        if (!record(institution) || !Array.isArray(programs)) throw Object.assign(new Error('Institution and programme array are required.'), { code: 'INVALID_FUNDING_CONTEXT' });
        const asOf = asOfDate(options);
        const associated = programs.filter(program => record(program) && (program.institutionId && institution.id ? program.institutionId === institution.id : domainsFor(program, institution).programHost && domainsFor(program, institution).institutionHosts.some(host => hostMatches(domainsFor(program, institution).programHost, host) || hostMatches(host, domainsFor(program, institution).programHost))));
        if (applicant != null && !record(applicant)) throw Object.assign(new Error('Applicant must be an object or null.'), { code: 'INVALID_FUNDING_CONTEXT' });
        const assessments = associated.map(program => fundingCatalog.schemes.map(scheme => assess(program, institution, scheme, applicant, asOf)));
        if (!assessments.length) return fundingForProgram(null, institution, fundingCatalog, applicant, { asOf }).map(result => ({ ...result, associatedProgramIds: [], appliesToAllPrograms: false, aggregate: true }));
        const priority = { listed: 0, potential: 1, 'needs-verification': 2, ineligible: 3 };
        return fundingCatalog.schemes.map((scheme, index) => {
            const results = assessments.map(items => items[index]);
            const best = [...results].sort((left, right) => priority[left.status] - priority[right.status])[0];
            return { ...best, programId: null, associatedProgramIds: results.filter(result => result.associationStatus === 'listed' && result.status !== 'ineligible').map(result => result.programId), appliesToAllPrograms: false, aggregate: true,
                programAssessments: results.map(({ programId, status, callStatus, eligibilityStatus }) => ({ programId, status, callStatus, eligibilityStatus })) };
        });
    }
    return Object.freeze({ STATUSES, validateFundingCatalog, fundingForProgram, fundingForInstitution });
}));
