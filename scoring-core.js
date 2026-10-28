(function (root, factory) {
    'use strict';
    const api = factory(typeof module === 'object' && module.exports ? require('./catalog-core') : root.CatalogCore);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AdmissionScoring = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core) {
    'use strict';
    if (!Core || typeof Core.evaluateProgram !== 'function') throw new Error('AdmissionScoring requires CatalogCore.');

    const WEIGHT_DEFINITIONS = Object.freeze([
        {key:'interests',label:'ინტერესები და საფეხური',description:'არჩეულ მიმართულებასთან, კონკრეტულ საგანთან და ხარისხთან შესაბამისობა.'},
        {key:'academics',label:'აკადემიური მზადყოფნა',description:'მოსწრებისა და გამოცდილების შედარება მხოლოდ გამოქვეყნებულ მინიმუმებთან.'},
        {key:'language',label:'ენა და სერტიფიკატი',description:'სწავლების ენა და ოფიციალური ენის მოთხოვნის შესრულება.'},
        {key:'budget',label:'ბიუჯეტი და დაფინანსება',description:'შედარებადი ვალუტა, საფასურის პერიოდი და დადასტურებული ფინანსური პირობები.'},
        {key:'location',label:'ქვეყანა და რეგიონი',description:'არჩეული ლოკაციებიდან ერთ-ერთთან შესაბამისობა.'},
        {key:'studyMode',label:'სწავლის ფორმატი',description:'ონლაინ, სრული ან ნაწილობრივი დატვირთვის არჩევანი.'},
        {key:'duration',label:'ხანგრძლივობა',description:'გამოქვეყნებული თვეების შესაბამისობა არჩეულ დიაპაზონთან.'},
        {key:'deadline',label:'განაცხადის ვადა',description:'ვადის ცნობილი თარიღი და არჩეულ პერიოდთან შესაბამისობა.'}
    ]);
    const freeze = value => Object.freeze(value);
    const DEFAULT_WEIGHTS = freeze({interests:25,academics:20,language:15,budget:15,location:10,studyMode:5,duration:5,deadline:5});
    const WEIGHT_PRESETS = freeze({
        balanced:DEFAULT_WEIGHTS,
        academic:freeze({interests:15,academics:35,language:20,budget:10,location:5,studyMode:5,duration:5,deadline:5}),
        budget:freeze({interests:15,academics:15,language:10,budget:35,location:10,studyMode:5,duration:5,deadline:5}),
        interests:freeze({interests:40,academics:15,language:10,budget:10,location:10,studyMode:5,duration:5,deadline:5})
    });
    const STATISTICS_POLICY = freeze({maxAgeDays:365,confidenceLevel:0.95,metric:'offers/applicants',personalProbabilityAvailable:false});
    const CEFR = ['A1','A2','B1','B2','C1','C2'];
    const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const text = value => typeof value === 'string' ? value.trim() : '';
    const canonical = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const present = value => value !== null && value !== undefined && !(typeof value === 'string' && !value.trim());
    const number = value => ['number','string'].includes(typeof value) && present(value) && Number.isFinite(Number(value)) ? Number(value) : null;
    const unique = values => [...new Set(values.filter(Boolean))];
    const rounded = value => Math.max(0,Math.min(100,Math.round(value)));
    function isoDate(value) {
        const s = value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString().slice(0,10) : text(value);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
        const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === s ? s : null;
    }
    function today() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
    function selected(prefs, arrayKey, scalarKey, normalize = canonical) {
        const values = Array.isArray(prefs[arrayKey]) && prefs[arrayKey].length ? prefs[arrayKey] : present(prefs[scalarKey]) ? [prefs[scalarKey]] : [];
        return unique(values.filter(value=>typeof value==='string').map(normalize));
    }
    function resolveWeights(preferences, options, issues) {
        const presetName = text(options.weightPreset || preferences.weightPreset || preferences.priorityPreset || 'balanced');
        const preset = WEIGHT_PRESETS[presetName] || DEFAULT_WEIGHTS;
        if (!WEIGHT_PRESETS[presetName]) issues.push('უცნობი პრიორიტეტების პროფილის ნაცვლად გამოყენებულია დაბალანსებული წონები.');
        const custom = options.weights ?? preferences.weights;
        const weights = {...preset};
        if (custom !== undefined) {
            if (!isRecord(custom)) issues.push('პრიორიტეტების წონები უნდა იყოს არაუარყოფითი რიცხვების ობიექტი.');
            else {
                for (const [key,value] of Object.entries(custom)) {
                    if (!(key in weights)) { issues.push(`უცნობი პრიორიტეტი: ${key}.`); continue; }
                    const n = number(value);
                    if (n === null || n < 0 || n > 1000) { issues.push(`${key}: წონა უნდა იყოს 0–1000 დიაპაზონში.`); continue; }
                    weights[key] = n;
                }
            }
        }
        let sum = Object.values(weights).reduce((total,value)=>total+value,0);
        if (!sum) { Object.assign(weights,DEFAULT_WEIGHTS); sum=100; issues.push('ყველა პრიორიტეტის წონა ნულოვანი იყო; გამოყენებულია დაბალანსებული წონები.'); }
        return Object.fromEntries(Object.entries(weights).map(([key,value])=>[key,100*value/sum]));
    }
    const match = (explanation,credit=1) => ({status:'matched',explanation,credit});
    const fail = explanation => ({status:'not-matched',explanation});
    const unknown = explanation => ({status:'unknown',explanation});
    function compareChoice(wanted, available, label) {
        if (!wanted.length) return null;
        if (!available.length) return unknown(`${label}: პროგრამის მონაცემი დასაზუსტებელია.`);
        return wanted.some(value=>available.includes(value)) ? match(`${label}: არჩეულ ვარიანტს ემთხვევა.`) : fail(`${label}: არჩეულ ვარიანტებს არ ემთხვევა.`);
    }
    function dateChecks(program,prefs,asOf) {
        const checks=[], policy=text(prefs.deadlines || prefs.deadlinePolicy || 'any'), date=isoDate(program.deadline?.date);
        const before=isoDate(prefs.deadlineBefore),after=isoDate(prefs.deadlineAfter);
        if (policy && policy !== 'any') {
            if (policy === 'unknown') checks.push(!date ? match('ვადა: არჩეულია კვლევა დასაზუსტებელი თარიღით.') : fail('ვადა: თარიღი გამოქვეყნებულია, ხოლო არჩეულია დასაზუსტებელი ვადები.'));
            else if (!date) checks.push(unknown('ვადა: კონკრეტული თარიღი დასაზუსტებელია.'));
            else {
                const days=Math.round((Date.parse(`${date}T00:00:00Z`)-Date.parse(`${asOf}T00:00:00Z`))/86400000);
                const maximum=policy==='within-30'?30:policy==='within-90'?90:policy==='known-upcoming'?Infinity:null;
                checks.push(maximum===null ? unknown('ვადის არჩეული პოლიტიკა უცნობია.') : days>=0&&days<=maximum ? match('განაცხადის ვადა არჩეულ პერიოდს შეესაბამება.') : fail('განაცხადის ვადა არჩეულ პერიოდს არ შეესაბამება.'));
            }
        }
        if (present(prefs.deadlineBefore) || present(prefs.deadlineAfter)) {
            if ((present(prefs.deadlineBefore)&&!before)||(present(prefs.deadlineAfter)&&!after)) checks.push(unknown('განაცხადის ვადის დიაპაზონი ვალიდური თარიღით მიუთითე.'));
            else if (!date) checks.push(unknown('დიაპაზონთან შესადარებელი განაცხადის თარიღი არ არის მითითებული.'));
            else checks.push((!before||date<=before)&&(!after||date>=after) ? match('განაცხადის თარიღი არჩეულ დიაპაზონშია.') : fail('განაცხადის თარიღი არჩეული დიაპაზონის გარეთაა.'));
        }
        return checks;
    }
    function buildChecks(program,institution,prefs,evaluation,asOf) {
        const checks=Object.fromEntries(WEIGHT_DEFINITIONS.map(def=>[def.key,[]]));
        const push=(key,value)=>{if(value)checks[key].push(value);};
        const countries=unique((Array.isArray(program.countries)?program.countries:[program.countryCode||institution?.countryCode]).map(value=>text(value).toUpperCase()));
        const regions=unique(countries.map(code=>Core.countryInfo(code).region));
        push('location',compareChoice(selected(prefs,'countryCodes','countryCode',value=>text(value).toUpperCase()),countries,'ქვეყანა'));
        push('location',compareChoice(selected(prefs,'regions','region',value=>text(value).toLowerCase()),regions,'რეგიონი'));
        const wantedFields=selected(prefs,'fields','field');
        const knownCategories=new Set(Core.FIELDS.map(option=>option.value));
        if(wantedFields.length){
            const category=canonical(program.category),subject=canonical(program.field);
            push('interests',!category&&!subject?unknown('ინტერესები: პროგრამის მიმართულება დასაზუსტებელია.') : wantedFields.some(field=>knownCategories.has(field)?category===field:subject===field)?match('მიმართულება ემთხვევა ერთ-ერთ შენს ინტერესს.'):fail('პროგრამის მიმართულება შენს არჩეულ ინტერესებს არ ემთხვევა.'));
        }
        push('interests',compareChoice(selected(prefs,'subjectFields','subjectField'),Core.programSubjectFields(program).map(canonical),'კონკრეტული საგანი'));
        push('interests',compareChoice(selected(prefs,'degrees','degree'),[canonical(program.degree)].filter(Boolean),'საფეხური'));
        if(prefs.query){
            const subjects=Core.programSubjectFields(program).map(key=>Core.SUBFIELDS.find(item=>item.value===key)?.label||key);
            const category=Core.FIELDS.find(item=>item.value===program.category)?.label||'';
            const searchable={...(institution||{}),name:[institution?.name,program.institutionName,program.title,program.field,program.category,category,...subjects].filter(Boolean).join(' ')};
            push('interests',Core.searchInstitution(searchable,prefs.query)?match('ძიების სიტყვები პროგრამის აღწერას ემთხვევა.'):fail('ძიების სიტყვები პროგრამის აღწერაში ვერ მოიძებნა.'));
        }
        const requirements=program.requirements||{};
        if(present(prefs.gpaPercent)){
            const student=number(prefs.gpaPercent),minimum=number(requirements.gpaMinPercent);
            push('academics',student===null||student<0||student>100?unknown('აკადემიური მოსწრების ვალიდური პროცენტული ქულა დასაზუსტებელია.') : minimum===null||minimum<0||minimum>100?unknown('პროგრამის პროცენტული აკადემიური მინიმუმი არ არის დადასტურებული.') : student>=minimum?match(`მოსწრება ${minimum}%-იან გამოქვეყნებულ მინიმუმს აკმაყოფილებს. ქულის აკადემიურ კომპონენტში მინიმუმის შესრულება იძლევა 60 ქულას; დარჩენილი 40 ასახავს სხვაობას 100%-მდე.`,minimum===100?1:0.6+0.4*(student-minimum)/(100-minimum)):fail(`მოსწრება ${minimum}%-იან გამოქვეყნებულ მინიმუმზე დაბალია.`));
        }
        if(present(prefs.experienceYears)){
            const student=number(prefs.experienceYears),minimum=number(requirements.experienceYears);
            push('academics',student===null||student<0?unknown('გამოცდილების წლების ვალიდური მნიშვნელობა დასაზუსტებელია.') : minimum===null||minimum<0?unknown('სამუშაო გამოცდილების გამოქვეყნებული მოთხოვნა დასაზუსტებელია.') : student>=minimum?match('სამუშაო გამოცდილება მითითებულ მინიმუმს აკმაყოფილებს.'):fail('სამუშაო გამოცდილება გამოქვეყნებულ მინიმუმს ვერ აკმაყოფილებს.'));
        }
        const languages=unique((Array.isArray(program.languages)?program.languages:[program.language]).map(canonical));
        push('language',compareChoice(selected(prefs,'languages','language'),languages,'სწავლების ენა'));
        if(present(prefs.languageLevel)||(Array.isArray(prefs.languageTests)&&prefs.languageTests.length)){
            const isLanguage=reason=>/ენის|ენას|ენა:|CEFR|IELTS|TOEFL|ტესტ|კომპონენტ/i.test(reason);
            const failures=evaluation.exclusionReasons.filter(isLanguage),missing=evaluation.missing.filter(isLanguage),success=evaluation.reasons.filter(isLanguage);
            push('language',failures.length?fail(failures[0]):missing.length?unknown(missing[0]):success.length?match('ენის ცოდნის წარმოდგენილი მონაცემები ცნობილ მოთხოვნებს შეესაბამება.'):requirements.languageProofRequired===false?match('პროგრამა დამატებით ენის მტკიცებულებას არ ითხოვს.'):unknown('ენის ცოდნის შედეგების შედარებისთვის პროგრამის მოთხოვნები დასაზუსტებელია.'));
        }
        push('studyMode',compareChoice(selected(prefs,'modes','mode'),[canonical(program.mode)].filter(Boolean),'სწავლის ფორმატი'));
        if(present(prefs.durationMinMonths)||present(prefs.durationMaxMonths)){
            const minimum=number(prefs.durationMinMonths),maximum=number(prefs.durationMaxMonths),duration=number(program.durationMonths);
            push('duration',(present(prefs.durationMinMonths)&&(minimum===null||minimum<0))||(present(prefs.durationMaxMonths)&&(maximum===null||maximum<0))||(minimum!==null&&maximum!==null&&minimum>maximum)?unknown('ხანგრძლივობის არჩეული დიაპაზონი ვალიდური არ არის.') : duration===null||duration<=0?unknown('პროგრამის ზუსტი ხანგრძლივობა დასაზუსტებელია.') : (minimum===null||duration>=minimum)&&(maximum===null||duration<=maximum)?match('სწავლის ხანგრძლივობა არჩეულ დიაპაზონშია.'):fail('სწავლის ხანგრძლივობა არჩეული დიაპაზონის გარეთაა.'));
        }
        checks.deadline.push(...dateChecks(program,prefs,asOf));
        const tuition=program.tuition||{},amount=number(tuition.amount),budget=number(prefs.budget);
        if(present(prefs.budget)){
            if(budget===null||budget<0)push('budget',unknown('ბიუჯეტის ვალიდური თანხა დასაზუსტებელია.'));
            else if(prefs.requiresFullFunding&&program.funding?.fullFunding===true)push('budget',unknown('სასტიპენდიო შესაძლებლობა არსებობს; სტუდენტისთვის საბოლოო დაფინანსების მინიჭება და დარჩენილი ხარჯი დასაზუსტებელია.'));
            else if(amount===null||amount<0)push('budget',unknown('უცნობი საფასური ნულოვან ფასად არ ითვლება.'));
            else if(text(tuition.currency).toUpperCase()!==text(prefs.currency).toUpperCase())push('budget',unknown('საფასურისა და ბიუჯეტის ვალუტა განსხვავდება; კონვერტაცია არ ხდება.'));
            else if(tuition.period!==(prefs.budgetPeriod||'year')&&amount!==0)push('budget',unknown('საფასურისა და ბიუჯეტის პერიოდი განსხვავდება; თანხა ავტომატურად არ იყოფა.'));
            else if(tuition.applicantScope!=='all')push('budget',unknown('საფასურის კატეგორია, რეზიდენტობა და შესაძლო შეღავათი ინდივიდუალურად დასაზუსტებელია.'));
            else push('budget',amount<=budget?match('გამოქვეყნებული სწავლის საფასური შენს ბიუჯეტში თავსდება.'):fail('გამოქვეყნებული სწავლის საფასური შენს ბიუჯეტს აღემატება.'));
        }
        if(prefs.requiresFullFunding)push('budget',program.funding?.fullFunding===true?match('სრული დაფინანსების გამოქვეყნებული შესაძლებლობა არსებობს; მინიჭება გარანტირებული არ არის.'):program.funding?.fullFunding===false?fail('დადასტურებულია, რომ სრული დაფინანსების შესაძლებლობა არ არის.'):unknown('სრული დაფინანსება არ არის დადასტურებული; უფასო სწავლა მას არ უდრის.'));
        if(prefs.freeTuitionOnly)push('budget',amount===null?unknown('უფასო სწავლა არ არის დადასტურებული.'):amount===0?match('გამოქვეყნებული სწავლის საფასურია ნული; სხვა ხარჯები დამატებითია.'):fail('გამოქვეყნებული სწავლის საფასური ნულოვანი არ არის.'));
        if(prefs.tuitionKnownOnly)push('budget',amount===null?unknown('ცნობილი საფასური არ არის გამოქვეყნებული.'):match('სწავლის საფასურის თანხა გამოქვეყნებულია.'));
        if(prefs.hasScholarships)push('budget',Array.isArray(program.funding?.scholarships)&&program.funding.scholarships.length?match('პროგრამის ჩანაწერში სასტიპენდიო შესაძლებლობა აღწერილია; მინიჭება გარანტირებული არ არის.'):program.funding?.scholarshipsVerified===true?fail('დადასტურებულ ჩანაწერში სტიპენდია არ არის მითითებული.'):unknown('პროგრამის სტიპენდიის ხელმისაწვდომობა დასაზუსტებელია.'));
        return checks;
    }
    function sourceHost(value) {
        try { const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.hostname.toLowerCase().replace(/^www\./,''):null; }
        catch(_){return null;}
    }
    function validateStats(record,program,options={}) {
        const errors=[],warnings=[];
        const asOf=isoDate(options.asOf)||today(),maximum=number(options.maxAgeDays)??STATISTICS_POLICY.maxAgeDays;
        if(!isRecord(record))return {valid:false,errors:['მიღების სტატისტიკა ობიექტის სახით უნდა იყოს მოცემული.'],warnings};
        if(!program||record.programId!==program.id)errors.push('სტატისტიკა ამ კონკრეტულ პროგრამას არ უკავშირდება.');
        if(!Number.isSafeInteger(record.applicants)||record.applicants<=0)errors.push('განაცხადების რაოდენობა დადებითი მთელი რიცხვი უნდა იყოს.');
        if(!Number.isSafeInteger(record.offers)||record.offers<0||record.offers>record.applicants)errors.push('შეთავაზებები უნდა იყოს მთელი რიცხვი 0-დან განაცხადების რაოდენობამდე.');
        if(!/(?:19|20)\d{2}/.test(text(record.cycle))||record.populationScope!=='program')errors.push('საჭიროა ამ კონკრეტული პროგრამის ციკლი და კოჰორტა; მთელი უნივერსიტეტის მაჩვენებელი არ გამოიყენება.');
        if(record.verificationStatus!=='official-source')errors.push('სტატისტიკის ოფიციალური წყარო არ არის დადასტურებული.');
        const host=sourceHost(record.sourceUrl),base=sourceHost(program?.institutionWebsite),date=isoDate(record.checkedAt);
        if(!host||!base||!(host===base||host.endsWith(`.${base}`)))errors.push('სტატისტიკის წყარო უნდა იყოს შესაბამისი უნივერსიტეტის დომენზე.');
        if(!date)errors.push('სტატისტიკის შემოწმების თარიღი არასწორია.');
        else {
            const age=(Date.parse(`${asOf}T00:00:00Z`)-Date.parse(`${date}T00:00:00Z`))/86400000;
            if(age<0)errors.push('სტატისტიკის შემოწმების თარიღი მომავალშია.');
            if(maximum<0||age>maximum)errors.push('სტატისტიკის წყაროს შემოწმება მოძველებულია.');
        }
        const cycleYear=Number(text(record.cycle).match(/(?:19|20)\d{2}/)?.[0]);
        if(cycleYear&&cycleYear>Number(asOf.slice(0,4)))errors.push('მომავალი კოჰორტის დასრულებული შედეგები დადასტურებული ვერ იქნება.');
        if(cycleYear&&Number(asOf.slice(0,4))-cycleYear>3)warnings.push('კოჰორტა სამ წელზე ძველია; მიმდინარე მიღების პირობები შეიძლება განსხვავდებოდეს.');
        if(record.applicants<30)warnings.push('პატარა კოჰორტა: საერთო მაჩვენებელი არასტაბილურია.');
        return {valid:errors.length===0,errors,warnings};
    }
    function wilsonInterval(successes,trials) {
        const z=1.959963984540054,p=successes/trials,z2=z*z,denom=1+z2/trials;
        const center=(p+z2/(2*trials))/denom;
        const half=z*Math.sqrt(p*(1-p)/trials+z2/(4*trials*trials))/denom;
        return [Math.max(0,center-half),Math.min(1,center+half)];
    }
    function admissionChance(program,options,asOf) {
        const input=options.statistics??program.admissionStatistics;
        const rows=Array.isArray(input)?input:isRecord(input)?[input]:[];
        const assessments=rows.filter(row=>row?.programId===program.id).map(record=>({record,assessment:validateStats(record,program,{asOf,maxAgeDays:options.statisticsMaxAgeDays})}));
        const valid=assessments.filter(item=>item.assessment.valid).sort((a,b)=>text(b.record.cycle).localeCompare(text(a.record.cycle))||text(b.record.checkedAt).localeCompare(text(a.record.checkedAt)))[0];
        const reason='ინდივიდუალური მიღების ალბათობა არ ითვლება: ამისთვის საჭიროა ამ პროგრამაზე შემოწმებული პროგნოზული მოდელი და შესაბამისი აპლიკანტების მონაცემები. შესაბამისობის ქულა მიღების პროცენტი არ არის.';
        if(!valid)return {status:'not-estimable',probability:null,label:'მიღების პირადი შანსი დასათვლელი არ არის',reason,baseline:null,missingEvidence:unique(assessments.flatMap(item=>item.assessment.errors))};
        const record=valid.record,rate=record.offers/record.applicants,interval=wilsonInterval(record.offers,record.applicants);
        return {status:'base-rate-only',probability:null,label:'გამოქვეყნებული კოჰორტის მიღების მაჩვენებელი',reason,baseline:{rate,percent:Math.round(rate*10000)/100,interval,intervalPercent:interval.map(value=>Math.round(value*10000)/100),confidenceLevel:0.95,intervalMethod:'Wilson (binomial proportion)',intervalMeaning:'კოჰორტის მოდელური ინტერვალი; არა სტუდენტის პირადი შანსი',metric:'offers/applicants',applicants:record.applicants,offers:record.offers,cohort:record.cycle,populationScope:record.populationScope,scopeDescription:record.scopeDescription||'',sourceUrl:record.sourceUrl,checkedAt:record.checkedAt,warnings:valid.assessment.warnings}};
    }
    function scoreProgram(program,institution,preferences={},options={}) {
        const raw=isRecord(preferences)?preferences:{},normalized=Core.normalizePreferences(preferences),prefs={...raw,...normalized};
        const asOf=isoDate(options.asOf)||today(),issues=[];
        const weights=resolveWeights(raw,options,issues);
        const evaluation=options.coreEvaluation?.program?.id===program.id?options.coreEvaluation:Core.evaluateProgram(program,prefs,{institution,asOf});
        const checks=buildChecks(program,institution,prefs,evaluation,asOf);
        let requestedWeight=0,knownWeight=0,earnedWeight=0;
        const breakdown=WEIGHT_DEFINITIONS.map(def=>{
            const items=checks[def.key],weight=weights[def.key];
            if(!items.length||weight===0)return {key:def.key,label:def.label,weight,earned:0,available:0,requestedWeight:0,status:'not-requested',explanation:weight===0?'ამ პრიორიტეტის წონა გამორთულია.':'ეს კრიტერიუმი არ არის მითითებული.',details:[]};
            const perItem=weight/items.length,available=items.filter(item=>item.status!=='unknown').length*perItem,earned=items.filter(item=>item.status==='matched').reduce((sum,item)=>sum+Math.max(0,Math.min(1,item.credit??1))*perItem,0);
            requestedWeight+=weight;knownWeight+=available;earnedWeight+=earned;
            const status=items.some(item=>item.status==='not-matched')?'not-matched':items.some(item=>item.status==='unknown')?'unknown':'matched';
            return {key:def.key,label:def.label,weight,earned,available,requestedWeight:weight,status,explanation:items.map(item=>item.explanation).join(' '),details:items};
        });
        const requestedCriteriaCount=breakdown.filter(row=>row.requestedWeight>0).length;
        const knownCriteriaCount=breakdown.filter(row=>row.requestedWeight>0&&row.status!=='unknown').length;
        const fitScore=knownWeight>0?rounded(100*earnedWeight/knownWeight):null;
        const conservativeScore=requestedWeight>0?rounded(100*earnedWeight/requestedWeight):null;
        const dataCoverage=requestedWeight>0?rounded(100*knownWeight/requestedWeight):0;
        const upperBoundScore=requestedWeight>0?rounded(100*(earnedWeight+requestedWeight-knownWeight)/requestedWeight):null;
        const blockers=unique(evaluation.exclusionReasons||[]),missing=unique([...(evaluation.missing||[]),...issues]);
        const status=blockers.length?'gaps':missing.length?'needs-verification':'requirements-met';
        const readiness={status,label:status==='gaps'?'ცნობილი პირობები არ ემთხვევა':status==='needs-verification'?'მიღების პირობები დასაზუსტებელია':'ცნობილი მინიმუმები დაკმაყოფილებულია',reasons:status==='gaps'?blockers:status==='needs-verification'?missing:unique(evaluation.reasons||[]),blockers,missing};
        const confidenceReasons=[];
        if(requestedCriteriaCount<3)confidenceReasons.push('შეფასება სამზე ნაკლებ მითითებულ კრიტერიუმს ეყრდნობა.');
        if(dataCoverage<80)confidenceReasons.push('არჩეული კრიტერიუმების მონაცემთა ნაწილი უცნობია.');
        if(missing.length)confidenceReasons.push('მიღების მოთხოვნები ან აპლიკანტის გარემოებები ჯერ დასაზუსტებელია.');
        const confidence={status:confidenceReasons.length?'limited':'supported',label:confidenceReasons.length?'შეზღუდული მონაცემები':'ცნობილი მონაცემებით მხარდაჭერილი',reasons:confidenceReasons};
        const academicMinimum=number(program.requirements?.gpaMinPercent),studentGpa=number(prefs.gpaPercent);
        return {programId:program.id,institutionId:institution?.id||program.institutionId||null,program,institution,status:evaluation.status,fitScore,fitScoreLabel:'შესაბამისობის ქულა',conservativeScore,conservativeScoreLabel:'დადასტურებული ქულა ყველა მითითებული კრიტერიუმიდან',scoreRange:[conservativeScore,upperBoundScore],dataCoverage,dataCoverageLabel:'მითითებული კრიტერიუმების მონაცემთა დაფარვა',requestedWeight,knownWeight,earnedWeight,requestedCriteriaCount,knownCriteriaCount,breakdown,weights,readiness,confidence,academicMargin:academicMinimum!==null&&studentGpa!==null&&studentGpa>=0&&studentGpa<=100?studentGpa-academicMinimum:null,admissionChance:admissionChance(program,options,asOf),warnings:unique([...(evaluation.warnings||[]),...issues]),evaluatedAt:asOf};
    }
    function compareScores(a,b) {
        const order={'matches':0,'needs-verification':1,'excluded':2};
        return (order[a.status]??3)-(order[b.status]??3) || (b.conservativeScore??-1)-(a.conservativeScore??-1) || b.dataCoverage-a.dataCoverage || (b.fitScore??-1)-(a.fitScore??-1) || text(a.programId).localeCompare(text(b.programId));
    }
    function rankPrograms(programs,institutions,preferences={},options={}) {
        const index=Core.createInstitutionIndex(institutions);
        return programs.map(program=>scoreProgram(program,Core.resolveInstitution(program,index),preferences,options)).sort(compareScores);
    }
    function scoreInstitution(institution,programs,preferences={},options={}) {
        const all=Array.isArray(programs)?programs:[];
        const linked=all.filter(program=>program.institutionId===institution?.id||(program.institutionId==null&&Core.resolveInstitution(program,[institution])?.id===institution?.id));
        const verified=linked.filter(program=>program.verificationStatus==='official-source');
        if(!verified.length)return {institutionId:institution?.id||null,institution,scope:'no-verified-program',programCount:linked.length,evaluatedProgramCount:0,bestProgramId:null,fitScore:null,fitScoreLabel:'პროგრამის შესაბამისობის ქულა',conservativeScore:null,dataCoverage:0,requestedCriteriaCount:0,knownCriteriaCount:0,breakdown:[],readiness:{status:'needs-verification',label:'პროგრამის მიღების მონაცემები არ არის აღწერილი',reasons:['დირექტორიის სახელი, ქვეყანა და ვებსაიტი უნივერსიტეტის საერთო მიღების შანსს არ განსაზღვრავს.'],blockers:[],missing:['საჭიროა კონკრეტული პროგრამის დადასტურებული მონაცემები.']},confidence:{status:'limited',label:'პროგრამის მონაცემები არ არის',reasons:['შესაფასებელი პროგრამა არ არის აღწერილი.']},admissionChance:{status:'not-estimable',probability:null,label:'მიღების პირადი შანსი დასათვლელი არ არის',reason:'უნივერსიტეტის დირექტორიაში ყოფნა კონკრეტული პროგრამის მიღების შანსის დასათვლელად საკმარისი არ არის.',baseline:null}};
        const best=verified.map(program=>scoreProgram(program,institution,preferences,options)).sort(compareScores)[0];
        return {...best,institutionId:institution.id,institution,scope:'best-linked-program',programCount:linked.length,evaluatedProgramCount:verified.length,bestProgramId:best.programId,fitScoreLabel:'საუკეთესო აღწერილ პროგრამასთან შესაბამისობა',scopeNote:'ქულა ეკუთვნის საუკეთესო შესაბამის აღწერილ პროგრამას და არა მთელ უნივერსიტეტს.'};
    }
    return freeze({DEFAULT_WEIGHTS,WEIGHT_DEFINITIONS,WEIGHT_PRESETS,STATISTICS_POLICY,scoreProgram,rankPrograms,scoreInstitution,validateStats,wilsonInterval});
}));
