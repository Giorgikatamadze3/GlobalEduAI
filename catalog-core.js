(function (root, factory) {
    'use strict';
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.CatalogCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Geographic groupings describe directory coverage, not admission or visa rules.
    const REGION_CODES = {
        europe:'AL AD AT AX BA BE BG BY CH CZ DE DK EE ES FI FO FR GB GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SJ SK SM UA VA XK',
        'north-america':'AG AI AW BB BL BM BQ BS BZ CA CR CU CW DM DO GD GL GP GT HN HT JM KN KY LC MF MQ MS MX NI PA PM PR SV SX TC TT US VC VG VI',
        'south-america':'AR BO BR CL CO EC FK GF GY PE PY SR UY VE',
        asia:'AE AF AM AZ BD BH BN BT CC CN CX CY GE HK ID IL IN IO IQ IR JO JP KG KH KP KR KW KZ LA LB LK MM MN MO MV MY NP OM PH PK PS QA SA SG SY TH TJ TL TM TR TW UZ VN YE',
        africa:'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG EH ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SH SL SN SO SS ST SZ TD TF TG TN TZ UG YT ZA ZM ZW',
        oceania:'AS AU CK FJ FM GU KI MH MP NC NF NR NU NZ PF PG PN PW SB TK TO TV UM VU WF WS',
        other:'AQ BV GS HM'
    };
    const COUNTRY_OVERRIDES = {
        US:'აშშ',GB:'დიდი ბრიტანეთი',GE:'საქართველო',DE:'გერმანია',IT:'იტალია',CA:'კანადა',NL:'ნიდერლანდები',BE:'ბელგია',EE:'ესტონეთი',FR:'საფრანგეთი',ES:'ესპანეთი',PT:'პორტუგალია',AT:'ავსტრია',CH:'შვეიცარია',IE:'ირლანდია',DK:'დანია',SE:'შვედეთი',NO:'ნორვეგია',FI:'ფინეთი',IS:'ისლანდია',PL:'პოლონეთი',CZ:'ჩეხეთი',HU:'უნგრეთი',GR:'საბერძნეთი',CY:'კვიპროსი',MT:'მალტა',RO:'რუმინეთი',BG:'ბულგარეთი',HR:'ხორვატია',SI:'სლოვენია',SK:'სლოვაკეთი',LT:'ლიტვა',LV:'ლატვია',LU:'ლუქსემბურგი',TR:'თურქეთი',AM:'სომხეთი',AZ:'აზერბაიჯანი',UA:'უკრაინა',MD:'მოლდოვა',RS:'სერბეთი',ME:'მონტენეგრო',AL:'ალბანეთი',MK:'ჩრდილოეთ მაკედონია',BA:'ბოსნია და ჰერცეგოვინა',AU:'ავსტრალია',NZ:'ახალი ზელანდია',JP:'იაპონია',KR:'სამხრეთ კორეა',CN:'ჩინეთი',TW:'ტაივანი',HK:'ჰონკონგი',SG:'სინგაპური',IN:'ინდოეთი',MY:'მალაიზია',TH:'ტაილანდი',ID:'ინდონეზია',VN:'ვიეტნამი',PH:'ფილიპინები',AE:'არაბთა გაერთიანებული საამიროები',QA:'კატარი',SA:'საუდის არაბეთი',IL:'ისრაელი',ZA:'სამხრეთ აფრიკა',EG:'ეგვიპტე',MA:'მაროკო',NG:'ნიგერია',KE:'კენია',GH:'განა',BR:'ბრაზილია',AR:'არგენტინა',CL:'ჩილე',CO:'კოლუმბია',PE:'პერუ',MX:'მექსიკა',CR:'კოსტა-რიკა',XK:'კოსოვო'
    };
    let georgianNames, englishNames, russianNames;
    try { georgianNames = new Intl.DisplayNames(['ka'], {type:'region'}); englishNames = new Intl.DisplayNames(['en'], {type:'region'}); russianNames=new Intl.DisplayNames(['ru'],{type:'region'}); } catch (_) { /* Stable fallback labels remain available. */ }
    const COUNTRIES = {};
    Object.entries(REGION_CODES).forEach(([region, codes]) => codes.split(' ').forEach(code => {
        const english = englishNames ? englishNames.of(code) : code;
        COUNTRIES[code] = Object.freeze({code, name:COUNTRY_OVERRIDES[code] || (georgianNames ? georgianNames.of(code) : english), nameEnglish:english, region});
    }));
    Object.freeze(COUNTRIES);
    const REGIONS = Object.freeze([
        {value:'europe',label:'ევროპა'}, {value:'north-america',label:'ჩრდილოეთ ამერიკა'}, {value:'south-america',label:'სამხრეთ ამერიკა'},
        {value:'asia',label:'აზია'}, {value:'africa',label:'აფრიკა'}, {value:'oceania',label:'ოკეანეთი'}, {value:'other',label:'სხვა'}
    ]);
    const DEGREES = Object.freeze([{value:'bachelor',label:'ბაკალავრიატი'},{value:'master',label:'მაგისტრატურა'},{value:'phd',label:'დოქტორანტურა'}]);
    const LANGUAGES = Object.freeze([
        {value:'en',label:'ინგლისური'},{value:'de',label:'გერმანული'},{value:'it',label:'იტალიური'},{value:'fr',label:'ფრანგული'},{value:'es',label:'ესპანური'},
        {value:'pt',label:'პორტუგალიური'},{value:'nl',label:'ნიდერლანდური'},{value:'sv',label:'შვედური'},{value:'fi',label:'ფინური'},{value:'pl',label:'პოლონური'},
        {value:'cs',label:'ჩეხური'},{value:'tr',label:'თურქული'},{value:'ja',label:'იაპონური'},{value:'ko',label:'კორეული'},{value:'zh',label:'ჩინური'},{value:'ka',label:'ქართული'}
    ]);
    const FIELDS = Object.freeze([
        {value:'tech',label:'ტექნოლოგიები და ინჟინერია'}, {value:'business',label:'ბიზნესი და მენეჯმენტი'}, {value:'arts',label:'ხელოვნება, დიზაინი და ჰუმანიტარული მეცნიერებები'},
        {value:'social',label:'სამართალი და სოციალური მეცნიერებები'}, {value:'medicine',label:'მედიცინა და ჯანდაცვა'}, {value:'science',label:'საბუნებისმეტყველო მეცნიერებები'}, {value:'hospitality',label:'ტურიზმი და სხვა სპეციალიზებული მიმართულებები'}
    ]);
    const SUBFIELDS = Object.freeze([
        {value:'computer-science',label:'კომპიუტერული მეცნიერებები',category:'tech'},
        {value:'artificial-intelligence',label:'ხელოვნური ინტელექტი',category:'tech'},
        {value:'data-science',label:'მონაცემთა მეცნიერება',category:'tech'},
        {value:'cybersecurity',label:'კიბერუსაფრთხოება',category:'tech'},
        {value:'software-engineering',label:'პროგრამული ინჟინერია',category:'tech'},
        {value:'engineering',label:'ინჟინერია',category:'tech'},
        {value:'business',label:'ბიზნესი',category:'business'},
        {value:'management',label:'მენეჯმენტი',category:'business'},
        {value:'finance',label:'ფინანსები',category:'business'},
        {value:'marketing',label:'მარკეტინგი',category:'business'},
        {value:'economics',label:'ეკონომიკა',category:'business'},
        {value:'social-sciences',label:'სოციალური მეცნიერებები და საჯარო პოლიტიკა',category:'social'},
        {value:'public-policy',label:'საჯარო პოლიტიკა',category:'social'},
        {value:'law',label:'სამართალი',category:'social'},
        {value:'design',label:'დიზაინი',category:'arts'},
        {value:'architecture',label:'არქიტექტურა',category:'arts'},
        {value:'humanities',label:'ჰუმანიტარული მეცნიერებები',category:'arts'},
        {value:'medicine',label:'მედიცინა',category:'medicine'},
        {value:'healthcare',label:'ჯანდაცვა',category:'medicine'},
        {value:'natural-sciences',label:'საბუნებისმეტყველო მეცნიერებები',category:'science'},
        {value:'biology',label:'ბიოლოგია',category:'science'},
        {value:'physics',label:'ფიზიკა',category:'science'},
        {value:'mathematics',label:'მათემატიკა',category:'science'},
        {value:'hospitality',label:'ტურიზმი და სტუმარმასპინძლობა',category:'hospitality'}
    ]);
    const EU_COUNTRIES = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '));
    const EEA_AND_SWISS = new Set(['NO','IS','LI','CH']);
    const CEFR = ['A1','A2','B1','B2','C1','C2'];
    const TEST_SECTIONS = ['reading','listening','speaking','writing'];
    let CURRENCIES;
    try { CURRENCIES = new Set(Intl.supportedValuesOf('currency')); } catch (_) { CURRENCIES = null; }
    const SEARCH_CACHE = new WeakMap();
    const fieldAliases = {
        tech:['technology & engineering','it & computer science','technology','engineering','ტექნოლოგიები და ინჟინერია'],
        business:['business & management','ბიზნესი და მენეჯმენტი'],
        arts:['arts, humanities & design','arts & design','ხელოვნება და დიზაინი'],
        social:['law & social sciences','სამართალი და სოციალური მეცნიერებები'],
        medicine:['medicine & healthcare','medicine & sciences','მედიცინა და ჯანდაცვა'],
        science:['natural sciences','საბუნებისმეტყველო მეცნიერებები'],
        hospitality:['hospitality & specialized','ტურიზმი']
    };

    function text(value) { return typeof value === 'string' ? value.trim() : ''; }
    function canonical(value) { return text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
    function numberOrNull(value) { if (!['number','string'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
    function provided(value) { return value !== null && value !== undefined && !(typeof value === 'string' && !value.trim()); }
    function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
    function testFamily(name) { const key = canonical(name); return key.startsWith('ielts') ? 'ielts' : key.startsWith('toefl') ? 'toefl' : ''; }
    function normalizedTestScale(value, family) {
        const key = canonical(typeof value === 'number' ? String(value) : value);
        if (family === 'ielts') return !key || ['0 9','9','ielts','ielts 9'].includes(key) ? '0-9' : 'unknown';
        if (family === 'toefl') {
            if (['0 120','120','legacy','legacy 120'].includes(key)) return '0-120';
            if (['1 6','6','new','2026','new 6'].includes(key)) return '1-6';
        }
        return key ? 'unknown' : '';
    }
    // Score scales are deliberately not converted. ETS introduced 1–6 in 2026:
    // https://www.eu.ets.org/toefl/test-takers/ibt/scores/understand-scores.html
    // IELTS uses whole and half bands: https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail
    function checkedTestScore(name, rawValue, scaleHint, component = false) {
        const family = testFamily(name), value = numberOrNull(rawValue);
        let scale = normalizedTestScale(scaleHint,family);
        if (!provided(rawValue)) return {value:null,scale,issue:null};
        if (value === null) return {value:null,scale,issue:'ენის ტესტის ქულა რიცხვით მიუთითე.'};
        if (!family || scale === 'unknown') return {value:null,scale:'unknown',issue:'ენის ტესტის ქულის სკალა დასაზუსტებელია; ავტომატური შედარება შეუძლებელია.'};
        if (family === 'toefl' && !scale) {
            if (value >= 1 && value <= 6) return {value:null,scale:'unknown',issue:'TOEFL-ის 1–6 ქულა სკალის მითითების გარეშე ორაზროვანია; მიუთითე 0–120 ან 1–6 სკალა.'};
            scale = '0-120';
        }
        const min = scale === '1-6' ? 1 : 0;
        const max = scale === '0-9' ? 9 : scale === '1-6' ? 6 : component ? 30 : 120;
        const step = scale === '0-120' ? 1 : 0.5;
        if (value < min || value > max || Math.abs(value / step - Math.round(value / step)) > 1e-8) {
            return {value:null,scale,issue:`${name}: ${component ? 'კომპონენტის' : 'საერთო'} ქულა უნდა იყოს ${min}–${max}, ბიჯით ${step}.`};
        }
        return {value,scale,issue:null};
    }
    function normalizeLanguageTest(test, issues) {
        if (!isRecord(test)) { issues.push('ენის ტესტის მონაცემი უნდა შეიცავდეს სახელსა და ქულას.'); return null; }
        const name = canonical(test.name);
        if (!name) { issues.push('ენის ტესტის ზუსტი სახელი დასაზუსტებელია.'); return null; }
        const total = checkedTestScore(name,test.score,test.scoreScale ?? test.scale);
        if (total.issue) issues.push(total.issue);
        const scaleHint = total.scale || test.scoreScale || test.scale;
        const minimum = checkedTestScore(name,test.minComponentScore,scaleHint,true);
        if (minimum.issue) issues.push(minimum.issue);
        let components = null;
        if (provided(test.components)) {
            if (!isRecord(test.components)) issues.push('ენის ტესტის კომპონენტები მიუთითე სახელებისა და ქულების ობიექტად.');
            else {
                components = {};
                for (const [section,score] of Object.entries(test.components)) {
                    const normalizedSection = canonical(section);
                    if (!TEST_SECTIONS.includes(normalizedSection)) { issues.push('ენის ტესტის კომპონენტის სახელი უცნობია.'); continue; }
                    const checked = checkedTestScore(name,score,scaleHint,true);
                    components[normalizedSection] = checked.value;
                    if (checked.issue) issues.push(checked.issue);
                }
            }
        }
        if (minimum.value !== null && total.value !== null) {
            const minimumPossibleTotal = total.scale === '0-120' ? minimum.value * 4 : minimum.value;
            if (minimumPossibleTotal > total.value) issues.push('კომპონენტის მინიმალური ქულა საერთო ქულასთან წინააღმდეგობაშია.');
        }
        if (total.value !== null && components && TEST_SECTIONS.every(section => components[section] !== null && components[section] !== undefined)) {
            const sum = TEST_SECTIONS.reduce((totalScore,section) => totalScore + components[section],0);
            const calculated = total.scale === '0-120' ? sum : Math.round((sum / 4) * 2) / 2;
            if (Math.abs(calculated - total.value) > 1e-8) issues.push('ენის ტესტის კომპონენტების ქულები საერთო ქულას არ შეესაბამება.');
        }
        return {name,score:total.value,scoreScale:total.scale,components,minComponentScore:minimum.value};
    }
    function countryInfo(code, fallback = '') {
        const normalized = text(code).toUpperCase();
        return COUNTRIES[normalized] || {code:normalized,name:fallback || normalized,nameEnglish:fallback || normalized,region:'other'};
    }
    function countryCode(value) {
        const candidate = text(value); if (!candidate || candidate === 'any' || candidate === 'ნებისმიერი') return '';
        const upper = candidate.toUpperCase(); if (COUNTRIES[upper]) return upper;
        const key = canonical(candidate);
        const match = Object.values(COUNTRIES).find(country => [country.name,country.nameEnglish].some(name => canonical(name) === key));
        return match ? match.code : upper;
    }
    function normalizeDegree(value) {
        const key = canonical(value);
        return ({bachelor:'bachelor',bachelors:'bachelor','ბაკალავრიატი':'bachelor',undergraduate:'bachelor',master:'master',masters:'master','მაგისტრატურა':'master',postgraduate:'master',phd:'phd',doctorate:'phd','დოქტორანტურა':'phd'})[key] || key;
    }
    function normalizeLanguage(value) {
        const key = canonical(value);
        const found = LANGUAGES.find(lang => canonical(lang.label) === key || lang.value === key);
        return found ? found.value : ({english:'en',german:'de',italian:'it',french:'fr',spanish:'es',portuguese:'pt',dutch:'nl',georgian:'ka',japanese:'ja',korean:'ko',chinese:'zh'})[key] || key;
    }
    function normalizeField(value) {
        const key = canonical(value); if (!key) return '';
        for (const [category, aliases] of Object.entries(fieldAliases)) if (key === category || aliases.some(alias => canonical(alias) === key)) return category;
        return key;
    }
    function subjectKey(value) { return canonical(value).replace(/ /g,'-'); }
    function selectedMany(values, scalar) { return values && values.length ? values : provided(scalar) ? [scalar] : []; }
    function normalizePreferences(input = {}) {
        const malformed = !isRecord(input); if (malformed) input = {};
        const issues = Array.isArray(input.issues) ? input.issues.filter(issue => typeof issue === 'string') : [];
        if (malformed) issues.push('შერჩევის პირობები ობიექტის სახით უნდა იყოს მოცემული.');
        const numeric = (value,label) => { const number = numberOrNull(value); if (provided(value) && number === null) issues.push(`${label}: მიუთითე ვალიდური რიცხვი.`); return number; };
        const enumIssue = (raw,value,allowed,label) => { if (provided(raw) && (typeof raw !== 'string' || !allowed.includes(value))) issues.push(`${label}: აირჩიე მხარდაჭერილი მნიშვნელობა.`); };
        let budget = numeric(input.budget ?? input.maxPrice,'ბიუჯეტი');
        if (budget !== null && budget < 0) { issues.push('ბიუჯეტი უარყოფითი ვერ იქნება.'); budget = null; }
        let gpaPercent = numeric(input.gpaPercent ?? input.gpa,'აკადემიური მოსწრება');
        if (gpaPercent !== null && (gpaPercent < 0 || gpaPercent > 100)) { issues.push('აკადემიური მოსწრება მიუთითე 0–100 პროცენტულ სკალაზე.'); gpaPercent = null; }
        let gpa4 = numeric(input.gpa4,'GPA');
        if (gpa4 !== null && (gpa4 < 0 || gpa4 > 4)) { issues.push('GPA მიუთითე 0–4 სკალაზე.'); gpa4 = null; }
        if (provided(input.gpa4) && provided(input.gpaPercent ?? input.gpa)) issues.push('აკადემიური მოსწრება მიუთითე მხოლოდ ერთ სკალაზე: GPA 0–4 ან ძველი პროცენტული მონაცემი.');
        let experienceYears = numeric(input.experienceYears,'სამუშაო გამოცდილება');
        if (experienceYears !== null && experienceYears < 0) { issues.push('გამოცდილების წლები უარყოფითი ვერ იქნება.'); experienceYears = null; }
        const regionAliases = {usa:'north-america',uk:'europe','north america':'north-america','south america':'south-america',any:'','ნებისმიერი':''};
        const rawRegion = text(input.region).toLowerCase();
        const rawCountry = input.countryCode ?? input.country ?? (rawRegion === 'uk' ? 'GB' : '');
        if (provided(input.languageTests) && !Array.isArray(input.languageTests)) issues.push('ენის ტესტები სიის სახით მიუთითე.');
        const tests = Array.isArray(input.languageTests) ? [...input.languageTests] : provided(input.languageTest) ? [input.languageTest] : [];
        if (input.certName && input.certScore !== undefined) tests.push({name:input.certName,score:input.certScore});
        const languageTests = tests.map(test => normalizeLanguageTest(test,issues)).filter(Boolean);
        const specifiedFunding = typeof input.requiresFullFunding === 'boolean' ? input.requiresFullFunding : null;
        if (provided(input.requiresFullFunding) && specifiedFunding === null) issues.push('სრული დაფინანსების მოთხოვნა მიუთითე true ან false მნიშვნელობით.');
        const selectedCountry = countryCode(rawCountry), citizenshipCode = countryCode(input.citizenshipCode ?? input.citizenship);
        const region = regionAliases[rawRegion] ?? rawRegion, degree = normalizeDegree(input.degree), language = normalizeLanguage(input.language ?? input.lang), mode = text(input.mode).toLowerCase();
        const languageLevel = text(input.languageLevel ?? input.level).toUpperCase();
        const currency = text(input.currency || 'USD').toUpperCase();
        enumIssue(rawCountry,selectedCountry,['',...Object.keys(COUNTRIES)],'ქვეყანა');
        enumIssue(input.citizenshipCode ?? input.citizenship,citizenshipCode,['',...Object.keys(COUNTRIES)],'მოქალაქეობა');
        enumIssue(input.region,region,['',...REGIONS.map(option => option.value)],'რეგიონი');
        enumIssue(input.degree,degree,DEGREES.map(option => option.value),'აკადემიური საფეხური');
        enumIssue(input.language ?? input.lang,language,LANGUAGES.map(option => option.value),'სწავლების ენა');
        enumIssue(input.mode,mode,['full-time','part-time','online'],'სწავლის ფორმატი');
        enumIssue(input.languageLevel ?? input.level,languageLevel,CEFR,'ენის დონე');
        enumIssue(input.budgetPeriod,input.budgetPeriod,['year','program'],'ბიუჯეტის პერიოდი');
        if (provided(input.currency) && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(currency) || (CURRENCIES && !CURRENCIES.has(currency)))) issues.push('ვალუტა: მიუთითე მხარდაჭერილი ISO კოდი.');
        if (provided(input.field ?? input.major ?? input.category) && typeof (input.field ?? input.major ?? input.category) !== 'string') issues.push('მიმართულება ტექსტით მიუთითე.');
        if (provided(input.query ?? input.search) && typeof (input.query ?? input.search) !== 'string') issues.push('ძიების მოთხოვნა ტექსტით მიუთითე.');
        // Nonempty arrays intentionally override their scalar counterpart. Alternatives
        // in one dimension are OR-ed; independently selected dimensions are AND-ed.
        const filterIssues = Array.isArray(input.filterIssues) ? input.filterIssues.filter(issue => typeof issue === 'string') : [];
        const filterIssue = detail => { issues.push(detail); filterIssues.push(detail); };
        const many = (key, normalizer, allowed) => {
            if (!provided(input[key])) return [];
            if (!Array.isArray(input[key])) { filterIssue(`${key}: არჩევანი სიის სახით მიუთითე.`); return []; }
            const result=[];
            for(const raw of input[key]) {
                const value=normalizer(raw);
                if(typeof raw!=='string'||!value||!allowed.includes(value)) { filterIssue(`${key}: არჩევანში უცნობი მნიშვნელობაა.`); continue; }
                result.push(value);
            }
            return [...new Set(result)];
        };
        const countryCodes=many('countryCodes',countryCode,Object.keys(COUNTRIES));
        const regions=many('regions',value=>text(value).toLowerCase(),REGIONS.map(item=>item.value));
        const fields=many('fields',normalizeField,FIELDS.map(item=>item.value));
        const subjectFields=many('subjectFields',subjectKey,SUBFIELDS.map(item=>item.value));
        const degrees=many('degrees',normalizeDegree,DEGREES.map(item=>item.value));
        const languages=many('languages',normalizeLanguage,LANGUAGES.map(item=>item.value));
        const modes=many('modes',value=>text(value).toLowerCase(),['full-time','part-time','online']);
        const duration = key => {
            const value=numeric(input[key],key);
            if(value!==null && (value<0||value>1200)) { filterIssue(`${key}: ხანგრძლივობა მიუთითე 0–1200 თვეში.`); return null; }
            if(provided(input[key])&&value===null)filterIssues.push(`${key}: მიუთითე ვალიდური რიცხვი.`);
            return value;
        };
        const durationMinMonths=duration('durationMinMonths'),durationMaxMonths=duration('durationMaxMonths');
        if(durationMinMonths!==null&&durationMaxMonths!==null&&durationMinMonths>durationMaxMonths)filterIssue('ხანგრძლივობის მინიმუმი მაქსიმუმს აღემატება.');
        const booleanFilter = key => {
            if(provided(input[key])&&typeof input[key]!=='boolean')filterIssue(`${key}: აირჩიე true ან false.`);
            return input[key]===true;
        };
        const deadlines=text(input.deadlines)||'any';
        if(provided(input.deadlines)&&!['any','known-upcoming','within-30','within-90','unknown'].includes(deadlines))filterIssue('ვადების ფილტრის მნიშვნელობა უცნობია.');
        const dateFilter = key => {
            if(!provided(input[key]))return null;
            const date=isoDate(input[key]);
            if(!date)filterIssue(`${key}: თარიღი მიუთითე YYYY-MM-DD ფორმატით.`);
            return date;
        };
        const deadlineAfter=dateFilter('deadlineAfter'),deadlineBefore=dateFilter('deadlineBefore');
        if(deadlineAfter&&deadlineBefore&&deadlineAfter>deadlineBefore)filterIssue('განაცხადის ვადების მინიმუმი მაქსიმუმს აღემატება.');
        if(provided(input.intakeCycle)&&typeof input.intakeCycle!=='string')filterIssue('მიღების ციკლი ტექსტის სახით მიუთითე.');
        const intakeCycle=text(input.intakeCycle);
        const fundingScheme=text(input.fundingScheme);
        if(provided(input.fundingScheme)&&(typeof input.fundingScheme!=='string'||fundingScheme.length>100||!/^funding_[a-z0-9-]+$/.test(fundingScheme)))filterIssue('დაფინანსების სქემა: აირჩიე მხარდაჭერილი სქემის იდენტიფიკატორი.');
        const advanced={countryCodes,regions,fields,subjectFields,degrees,languages,modes,durationMinMonths,durationMaxMonths,deadlines,deadlineAfter,deadlineBefore,intakeCycle,fundingScheme};
        for(const key of ['tuitionKnownOnly','freeTuitionOnly','hasScholarships','sourceFreshOnly','hasPrograms','includeUnknownFees','includeExpired'])advanced[key]=booleanFilter(key);
        return {
            query:text(input.query ?? input.search), countryCode:selectedCountry, region,
            degree, field:normalizeField(input.field ?? input.major ?? input.category), language,
            mode, budget, currency, budgetPeriod:input.budgetPeriod === 'program' ? 'program' : 'year',
            requiresFullFunding:specifiedFunding === null ? budget === 0 : specifiedFunding,
            gpa4, gpaPercent, languageLevel, languageTests, experienceYears, citizenshipCode,
            priorDegree:text(input.priorDegree),priorSubject:text(input.priorSubject),degreeStatus:text(input.degreeStatus),academicUniversity:text(input.academicUniversity).slice(0,250),academicFaculty:text(input.academicFaculty).slice(0,250),studyGoal:text(input.studyGoal).slice(0,1500),
            ...advanced, filterIssues:[...new Set(filterIssues)], issues:[...new Set(issues)]
        };
    }

    // GPA and percentages describe different grading systems. Compare only a
    // published minimum on the supplied scale; never invent a conversion.
    function academicBackgroundComparison(program,preferences={}) {
        const prefs=normalizePreferences(preferences),rules=program.requirements?.academicBackground;
        if(!prefs.priorDegree&&!prefs.priorSubject&&!prefs.academicUniversity&&!prefs.academicFaculty)return [];
        const unknown=detail=>({status:'unknown',detail});
        if(!rules||!['bachelor','master','phd'].includes(rules.minimumDegree))return [unknown('აკადემიური ბექგრაუნდის ოფიციალური მოთხოვნები დასაზუსტებელია.')];
        const checks=[],levels=['high-school','bachelor','master','phd'];
        if(rules.minimumDegree){
            if(prefs.degreeStatus!=='completed'||!levels.includes(prefs.priorDegree))checks.push(unknown('ხარისხის დასრულება და დიპლომის შესაბამისობა გადასამოწმებელია.'));
            else checks.push({status:levels.indexOf(prefs.priorDegree)>=levels.indexOf(rules.minimumDegree)?'matched':'not-matched',detail:levels.indexOf(prefs.priorDegree)>=levels.indexOf(rules.minimumDegree)?'წინა ხარისხის საფეხური გამოქვეყნებულ მინიმუმს შეესაბამება.':'წინა ხარისხის საფეხური გამოქვეყნებულ მინიმუმს ვერ აკმაყოფილებს.'});
        }
        if(rules.preferredSubjects?.length){
            if(!prefs.priorSubject)checks.push(unknown('წინა განათლების მიმართულება მიუთითე.'));
            else if(rules.preferredSubjects.includes(prefs.priorSubject))checks.push({status:'matched',detail:'წინა განათლების მიმართულება უნივერსიტეტის დასახელებულ მიმართულებებს ემთხვევა.'});
            else checks.push(rules.otherFieldsConsidered?unknown('სხვა მიმართულების კანდიდატისთვის გავლილი საგნების ინდივიდუალური შეფასებაა საჭირო.'):{status:'not-matched',detail:'წინა განათლების მიმართულება გამოქვეყნებულ მოთხოვნას არ ემთხვევა.'});
        }
        if(rules.transcriptReviewRequired)checks.push(unknown('საჭიროა გავლილი საგნების, კრედიტებისა და დიპლომის ოფიციალური შემოწმება.'));
        return checks;
    }
    function academicComparison(program, preferences = {}) {
        const prefs = normalizePreferences(preferences), requirements = program?.requirements || {};
        if (prefs.gpa4 !== null && prefs.gpaPercent !== null) return {status:'unknown',student:null,minimum:null,scale:null,max:null,detail:'აკადემიური მოსწრება მიუთითე მხოლოდ ერთ სკალაზე: GPA 0–4 ან ძველი პროცენტული მონაცემი.'};
        const four = numberOrNull(requirements.gpaMin4), percent = numberOrNull(requirements.gpaMinPercent);
        const validFour = four !== null && four >= 0 && four <= 4;
        const validPercent = percent !== null && percent >= 0 && percent <= 100;
        const usesFour = prefs.gpa4 !== null;
        const student = usesFour ? prefs.gpa4 : prefs.gpaPercent;
        const scale = usesFour ? 4 : student !== null ? 100 : null;
        const minimum = usesFour ? validFour ? four : null : validPercent ? percent : null;
        if (student === null) return {status:'unknown',student:null,minimum:null,scale:null,max:null,detail:validFour||validPercent?'აკადემიურ მოთხოვნასთან შესადარებლად მიუთითე შენი GPA 0–4 სკალაზე.':'პროგრამის აკადემიური მინიმუმი და შეფასების სკალის შესაბამისობა დასაზუსტებელია.'};
        if (minimum === null) return {status:'unknown',student,minimum:null,scale,max:scale,detail:usesFour&&validPercent?'GPA 0–4 და პროგრამის პროცენტული მინიმუმი პირდაპირ არ შედარდება; ოფიციალური ეკვივალენტობა უნივერსიტეტთან გადაამოწმე.':!usesFour&&validFour?'პროცენტული მოსწრება და პროგრამის GPA 0–4 მინიმუმი პირდაპირ არ შედარდება; ოფიციალური ეკვივალენტობა უნივერსიტეტთან გადაამოწმე.':'პროგრამის აკადემიური მინიმუმი და შეფასების სკალის შესაბამისობა დასაზუსტებელია.'};
        const suffix = scale === 4 ? `${minimum} / 4 GPA` : `${minimum}%`;
        return {status:student < minimum?'below':'met',student,minimum,scale,max:scale,detail:student<minimum?`აკადემიური მოსწრება: მითითებული მინიმუმია ${suffix}.`:`აკადემიური მინიმუმი: მითითებული შედეგი აკმაყოფილებს ${suffix} გამოქვეყნებულ ზღვარს; დიპლომის ეკვივალენტობა უნივერსიტეტმა უნდა დაადასტუროს.`};
    }

    function migrateAcademicProfile(input) {
        const profile = isRecord(input) ? {...input} : {};
        if (!provided(profile.gpaPercent) && !provided(profile.gpa)) return {profile,migrated:false,requiresGpaEntry:false};
        const legacy = numberOrNull(profile.gpaPercent ?? profile.gpa);
        if (legacy !== null && legacy >= 0 && legacy <= 100) profile.legacyAcademicRecord = {gpaPercent:legacy,scale:100};
        delete profile.gpaPercent; delete profile.gpa;
        return {profile,migrated:true,requiresGpaEntry:!provided(profile.gpa4)};
    }

    function hostname(value) {
        try { const url = new URL(value); return ['http:','https:'].includes(url.protocol) ? url.hostname.toLowerCase().replace(/^www\./,'').replace(/\.$/,'') : ''; }
        catch (_) { return ''; }
    }
    function institutionDomains(institution) {
        return [...new Set([hostname(institution.website),...(Array.isArray(institution.domains) ? institution.domains.map(domain => hostname(`https://${domain}`)) : [])].filter(Boolean))];
    }
    function createInstitutionIndex(institutions) {
        const byId = new Map(), byName = new Map(), byDomain = new Map();
        const add = (map,key,value) => { if (!key) return; if (!map.has(key)) map.set(key,[]); map.get(key).push(value); };
        for (const institution of institutions) {
            if (!institution || typeof institution !== 'object') continue;
            byId.set(institution.id,institution); add(byName,canonical(institution.name),institution);
            for (const domain of institutionDomains(institution)) add(byDomain,domain,institution);
        }
        return {byId,byName,byDomain};
    }
    function resolveInstitution(program, institutions) {
        if (!program || !institutions) return null;
        const index = Array.isArray(institutions) ? createInstitutionIndex(institutions) : institutions;
        if (!(index.byId instanceof Map)) return null;
        if (program.institutionId) { const exact = index.byId.get(program.institutionId); if (exact) return exact; }
        const domain = hostname(program.institutionWebsite);
        const name = canonical(program.institutionName);
        const domains = domain ? index.byDomain.get(domain) || [] : [];
        const exactNamedDomain = name ? domains.filter(institution => canonical(institution.name) === name) : [];
        if (exactNamedDomain.length === 1) return exactNamedDomain[0];
        if (domains.length === 1) return domains[0];
        const names = name ? index.byName.get(name) || [] : [];
        return names.length === 1 ? names[0] : null;
    }
    function attachInstitutionPrograms(institutions, programs) {
        const links = new Map(institutions.map(institution => [institution.id,[]]));
        const index = createInstitutionIndex(institutions);
        const linkedPrograms = programs.map(program => {
            const institution = resolveInstitution(program,index);
            const linked = {...program,institutionId:institution ? institution.id : null};
            if (institution) links.get(institution.id).push(linked.id);
            return linked;
        });
        return {institutions:institutions.map(institution => ({...institution,programIds:links.get(institution.id),programCount:links.get(institution.id).length})), programs:linkedPrograms, unmatchedPrograms:linkedPrograms.filter(program => !program.institutionId)};
    }
    function searchInstitution(institution, query) {
        const tokens = canonical(query).split(' ').filter(Boolean); if (!tokens.length) return true;
        if (!institution || typeof institution !== 'object') return false;
        let haystack = SEARCH_CACHE.get(institution);
        if (!haystack) {
            const info = countryInfo(institution.countryCode,institution.countryEnglish);
            let russianCountry='';try{russianCountry=russianNames?.of(institution.countryCode)||'';}catch(_){/* Unknown source codes retain their original labels. */}
            haystack = canonical([institution.name,institution.country,institution.countryEnglish,info.name,info.nameEnglish,russianCountry,institution.countryCode,institution.city,institution.stateProvince,institution.website,...(institution.domains || [])].filter(Boolean).join(' '));
            SEARCH_CACHE.set(institution,haystack);
        }
        return tokens.every(token => haystack.includes(token));
    }
    function filterInstitutions(institutions, input = {}) {
        const prefs = normalizePreferences(input);
        if(prefs.filterIssues.length)return [];
        const countries=selectedMany(prefs.countryCodes,prefs.countryCode), regions=selectedMany(prefs.regions,prefs.region);
        return institutions.filter(institution => (!countries.length || countries.includes(institution.countryCode)) && (!regions.length || regions.includes(institution.region || countryInfo(institution.countryCode).region)) && searchInstitution(institution,prefs.query));
    }

    function isoDate(value) {
        const candidate = value instanceof Date ? (Number.isFinite(value.getTime()) ? value.toISOString().slice(0,10) : '') : text(value).slice(0,10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return null;
        const parsed = new Date(`${candidate}T00:00:00Z`);
        return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === candidate ? candidate : null;
    }
    function evaluationDate(value) {
        return isoDate(value) || new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    }
    const SUBJECT_TITLE_TERMS = {
        'computer-science':['computer science','informatics'], 'artificial-intelligence':['artificial intelligence'],
        'data-science':['data science'], cybersecurity:['cybersecurity','cyber security'],
        'software-engineering':['software engineering'], engineering:['engineering'], management:['management'],
        finance:['finance','financial'], marketing:['marketing'], economics:['economics'],
        'social-sciences':['social sciences'], 'public-policy':['public policy'], law:['law'], design:['design'],
        architecture:['architecture'], humanities:['humanities'], medicine:['medicine'], healthcare:['healthcare','health care'],
        biology:['biology'],physics:['physics'],mathematics:['mathematics'],hospitality:['hospitality','tourism']
    };
    function programSubjectFields(program) {
        const keys=new Set([subjectKey(program.field),...(Array.isArray(program.subjectFields)?program.subjectFields.map(subjectKey):[])].filter(Boolean));
        const title=` ${canonical(program.title)} `;
        for(const [key,phrases] of Object.entries(SUBJECT_TITLE_TERMS))if(phrases.some(phrase=>title.includes(` ${phrase} `)))keys.add(key);
        return [...keys];
    }
    function programCountries(program,institution) {
        return [...new Set((Array.isArray(program.countries)?program.countries:[program.countryCode||institution?.countryCode]).map(countryCode).filter(Boolean))];
    }
    function advancedProgramConstraints(program,prefs,options={}) {
        const missing=[],excluded=[],reasons=[];
        const pass=detail=>reasons.push(detail), fail=detail=>excluded.push(detail), unknown=detail=>missing.push(detail);
        const duration=numberOrNull(program.durationMonths);
        if(prefs.durationMinMonths!==null||prefs.durationMaxMonths!==null) {
            if(duration===null||duration<=0)unknown('პროგრამის ხანგრძლივობა დასაზუსტებელია.');
            else if((prefs.durationMinMonths!==null&&duration<prefs.durationMinMonths)||(prefs.durationMaxMonths!==null&&duration>prefs.durationMaxMonths))fail('პროგრამის ხანგრძლივობა არჩეულ დიაპაზონს არ შეესაბამება.');
            else pass('პროგრამის ხანგრძლივობა: შენს დიაპაზონშია.');
        }
        const asOf=evaluationDate(options.asOf),deadline=program.deadline||{};
        const date=isoDate(typeof deadline==='string'?deadline:deadline.date);
        if(prefs.deadlines==='unknown') {
            if(date)fail('მიღების ვადა ცნობილია; არჩეულია მხოლოდ უცნობი ვადები.');
            else pass('მიღების ვადა: დასაზუსტებელი ჩანაწერია.');
        } else if(prefs.deadlines!=='any') {
            if(!date)unknown('არჩეული ვადების ფილტრისთვის ზუსტი თარიღი უცნობია.');
            else {
                const days=(new Date(`${date}T00:00:00Z`)-new Date(`${asOf}T00:00:00Z`))/86400000;
                const max=prefs.deadlines==='within-30'?30:prefs.deadlines==='within-90'?90:Infinity;
                if(days<0||days>max)fail('მიღების ვადა არჩეულ დროის ფანჯარაში არ არის.');
                else pass('მიღების ვადა: არჩეულ დროის ფანჯარაშია.');
            }
        }
        if(prefs.deadlineAfter||prefs.deadlineBefore) {
            if(!date)unknown('მიღების თარიღის დიაპაზონის შესამოწმებლად ვადა დასაზუსტებელია.');
            else if((prefs.deadlineAfter&&date<prefs.deadlineAfter)||(prefs.deadlineBefore&&date>prefs.deadlineBefore))fail('მიღების თარიღი შენს მიერ არჩეულ დიაპაზონს არ შეესაბამება.');
            else pass('მიღების თარიღი: არჩეულ დიაპაზონშია.');
        }
        if(prefs.intakeCycle) {
            const cycle=text(deadline.cycle);
            if(!cycle)unknown('პროგრამის მიღების ციკლი დასაზუსტებელია.');
            else if(cycle!==prefs.intakeCycle)fail('მიღების ციკლი არჩეულ ციკლს არ ემთხვევა.');
            else pass('მიღების ციკლი: ემთხვევა შენს არჩევანს.');
        }
        const tuition=program.tuition||{},amount=numberOrNull(tuition.amount);
        if(prefs.tuitionKnownOnly) {
            if(amount===null||amount<0||!text(tuition.currency)||!['year','program'].includes(tuition.period))unknown('მოთხოვნილია ცნობილი საფასური, მაგრამ თანხა/ვალუტა/პერიოდი დასაზუსტებელია.');
            else pass('სწავლის საფასური: წყაროში თანხა, ვალუტა და პერიოდი მითითებულია.');
        }
        if(prefs.freeTuitionOnly) {
            if(amount===null||amount<0)unknown('ნულოვანი სწავლის საფასური წყაროთი არ დასტურდება.');
            else if(amount!==0)fail('სწავლის საფასური ნულოვანი არ არის.');
            else pass('სწავლის საფასური: ნულოვანია; ცხოვრების ხარჯები ცალკეა.');
        }
        if(prefs.hasScholarships) {
            const listed=Array.isArray(program.funding?.scholarships)?program.funding.scholarships:[];
            if(!Array.isArray(program.funding?.scholarships))unknown('დადასტურებული სასტიპენდიო კავშირი წყაროთი დასაზუსტებელია.');
            else if(!listed.length)fail('ამ პროგრამისთვის სტიპენდიასთან დადასტურებული კავშირი მითითებული არ არის.');
            else pass('სტიპენდიასთან კავშირი წყაროთი აღწერილია; პირადი პირობები და კონკურსის ვადა ცალკე მოწმდება.');
        }
        if(prefs.fundingScheme) {
            const opportunities=program.funding?.opportunityIds;
            if(!Array.isArray(opportunities))unknown('ამ პროგრამის დაფინანსების სქემებთან კავშირი დასაზუსტებელია.');
            else if(!opportunities.includes(prefs.fundingScheme))fail('არჩეულ დაფინანსების სქემასთან კავშირი ამ პროგრამისთვის აღწერილი არ არის.');
            else pass('არჩეული დაფინანსების სქემა შესაძლო გზად არის მითითებული; ეს მიღებას, პირად შესაბამისობას ან დაფინანსების მინიჭებას არ ნიშნავს.');
        }
        if(prefs.sourceFreshOnly) {
            const sources=Array.isArray(program.sources)?program.sources:[];
            const dates=sources.map(source=>isoDate(source.checkedAt));
            if(!['official-source','official-directory'].includes(program.verificationStatus)||!sources.length||sources.some(source=>!hostname(source.url))||dates.some(date=>!date))unknown('ოფიციალური წყაროს სანდოობა ან შემოწმების თარიღი დასაზუსტებელია.');
            else {
                const cutoff=new Date(`${asOf}T00:00:00Z`)-365*86400000;
                if(dates.some(date=>date>asOf||new Date(`${date}T00:00:00Z`)<cutoff))fail('წყარო არჩეული სიახლის მოთხოვნას არ აკმაყოფილებს.');
                else pass('ოფიციალური წყარო: ბოლო 365 დღეშია შემოწმებული.');
            }
        }
        return {missing,excluded,reasons};
    }
    function basicProgramMatches(program,institution,prefs) {
        const any=(wanted,available)=>!wanted.length||wanted.some(value=>available.includes(value));
        const countries=programCountries(program,institution);
        const regionValues=countries.map(code=>countryInfo(code).region);
        const degree=normalizeDegree(program.degree),category=normalizeField(program.category);
        const languages=(Array.isArray(program.languages)?program.languages:[program.language]).map(normalizeLanguage).filter(Boolean);
        const fields=selectedMany(prefs.fields,prefs.field);
        const fieldMatch=!fields.length||fields.some(wanted=>FIELDS.some(item=>item.value===wanted)?category===wanted:[canonical(program.field),canonical(program.title)].some(value=>value===wanted||(wanted.length>=4&&value.includes(wanted))));
        return any(selectedMany(prefs.countryCodes,prefs.countryCode),countries)
            &&any(selectedMany(prefs.regions,prefs.region),regionValues)
            &&any(selectedMany(prefs.degrees,prefs.degree),[degree])&&fieldMatch
            &&any(prefs.subjectFields,programSubjectFields(program))
            &&any(selectedMany(prefs.languages,prefs.language),languages)
            &&any(selectedMany(prefs.modes,prefs.mode),[text(program.mode).toLowerCase()]);
    }
    function filterPrograms(programs,institutions,input={},options={}) {
        const prefs=normalizePreferences(input);
        if(prefs.filterIssues.length||prefs.issues.length)return [];
        const index=createInstitutionIndex(institutions),asOf=evaluationDate(options.asOf);
        return programs.filter(program=>{
            const institution=resolveInstitution(program,index);
            if(!institution||!basicProgramMatches(program,institution,prefs))return false;
            if(prefs.query) {
                const category=FIELDS.find(item=>item.value===program.category)?.label||'';
                const subjects=programSubjectFields(program).map(key=>SUBFIELDS.find(item=>item.value===key)?.label||key).join(' ');
                const search={...institution,name:[institution.name,program.title,program.field,category,subjects].join(' ')};
                if(!searchInstitution(search,prefs.query))return false;
            }
            const advanced=advancedProgramConstraints(program,prefs,{asOf});
            if(advanced.excluded.length||advanced.missing.length)return false;
            const deadline=isoDate(typeof program.deadline==='string'?program.deadline:program.deadline?.date);
            if(!prefs.includeExpired&&deadline&&deadline<asOf)return false;
            if(prefs.requiresFullFunding&&program.funding?.fullFunding!==true)return false;
            if(prefs.budget!==null&&!(prefs.requiresFullFunding&&program.funding?.fullFunding===true)) {
                const tuition=program.tuition||{},amount=numberOrNull(tuition.amount);
                const comparable=amount!==null&&amount>=0&&text(tuition.currency).toUpperCase()===prefs.currency&&(tuition.period===prefs.budgetPeriod||amount===0);
                if(!comparable)return prefs.includeUnknownFees;
                if(amount>prefs.budget)return false;
            }
            return true;
        });
    }
    function hasProgramFilters(prefs) {
        return selectedMany(prefs.fields,prefs.field).length||prefs.subjectFields.length||selectedMany(prefs.degrees,prefs.degree).length
            ||selectedMany(prefs.languages,prefs.language).length||selectedMany(prefs.modes,prefs.mode).length
            ||prefs.durationMinMonths!==null||prefs.durationMaxMonths!==null||prefs.deadlines!=='any'||prefs.deadlineAfter||prefs.deadlineBefore||prefs.intakeCycle
            ||prefs.budget!==null||prefs.requiresFullFunding||prefs.tuitionKnownOnly||prefs.freeTuitionOnly||prefs.hasScholarships||prefs.fundingScheme||prefs.sourceFreshOnly||prefs.hasPrograms;
    }
    function filterCatalogInstitutions(institutions,programs,input={},options={}) {
        const prefs=normalizePreferences(input);
        if(prefs.filterIssues.length)return [];
        const candidates=filterInstitutions(institutions,prefs);
        if(!hasProgramFilters(prefs))return candidates;
        const verified=programs.filter(program=>['official-source','official-directory'].includes(program.verificationStatus)&&Array.isArray(program.sources)&&program.sources.some(source=>hostname(source.url)));
        const linked=filterPrograms(verified,institutions,{...prefs,query:''},options);
        const index=createInstitutionIndex(institutions);
        const matching=new Set(linked.map(program=>resolveInstitution(program,index)?.id).filter(Boolean));
        return candidates.filter(institution=>matching.has(institution.id));
    }
    function evaluateProgram(program, input = {}, options = {}) {
        const prefs = normalizePreferences(input);
        const institution = options.institution || null;
        const asOf = evaluationDate(options.asOf);
        const reasons = [], warnings = [], missing = [...prefs.issues], exclusionReasons = [];
        let earned = 0, possible = 0;
        const missingDetail = (detail) => { if (!missing.includes(detail)) missing.push(detail); };
        const compare = (requested, available, label, weight, matcher = (a,b) => a === b) => {
            if (requested === '' || requested === null || requested === undefined || (Array.isArray(requested) && !requested.length)) return;
            possible += weight;
            if (available === '' || available === null || available === undefined || (Array.isArray(available) && !available.length)) { missingDetail(`${label}: პროგრამის მონაცემი დასაზუსტებელია.`); return; }
            if (matcher(requested,available)) { reasons.push(`${label}: ემთხვევა შენს არჩევანს.`); earned += weight; }
            else exclusionReasons.push(`${label}: არ ემთხვევა შენს არჩევანს.`);
        };
        const countries = [...new Set((Array.isArray(program.countries) ? program.countries : [program.countryCode || institution?.countryCode]).map(countryCode).filter(Boolean))];
        compare(selectedMany(prefs.countryCodes,prefs.countryCode),countries,'ქვეყანა',25,(wanted,available) => wanted.some(value=>available.includes(value)));
        const regions = countries.map(code => countryInfo(code).region);
        compare(selectedMany(prefs.regions,prefs.region),regions,'რეგიონი',15,(wanted,available) => wanted.some(value=>available.includes(value)));
        compare(selectedMany(prefs.degrees,prefs.degree),normalizeDegree(program.degree),'საფეხური',20,(wanted,available)=>wanted.includes(available));
        const field = normalizeField(program.category);
        compare(selectedMany(prefs.fields,prefs.field),[field,canonical(program.field),canonical(program.title)].filter(Boolean),'მიმართულება',25,(wanted,available) => wanted.some(choice=>FIELDS.some(option => option.value === choice) ? field === choice : available.some(value => value === choice || (choice.length >= 4 && value.includes(choice)))));
        compare(prefs.subjectFields,programSubjectFields(program),'სპეციალიზაცია',20,(wanted,available)=>wanted.some(value=>available.includes(value)));
        const languages = (Array.isArray(program.languages) ? program.languages : [program.language]).map(normalizeLanguage).filter(Boolean);
        compare(selectedMany(prefs.languages,prefs.language),languages,'სწავლების ენა',20,(wanted,available) => wanted.some(value=>available.includes(value)));
        compare(selectedMany(prefs.modes,prefs.mode),text(program.mode).toLowerCase(),'სწავლის ფორმატი',10,(wanted,available)=>wanted.includes(available));
        if (prefs.query) {
            const subjects=programSubjectFields(program).map(key=>SUBFIELDS.find(item=>item.value===key)?.label||key);
            const category=FIELDS.find(item=>item.value===program.category)?.label||'';
            const searchable={...(institution||{}),name:[program.title,program.field,program.institutionName,institution?.name,category,...subjects].filter(Boolean).join(' ')};
            compare(prefs.query,searchable,'ძიება',10,(wanted,available)=>searchInstitution(available,wanted));
        }

        const funding = program.funding || {};
        if (prefs.requiresFullFunding) {
            possible += 20;
            if (funding.fullFunding === true) { earned += 20; reasons.push('სრული დაფინანსება: წყაროში მითითებული შესაძლებლობა არსებობს; საჭიროა ცალკე პირობების შესრულება.'); warnings.push('სასტიპენდიო შესაძლებლობა არ ნიშნავს ავტომატურად მინიჭებულ დაფინანსებას.'); }
            else if (funding.fullFunding === false) exclusionReasons.push('სრული დაფინანსება: ამ პროგრამისთვის დადასტურებული შესაძლებლობა არ არის მითითებული.');
            else missingDetail('სრული დაფინანსების ხელმისაწვდომობა დასაზუსტებელია; უფასო სწავლა ცხოვრების ხარჯების დაფარვას არ ნიშნავს.');
        }
        const tuition = program.tuition || {};
        if (prefs.budget !== null && !(prefs.requiresFullFunding && funding.fullFunding === true)) {
            possible += 20;
            const amount = numberOrNull(tuition.amount);
            const priceCurrency = text(tuition.currency).toUpperCase();
            const period = text(tuition.period);
            let comparable = true;
            if (amount === null || amount < 0) { missingDetail('სწავლის საფასური დასაზუსტებელია; უცნობი ფასი ნულად არ ითვლება.'); comparable = false; }
            if (!priceCurrency || priceCurrency !== prefs.currency) { missingDetail(`ბიუჯეტის ვალუტა (${prefs.currency}) და საფასურის ვალუტა (${priceCurrency || 'უცნობი'}) პირდაპირ შესადარებელი არ არის.`); comparable = false; }
            if (!period || (period !== prefs.budgetPeriod && amount !== 0)) { missingDetail('საფასურის პერიოდი და ბიუჯეტის პერიოდი განსხვავდება ან უცნობია.'); comparable = false; }
            if (tuition.applicantScope && tuition.applicantScope !== 'all') {
                if (!prefs.citizenshipCode) { missingDetail('საფასურის შესაბამისობისთვის მოქალაქეობა მიუთითე.'); comparable = false; }
                else if (tuition.applicantScope === 'non-eu' && EU_COUNTRIES.has(prefs.citizenshipCode)) { missingDetail('მითითებული საფასური ეხება ევროკავშირის გარეთ მოქალაქეებს; შენი საფასური დასაზუსტებელია.'); comparable = false; }
                else if (tuition.applicantScope === 'international' && countries.includes(prefs.citizenshipCode)) { missingDetail('მითითებული საერთაშორისო საფასურის ნაცვლად ადგილობრივი საფასური დასაზუსტებელია.'); comparable = false; }
                else {
                    missingDetail(EEA_AND_SWISS.has(prefs.citizenshipCode)
                        ? 'EEA/შვეიცარიის მოქალაქისთვის საფასურის შეღავათები და რეზიდენტობის წესები დასაზუსტებელია.'
                        : 'საერთაშორისო საფასურის კატეგორია, რეზიდენტობის წესები და შესაძლო გამონაკლისები ინდივიდუალურად დასაზუსტებელია.');
                    comparable = false;
                }
                warnings.push('მოქალაქეობა მარტო ვერ ადგენს საფასურის საბოლოო კატეგორიას; რეზიდენტობამ ან გამონაკლისმა თანხა შეიძლება შეცვალოს.');
            }
            if (comparable) {
                if (amount <= prefs.budget) { earned += 20; reasons.push('სწავლის საფასური: თავსდება მითითებულ ბიუჯეტში.'); }
                else exclusionReasons.push('სწავლის საფასური: აღემატება მითითებულ ბიუჯეტს.');
                if (amount === 0) warnings.push('ნულოვანი სწავლის საფასური არ მოიცავს ავტომატურად საცხოვრებელს, დაზღვევას ან სხვა მოსაკრებლებს.');
            }
        }

        const requirements = program.requirements || {};
        const academic = academicComparison(program,prefs);
        for(const check of academicBackgroundComparison(program,prefs)){
            if(check.status==='unknown')missingDetail(check.detail);
            else if(check.status==='not-matched')exclusionReasons.push(check.detail);
            else reasons.push(check.detail);
        }
        if (academic.status === 'unknown') missingDetail(academic.detail);
        else if (academic.status === 'below') exclusionReasons.push(academic.detail);
        else reasons.push(academic.detail);
        const languageMinimum = text(requirements.languageLevel).toUpperCase();
        const test = requirements.languageTest;
        const acceptedTests = Array.isArray(requirements.languageTests) && requirements.languageTests.length ? requirements.languageTests : test ? [test] : [];
        if (!languageMinimum && !acceptedTests.length && requirements.languageProofRequired !== false) missingDetail('პროგრამის ენის ცოდნის ოფიციალური მოთხოვნა დასაზუსტებელია.');
        if (languageMinimum) {
            if (!CEFR.includes(languageMinimum)) missingDetail('ენის მოთხოვნის CEFR ეკვივალენტობა დასაზუსტებელია.');
            else if (!CEFR.includes(prefs.languageLevel)) missingDetail('ენის CEFR მოთხოვნასთან შესადარებლად მიუთითე შენი დონე.');
            else if (CEFR.indexOf(prefs.languageLevel) < CEFR.indexOf(languageMinimum)) exclusionReasons.push(`ენის დონე: მინიმალური მოთხოვნაა ${languageMinimum}.`);
            else reasons.push(`ენის დონე: მითითებული დონე ${languageMinimum} მინიმუმს შეესაბამება.`);
        }
        if (acceptedTests.length) {
            const routes = acceptedTests.map(requirement => {
                if (!isRecord(requirement) || !text(requirement.name)) return {status:'missing',provided:false,detail:'პროგრამის ენის ტესტის ოფიციალური მოთხოვნა დასაზუსტებელია.'};
                const minimum = checkedTestScore(requirement.name,requirement.minScore,requirement.scoreScale ?? requirement.scale);
                const submitted = prefs.languageTests.find(item => item.name === canonical(requirement.name));
                const attempted = Boolean(submitted);
                if (minimum.issue || minimum.value === null) return {status:'missing',provided:attempted,detail:'პროგრამის ენის ტესტის ქულის სკალა ან მინიმუმი დასაზუსტებელია.'};
                if (!submitted || submitted.score === null) return {status:'missing',provided:attempted,detail:'ენის ტესტის სახელი, მოქმედი შედეგი ან პროგრამის მინიმალური ქულა დასაზუსტებელია.'};
                if (submitted.scoreScale !== minimum.scale) return {status:'missing',provided:true,detail:'TOEFL-ის 1–6 და 0–120 სკალები პირდაპირ არ შედარდება; შესაბამისი ოფიციალური მოთხოვნა დასაზუსტებელია.'};
                if (submitted.score < minimum.value) return {status:'failed',provided:true,detail:'ენის ტესტი: წარმოდგენილი ქულა მიღებული ტესტის გამოქვეყნებულ საერთო მინიმუმზე დაბალია.'};
                const allSectionsRaw = requirement.componentsMinScore ?? requirement.minComponentScore;
                const sectionMinimums = isRecord(requirement.componentMinimums) ? requirement.componentMinimums
                    : provided(allSectionsRaw) ? Object.fromEntries(TEST_SECTIONS.map(section => [section,allSectionsRaw])) : {};
                let unknownSections = false;
                const sectionFailures = [];
                for (const [section,threshold] of Object.entries(sectionMinimums)) {
                    const required = checkedTestScore(requirement.name,threshold,minimum.scale,true);
                    const result = submitted.components?.[canonical(section)] ?? submitted.minComponentScore;
                    if (!TEST_SECTIONS.includes(canonical(section)) || required.issue || required.value === null || result === null || result === undefined) unknownSections = true;
                    else if (result < required.value) sectionFailures.push(`ენის ტესტის კომპონენტი (${section}): შედეგი ${required.value} მინიმუმზე დაბალია.`);
                }
                if (sectionFailures.length) return {status:'failed',provided:true,detail:sectionFailures.join(' ')};
                if (unknownSections) return {status:'missing',provided:true,detail:'ენის ტესტის ცალკეული კომპონენტების მინიმალური ქულების შესრულება დასაზუსტებელია.'};
                return {status:'passed',provided:true,requirement};
            });
            const successful = routes.find(route => route.status === 'passed');
            if (successful) reasons.push(`ენის ტესტი: ${successful.requirement.name} შედეგი შეესაბამება მითითებულ საერთო მინიმუმს${successful.requirement.componentMinimums || successful.requirement.componentsMinScore || successful.requirement.minComponentScore ? ' და კომპონენტების მოთხოვნებს' : ''}.`);
            else {
                const unknownAttempted = routes.filter(route => route.provided && route.status === 'missing');
                const failed = routes.filter(route => route.status === 'failed');
                if (unknownAttempted.length || !failed.length) (unknownAttempted.length ? unknownAttempted : routes.filter(route => route.status === 'missing')).forEach(route => missingDetail(route.detail));
                else failed.forEach(route => exclusionReasons.push(route.detail));
            }
            if (acceptedTests.some(item => isRecord(item) && (item.componentMinimums || item.componentsMinScore || item.minComponentScore || item.note))) warnings.push('შეამოწმე ენის ტესტის ცალკეული კომპონენტები, გამონაკლისები და მოქმედების ვადა.');
        }
        const experienceMinimum = numberOrNull(requirements.experienceYears);
        if (experienceMinimum === null && requirements.experienceRequired !== false) missingDetail('სამუშაო გამოცდილების მოთხოვნა დასაზუსტებელია.');
        if (experienceMinimum !== null && experienceMinimum > 0) {
            if (prefs.experienceYears === null) missingDetail('სამუშაო გამოცდილების მოთხოვნასთან შესადარებლად მიუთითე წლები.');
            else if (prefs.experienceYears < experienceMinimum) exclusionReasons.push(`სამუშაო გამოცდილება: საჭიროა მინიმუმ ${experienceMinimum} წელი.`);
            else reasons.push('სამუშაო გამოცდილება: მითითებულ მინიმუმს შეესაბამება.');
        }
        const eligibility = program.eligibility || requirements.eligibility || {};
        const allowedCitizenships = eligibility.citizenshipCodes || requirements.eligibleCitizenships;
        const excludedCitizenships = eligibility.excludedCitizenshipCodes || [];
        if (Array.isArray(allowedCitizenships) && allowedCitizenships.length) {
            if (!prefs.citizenshipCode) missingDetail('მოქალაქეობით მონაწილეობის უფლება დასაზუსტებელია.');
            else if (!allowedCitizenships.map(countryCode).includes(prefs.citizenshipCode)) exclusionReasons.push('მოქალაქეობა: პროგრამის მითითებულ მონაწილეთა სიას არ შეესაბამება.');
        }
        if (prefs.citizenshipCode && excludedCitizenships.map(countryCode).includes(prefs.citizenshipCode)) exclusionReasons.push('მოქალაქეობა: გამოქვეყნებული შეზღუდვა მოქმედებს.');
        if (eligibility.internationalApplicants === false && prefs.citizenshipCode && !countries.includes(prefs.citizenshipCode)) exclusionReasons.push('პროგრამა მითითებულია მხოლოდ ადგილობრივი აპლიკანტებისთვის.');
        if (eligibility.internationalApplicants !== true && !(Array.isArray(allowedCitizenships) && prefs.citizenshipCode && allowedCitizenships.map(countryCode).includes(prefs.citizenshipCode))) missingDetail('საერთაშორისო აპლიკანტის მონაწილეობის უფლება და წინა კვალიფიკაციის აღიარება უნივერსიტეტთან გადაამოწმე.');
        if (requirements.note) warnings.push(String(requirements.note));
        if (tuition.note) warnings.push(String(tuition.note));

        const deadline = program.deadline || {};
        const deadlineDate = isoDate(typeof deadline === 'string' ? deadline : deadline.date);
        if (deadlineDate && deadlineDate < asOf) exclusionReasons.push(`მიღების ვადა გასულია (${deadlineDate}).`);
        else if (deadlineDate === asOf) warnings.push('მიღების ბოლო დღე დღესაა; ზუსტი საათი და დროის სარტყელი გადაამოწმე.');
        else if (!deadlineDate && deadline.rolling !== true) missingDetail('მიმდინარე მიღების ვადა და სასწავლო ციკლი დასაზუსტებელია.');
        if (deadline.note) warnings.push(String(deadline.note));
        const sources = Array.isArray(program.sources) ? program.sources.filter(source => hostname(source.url)) : [];
        if (!['official-source','official-directory'].includes(program.verificationStatus) || !sources.length) missingDetail('პროგრამის ოფიციალური წყარო დასაზუსტებელია.');
        const dates = sources.map(source => isoDate(source.checkedAt)).filter(Boolean);
        if (sources.length && dates.length !== sources.length) missingDetail('ერთ-ერთი ოფიციალური წყაროს გადამოწმების თარიღი უცნობია.');
        if (dates.some(date => date > asOf)) missingDetail('წყაროს გადამოწმების თარიღი მომავალშია; მონაცემები ხელახლა გადაამოწმე.');
        const cutoff = new Date(`${asOf}T00:00:00Z`).getTime() - 365 * 24 * 60 * 60 * 1000;
        if (dates.some(date => new Date(`${date}T00:00:00Z`).getTime() < cutoff)) { missingDetail('წყაროს გადამოწმებიდან 365 დღეზე მეტია გასული.'); warnings.push('მონაცემებს განახლება სჭირდება.'); }
        if (!institution) missingDetail('პროგრამის უნივერსიტეტთან კავშირი დასაზუსტებელია.');
        const advanced=advancedProgramConstraints(program,prefs,{asOf});
        reasons.push(...advanced.reasons); missing.push(...advanced.missing); exclusionReasons.push(...advanced.excluded);
        const status = exclusionReasons.length ? 'excluded' : missing.length ? 'needs-verification' : 'matches';
        return {program,institution,status,reasons:[...new Set(reasons)],warnings:[...new Set(warnings)],missing:[...new Set(missing)],exclusionReasons:[...new Set(exclusionReasons)],score:possible ? Math.round(100 * earned / possible) : 0,scoreLabel:'პრეფერენციების შესაბამისობა',evaluatedAt:asOf};
    }
    function recommendPrograms(programs, institutions, input = {}, options = {}) {
        const prefs = normalizePreferences(input);
        const index = createInstitutionIndex(institutions);
        const results = programs.map(program => evaluateProgram(program,prefs,{...options,institution:resolveInstitution(program,index)}));
        const sort = (a,b) => b.score - a.score || a.missing.length - b.missing.length || text(a.program.title).localeCompare(text(b.program.title));
        const excluded = results.filter(result => result.status === 'excluded').sort(sort);
        return {matches:results.filter(result => result.status === 'matches').sort(sort),needsVerification:results.filter(result => result.status === 'needs-verification').sort(sort),excluded,excludedCount:excluded.length,totalPrograms:programs.length,preferences:prefs};
    }
    return Object.freeze({COUNTRIES,REGIONS,DEGREES,LANGUAGES,FIELDS,SUBFIELDS,countryInfo,normalizePreferences,academicBackgroundComparison,academicComparison,migrateAcademicProfile,createInstitutionIndex,resolveInstitution,attachInstitutionPrograms,searchInstitution,filterInstitutions,filterPrograms,filterCatalogInstitutions,hasProgramFilters,programSubjectFields,evaluateProgram,recommendPrograms});
}));
