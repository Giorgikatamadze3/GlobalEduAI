'use strict';

const StudentDiscovery = (() => {
    const multiIds=['filterCountry','filterRegion','filterField','filterSubject','filterDegree','filterLang','filterMode','advisorCountry','regionSelect','majorSelect','advisorSubject','degreeSelect','studyLangSelect','advisorMode'];
    const profileKey=()=>`globalEduScoring:${currentUser?._id||currentUser?.email||'guest'}`;
    let profile={},cache=new Map(),weights={...AdmissionScoring.DEFAULT_WEIGHTS},preset='balanced';
    let scorePreferences={};
    const selected=id=>[...$(id).selectedOptions].filter(option=>option.value).map(option=>option.value);
    const number=id=>$(id).value===''?null:Number($(id).value);
    const escaped=value=>escapeHTML(value);

    function setSelected(id,values=[]) {
        const wanted=new Set(values);
        [...$(id).options].forEach(option=>option.selected=wanted.has(option.value));
        refreshMulti(id);
    }
    function refreshMulti(id) {
        const select=$(id),box=document.querySelector(`[data-multi-id="${id}"]`);if(!box)return;
        const choices=[...select.selectedOptions].filter(option=>option.value);
        box.querySelector('.multi-selection').textContent=choices.length?choices.length<3?choices.map(o=>o.textContent).join(', '):`${choices.length} არჩევანი`:select.dataset.placeholder||'ნებისმიერი';
        box.querySelector('.multi-count').textContent=choices.length||'+';
        box.querySelectorAll('[data-multi-value]').forEach(input=>input.checked=choices.some(o=>o.value===input.dataset.multiValue));
    }
    function buildMulti(id) {
        const select=$(id);if(!select)return;
        const existing=document.querySelector(`[data-multi-id="${id}"]`);existing?.remove();
        select.multiple=true;select.hidden=true;
        const options=[...select.options].filter(option=>option.value);
        const box=document.createElement('details');box.className='multi-select';box.dataset.multiId=id;
        const label=document.querySelector(`label[for="${id}"]`)?.textContent||'არჩევანი';
        box.innerHTML=`<summary aria-label="${escaped(label)}"><span class="multi-selection"></span><span class="multi-count"></span></summary><div class="multi-menu">${options.length>8?'<input type="search" class="multi-search" placeholder="მოძებნე არჩევანი..." aria-label="არჩევანის ძიება">':''}<div class="multi-options">${options.map(option=>`<label class="multi-option"><input type="checkbox" data-multi-value="${escaped(option.value)}" data-select-id="${id}" ${option.selected?'checked':''}><span>${escaped(option.textContent)}</span></label>`).join('')}</div><button type="button" class="multi-clear" data-action="clear-multi" data-select-id="${id}">ამ არჩევანის გასუფთავება</button></div>`;
        select.after(box);refreshMulti(id);
    }
    function fill(id,options,placeholder) {
        const current=selected(id);$(id).innerHTML=optionsHTML(options,placeholder);$(id).dataset.placeholder=placeholder;$(id).multiple=true;
        [...$(id).options].forEach(option=>option.selected=current.includes(option.value)&&!!option.value);buildMulti(id);
    }
    function init() {
        fill('filterSubject',CatalogCore.SUBFIELDS,'ყველა სპეციალიზაცია');fill('advisorSubject',CatalogCore.SUBFIELDS,'ყველა სპეციალიზაცია');
        multiIds.forEach(id=>{const select=$(id);if(!select)return;select.dataset.placeholder=select.options[0]?.textContent||'ნებისმიერი';buildMulti(id);});
        const cycles=[...new Set(catalogData.programs.map(p=>p.deadline?.cycle).filter(Boolean))].sort();
        $('filterIntake').innerHTML=optionsHTML(cycles.map(value=>({value,label:value})),'ყველა მიღების ციკლი');
        $('priorityControls').innerHTML=AdmissionScoring.WEIGHT_DEFINITIONS.map(item=>`<label class="priority-control"><span>${escaped(item.label)} <output id="weight-${item.key}">${weights[item.key]}</output></span><input type="range" data-weight="${item.key}" min="0" max="50" step="5" value="${weights[item.key]}" aria-label="${escaped(item.label)} — პრიორიტეტი"></label>`).join('');
        restoreProfile();updateChips();
    }
    function filters() {
        return {query:$('programSearch').value.trim(),countryCodes:selected('filterCountry'),regions:selected('filterRegion'),fields:selected('filterField'),subjectFields:selected('filterSubject'),degrees:selected('filterDegree'),languages:selected('filterLang'),modes:selected('filterMode'),durationMinMonths:number('filterDurationMin'),durationMaxMonths:number('filterDurationMax'),deadlines:$('filterDeadline').value,deadlineAfter:$('filterDeadlineAfter').value||null,deadlineBefore:$('filterDeadlineBefore').value||null,intakeCycle:$('filterIntake').value,budget:number('filterBudget'),currency:$('filterCurrency').value,budgetPeriod:'year',requiresFullFunding:$('filterFunding').checked,freeTuitionOnly:$('filterFree').checked,tuitionKnownOnly:$('filterKnownFees').checked,hasScholarships:$('filterScholarships').checked,fundingScheme:$('filterFundingScheme').value,sourceFreshOnly:$('filterFresh').checked,includeUnknownFees:$('filterUnknown').checked,hasPrograms:$('filterHasPrograms').checked};
    }
    function effectivePreferences() {
        const f=filters(),merged={...profile,weights:{...weights},weightPreset:preset};
        for(const [key,value]of Object.entries(f)){
            if(Array.isArray(value)){if(value.length)merged[key]=value;}
            else if(value!==null&&value!==''&&key!=='deadlines')merged[key]=value;
            else if(key==='deadlines'&&value!=='any')merged[key]=value;
        }
        return merged;
    }
    function options() {return {asOf:todayISO(),statistics:catalogData?.admissionStatistics||[]};}
    function invalidate() {cache.clear();scorePreferences=effectivePreferences();}
    function score(entity,prefs=null) {
        if(!entity||!catalogData)return null;
        if(!prefs&&cache.has(entity.id))return cache.get(entity.id);
        const chosen=prefs||scorePreferences;
        const result=entity.program?AdmissionScoring.scoreProgram(entity.program,entityMap.get(entity.institutionId),chosen,options()):entity.programCount?AdmissionScoring.scoreInstitution(entity,programByInstitution.get(entity.id)||[],chosen,options()):null;
        if(!prefs)cache.set(entity.id,result);return result;
    }
    function results(view) {
        invalidate();updateChips();const f=filters();
        const validation=CatalogCore.normalizePreferences(f);
        $('filterValidation').textContent=(validation.filterIssues||[]).join(' ');
        let rows=(view==='programs'?CatalogCore.filterPrograms(catalogData.programs,catalogData.institutions,f,options()):CatalogCore.filterCatalogInstitutions(catalogData.institutions,catalogData.programs,f,options())).map(item=>entityMap.get(item.id));
        const minimum=Number($('filterMinScore').value||0);
        if(minimum>0)rows=rows.filter(entity=>{const data=score(entity);return data?.conservativeScore!=null&&data.conservativeScore>=minimum;});
        const eligibility=$('filterEligibility').value;
        if(eligibility!=='any')rows=rows.filter(entity=>{const data=score(entity);return data&&(eligibility==='met'?data.readiness.status==='requirements-met':data.readiness.status!=='gaps');});
        const sorting=$('sortOption').value;
        rows.sort((a,b)=>{
            if(sorting==='fitDesc'){
                const first=score(a),second=score(b);
                const order={matches:0,'needs-verification':1,excluded:2};
                return (order[first?.status]??3)-(order[second?.status]??3)||(second?.conservativeScore??-1)-(first?.conservativeScore??-1)||(second?.dataCoverage||0)-(first?.dataCoverage||0)||a.name.localeCompare(b.name);
            }
            if(view==='programs'&&sorting.startsWith('price')){
                const fee=e=>{const t=e.program.tuition;return t?.amount!=null&&t.currency===f.currency&&t.period==='year'?t.amount:null;};
                const first=fee(a),second=fee(b);if((first===null)!==(second===null))return first===null?1:-1;
                if(first!==null&&first!==second)return(sorting==='priceAsc'?1:-1)*(first-second);
            }
            return (sorting==='default'?(b.programCount||0)-(a.programCount||0):0)||a.name.localeCompare(b.name);
        });return rows;
    }
    function scoreBadge(entity,prefs=null) {
        const data=score(entity,prefs);
        if(!data||data.fitScore===null)return '<div class="score-unavailable">◎ ქულისთვის აირჩიე ინტერესები ან შეავსე პროფილი</div>';
        return `<div class="score-badge"><div><span>შესაბამისობა</span><strong>${data.fitScore}<small>/100</small></strong></div><div class="score-badge-meta"><span>დაფარვა ${data.dataCoverage}% · ${data.requestedCriteriaCount} კრიტერიუმი</span><span>${data.readiness.status==='gaps'?'მოთხოვნებში შეუსაბამობაა':data.readiness.status==='needs-verification'?'მიღების პირობები დასაზუსტებელია':'ცნობილი მინიმუმები შესრულებულია'}</span>${data.scope==='best-linked-program'?'<span>ქულა საუკეთესო აღწერილ პროგრამას ეხება</span>':''}</div><button class="score-info" data-action="score-details" data-id="${escaped(entity.id)}" aria-label="ქულის განმარტება">ⓘ</button></div>`;
    }
    function scorePanel(entity,prefs=null) {
        const data=score(entity,prefs);if(!data)return `<section class="student-score-panel"><h3>შეფასებისთვის პროგრამის მონაცემებია საჭირო</h3><p>დირექტორიის სახელითა და ვებსაიტით მიღების შანსი არ განისაზღვრება.</p></section>`;
        const baseline=data.admissionChance.baseline;
        return `<section class="student-score-panel"><span class="eyebrow">YOUR PROFILE, EXPLAINED</span><h3>შენი არჩევანის შეფასება</h3><div class="score-overview"><div><strong>${data.fitScore??'—'}<small>/100</small></strong><span>ცნობილი პირობების შესაბამისობა</span></div><div><strong>${data.dataCoverage}%</strong><span>არჩეული მონაცემების დაფარვა</span></div><div><strong>${data.conservativeScore??'—'}<small>/100</small></strong><span>ყველა მოთხოვნიდან დადასტურებული ქულა</span></div></div><p class="small-note">შესაბამისობის ქულა ითვლება ცნობილ მონაცემებზე. მესამე მაჩვენებელში უცნობი პირობების ქულა არ ირიცხება. ეს მიღების პროცენტი არ არის.${data.scopeNote?' '+escaped(data.scopeNote):''}</p><div class="score-breakdown">${data.breakdown.filter(row=>row.status!=='not-requested').map(row=>`<div><div class="breakdown-title"><strong>${escaped(row.label)}</strong><span>${row.available>0?Math.round(100*row.earned/row.requestedWeight)+' / 100':'დასაზუსტებელია'}</span></div><div class="score-track"><i style="width:${row.available>0?Math.round(100*row.earned/row.requestedWeight):0}%"></i></div><p>${escaped(row.explanation)}</p></div>`).join('')}</div><div class="admission-readiness"><h4>${escaped(data.readiness.label)}</h4><ul>${data.readiness.reasons.slice(0,8).map(reason=>`<li>${escaped(reason)}</li>`).join('')}</ul></div><div class="admission-chance"><h4>მიღების შანსი და კონკურენცია</h4>${baseline?`<div class="baseline-rate"><strong>${baseline.percent}%</strong><span>${escaped(baseline.cohort)} წლის კოჰორტის მიღების მაჩვენებელი</span></div><p>${baseline.offers} მიღებული განაცხადი / ${baseline.applicants} განაცხადი. ეს ისტორიული საერთო მონაცემია, არა შენი ინდივიდუალური შანსი.</p><p class="small-note">${escaped(baseline.scopeDescription)}<br>მოდელური 95%-იანი ინტერვალი: ${baseline.intervalPercent.join('–')}%. ეს სტუდენტის პირადი შანსის ინტერვალი არ არის.</p><a href="${escaped(safeLink(baseline.sourceUrl)||'#')}" target="_blank" rel="noopener noreferrer">ოფიციალური სტატისტიკა ↗</a>`:'<p>ამ პროგრამის ინდივიდუალური მიღების პროცენტის გამოსათვლელად საკმარისი სტატისტიკა და შემოწმებული პროგნოზული მოდელი არ გვაქვს.</p>'}<p class="small-note">მზადყოფნის შეფასება და შესაბამისობის ქულა მიღების ან სტიპენდიის გარანტიას არ იძლევა.</p></div></section>`;
    }
    function advisorChoices(raw) {
        return {...raw,countryCode:'',region:'',degree:'',field:'',language:'',mode:'',countryCodes:selected('advisorCountry'),regions:selected('regionSelect'),degrees:selected('degreeSelect'),fields:selected('majorSelect'),subjectFields:selected('advisorSubject'),languages:selected('studyLangSelect'),modes:selected('advisorMode'),weights:{...weights},weightPreset:preset};
    }
    function saveAdvisorProfile() {
        if(!lastAdvisorPreferences){notify('ჯერ შეაფასე შენი პროფილი.');return;}
        profile={...lastAdvisorPreferences};writeStored(profileKey(),profile);applyProfileFilters();closeAllModals();navigateTo('page-universities');$('sortOption').value='fitDesc';filterAndSortUnis();updateProfileSummary();notify('პროფილი ამ ბრაუზერში შენახულია. ქულები განახლდა.');
    }
    function applyProfileFilters() {
        const mappings={filterCountry:'countryCodes',filterRegion:'regions',filterDegree:'degrees',filterField:'fields',filterSubject:'subjectFields',filterLang:'languages',filterMode:'modes'};
        Object.entries(mappings).forEach(([id,key])=>setSelected(id,profile[key]||[]));
        $('filterBudget').value=profile.budget??'';$('filterCurrency').value=profile.currency||'EUR';$('filterFunding').checked=profile.requiresFullFunding===true;
    }
    function updateProfileSummary() {$('studentProfileState').textContent=Object.keys(profile).length?'შენახული პროფილის მიხედვით':'ქულა მიმდინარე ინტერესების მიხედვით';}
    function restoreProfile() {
        profile=readStored(profileKey(),{});if(!profile||typeof profile!=='object'||Array.isArray(profile))profile={};
        if(profile.weights){weights={...AdmissionScoring.DEFAULT_WEIGHTS,...profile.weights};preset=profile.weightPreset||'balanced';}
        else {weights={...AdmissionScoring.DEFAULT_WEIGHTS};preset='balanced';}
        $('priorityPreset').value=preset;
        document.querySelectorAll('[data-weight]').forEach(input=>{input.value=weights[input.dataset.weight];$('weight-'+input.dataset.weight).value=input.value;});
        const mappings={advisorCountry:['countryCodes','countryCode'],regionSelect:['regions','region'],degreeSelect:['degrees','degree'],majorSelect:['fields','field'],advisorSubject:['subjectFields','subjectField'],studyLangSelect:['languages','language'],advisorMode:['modes','mode']};
        $('aiForm').reset();
        Object.entries(mappings).forEach(([id,[multiple,single]])=>setSelected(id,profile[multiple]||(profile[single]?[profile[single]]:[])));
        $('gpa').value=profile.gpaPercent??'';$('langLevelSelect').value=profile.languageLevel||'';$('advisorBudget').value=profile.budget??'';$('advisorCurrency').value=profile.currency||'EUR';$('citizenshipSelect').value=profile.citizenshipCode||'GE';$('expSelect').value=profile.experienceYears??'';$('advisorFunding').checked=profile.requiresFullFunding===true;
        const test=profile.languageTests?.[0];$('hasCertSelect').value=test?'yes':'';toggleCertVisibility();
        if(test){const known=[...$('certNameSelect').options].some(o=>o.value===test.name);$('certNameSelect').value=known?test.name:'other';toggleCustomInput('certNameSelect','certNameCustom');if(!known)$('certNameCustom').value=test.name;$('certScore').value=test.score??'';$('certComponentScore').value=test.minComponentScore??'';syncCertificateBounds();}
        cache.clear();scorePreferences=effectivePreferences();updateProfileSummary();
    }
    function clearProfile() {profile={};writeStored(profileKey(),profile);restoreProfile();filterAndSortUnis();notify('შენახული შეფასების პროფილი გასუფთავდა.');}
    function reset() {
        multiIds.filter(id=>id.startsWith('filter')).forEach(id=>setSelected(id,[]));
        ['filterBudget','filterDurationMin','filterDurationMax','filterDeadlineAfter','filterDeadlineBefore','filterIntake','filterFundingScheme'].forEach(id=>$(id).value='');
        ['filterFunding','filterUnknown','filterHasPrograms','filterFree','filterKnownFees','filterScholarships','filterFresh'].forEach(id=>$(id).checked=false);
        $('filterCurrency').value='EUR';$('filterDeadline').value='any';$('filterEligibility').value='any';$('filterMinScore').value='0';$('programSearch').value='';$('sortOption').value='default';cache.clear();
    }
    function updateChips() {
        const chips=[];
        multiIds.filter(id=>id.startsWith('filter')).forEach(id=>[...$(id).selectedOptions].filter(o=>o.value).forEach(o=>chips.push(`<button data-action="remove-filter-choice" data-select-id="${id}" data-value="${escaped(o.value)}">${escaped(o.textContent)} <span>×</span></button>`)));
        const names={filterBudget:'ბიუჯეტი',filterDurationMin:'მინ. თვე',filterDurationMax:'მაქს. თვე',filterDeadlineAfter:'ვადა დან',filterDeadlineBefore:'ვადა მდე',filterIntake:'ციკლი'};
        Object.entries(names).forEach(([id,name])=>{if($(id).value!=='')chips.push(`<button data-action="clear-filter-value" data-input-id="${id}">${name}: ${escaped($(id).value)} <span>×</span></button>`);});
        if($('filterFundingScheme').value)chips.push(`<button data-action="clear-filter-value" data-input-id="filterFundingScheme">${escaped($('filterFundingScheme').selectedOptions[0].textContent)} <span>×</span></button>`);
        const booleans={filterHasPrograms:'აღწერილი პროგრამები',filterFunding:'სრული დაფინანსება',filterFree:'სწავლის საფასური 0',filterKnownFees:'ცნობილი საფასური',filterScholarships:'აღწერილი სტიპენდია',filterFresh:'ბოლო 365 დღეში შემოწმებული',filterUnknown:'უცნობი ფასის ჩათვლით'};
        Object.entries(booleans).forEach(([id,name])=>{if($(id).checked)chips.push(`<button data-action="clear-filter-value" data-input-id="${id}">${name} <span>×</span></button>`);});
        if($('filterDeadline').value!=='any')chips.push(`<button data-action="clear-filter-value" data-input-id="filterDeadline">${escaped($('filterDeadline').selectedOptions[0].textContent)} <span>×</span></button>`);
        if(Number($('filterMinScore').value)>0)chips.push(`<button data-action="clear-filter-value" data-input-id="filterMinScore">დადასტურებული ქულა ≥ ${Number($('filterMinScore').value)} <span>×</span></button>`);
        if($('filterEligibility').value!=='any')chips.push(`<button data-action="clear-filter-value" data-input-id="filterEligibility">${escaped($('filterEligibility').selectedOptions[0].textContent)} <span>×</span></button>`);
        $('activeFilterChips').innerHTML=chips.join('');$('activeFilterCount').textContent=chips.length; $('programJoinNote').hidden=!CatalogCore.hasProgramFilters?.(filters())&&!chips.some(s=>/filterField|filterSubject|filterDegree|filterLang|filterMode/.test(s));
    }
    document.addEventListener('change',event=>{
        const input=event.target;
        if(input.matches('[data-multi-value]')){const select=$(input.dataset.selectId);[...select.options].find(o=>o.value===input.dataset.multiValue).selected=input.checked;refreshMulti(select.id);if(select.id.startsWith('filter'))filterAndSortUnis();}
        if(input.matches('[data-weight]')){weights[input.dataset.weight]=Number(input.value);$('weight-'+input.dataset.weight).value=input.value;invalidate();filterAndSortUnis(false);}
        if(input.id==='priorityPreset'){preset=input.value;weights={...AdmissionScoring.WEIGHT_PRESETS[preset]};document.querySelectorAll('[data-weight]').forEach(i=>{i.value=weights[i.dataset.weight];$('weight-'+i.dataset.weight).value=i.value;});filterAndSortUnis(false);}
    });
    document.addEventListener('input',event=>{
        if(event.target.matches('.multi-search')){const query=event.target.value.toLocaleLowerCase();event.target.closest('.multi-menu').querySelectorAll('.multi-option').forEach(label=>label.hidden=!label.textContent.toLocaleLowerCase().includes(query));}
        if(event.target.matches('[data-weight]'))$('weight-'+event.target.dataset.weight).value=event.target.value;
    });
    document.addEventListener('click',event=>{
        const button=event.target.closest('[data-action]');if(!button)return;
        const action=button.dataset.action;
        if(action==='clear-multi'){setSelected(button.dataset.selectId,[]);if(button.dataset.selectId.startsWith('filter'))filterAndSortUnis();}
        if(action==='remove-filter-choice'){const select=$(button.dataset.selectId);[...select.options].find(o=>o.value===button.dataset.value).selected=false;refreshMulti(select.id);filterAndSortUnis();}
        if(action==='clear-filter-value'){const input=$(button.dataset.inputId);if(input.type==='checkbox')input.checked=false;else input.value=['filterDeadline','filterEligibility'].includes(input.id)?'any':input.id==='filterMinScore'?'0':'';filterAndSortUnis();}
        if(action==='score-details'){openDynamicUniModal(button.dataset.id);$('uniModalDesc').querySelector('.student-score-panel')?.scrollIntoView({block:'start',behavior:'smooth'});}
        if(action==='apply-scoring-profile')saveAdvisorProfile();if(action==='clear-scoring-profile')clearProfile();
    });
    return {init,filters,results,score,scoreBadge,scorePanel,advisorChoices,restoreProfile,reset,refreshMulti,setSelected};
})();
