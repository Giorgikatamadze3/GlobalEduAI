'use strict';

let catalogData = null;
let catalogView = 'institutions';
let entityMap = new Map();
let programByInstitution = new Map();
let catalogRequest;
let lastAdvisorPreferences = null;

function optionLabel(options, value) {
    const option = options.find(item => (item.value ?? item.id ?? item.code) === value);
    return option?.label || option?.name || value || 'დასაზუსტებელია';
}
function fieldLabel(program) {
    const names = {'computer-science':'კომპიუტერული მეცნიერებები','data-science':'მონაცემთა მეცნიერება','cybersecurity':'კიბერუსაფრთხოება','artificial-intelligence':'ხელოვნური ინტელექტი','business':'ბიზნესი','management':'მენეჯმენტი','public-policy':'საჯარო პოლიტიკა','design':'დიზაინი','economics':'ეკონომიკა','natural-sciences':'საბუნებისმეტყველო მეცნიერებები','science-and-technology':'მეცნიერება და ტექნოლოგია'};
    return names[program.field] || optionLabel(CatalogCore.FIELDS,program.category);
}
function programLanguage(program) {
    if(program.language)return optionLabel(CatalogCore.LANGUAGES,program.language);
    if(program.sourceLanguages?.length)return `${program.sourceLanguages.join(' / ')} · ენის მარშრუტი გადაამოწმე`;
    if(program.languages?.length)return `${program.languages.map(code=>optionLabel(CatalogCore.LANGUAGES,code)).join(' / ')} · ენის მარშრუტი გადაამოწმე`;
    return 'დასაზუსტებელია';
}
function tuitionText(program) {
    const tuition = program?.tuition;
    if (tuition?.amount === null || tuition?.amount === undefined || !Number.isFinite(Number(tuition.amount))) return 'საფასური დასაზუსტებელია';
    const period = tuition.period === 'program' ? 'პროგრამა' : 'წელი';
    return `${Number(tuition.amount).toLocaleString('en-US')} ${tuition.currency} / ${period}`;
}
function entityFromInstitution(institution) { return {...institution, kind:'institution', programCount:institution.programCount || 0}; }
function entityFromProgram(program) {
    const institution = entityMap.get(program.institutionId);
    return {id:program.id, kind:'program', name:institution?.name || program.institutionName, country:institution?.country || CatalogCore.countryInfo(program.countryCode).name,
        countryCode:program.countryCode || institution?.countryCode, region:institution?.region, website:program.sources?.[0]?.url || program.institutionWebsite,
        program, institutionId:program.institutionId, source:program.sources?.[0]};
}
function campusImage(entity) {
    if (['IT','FR','BE','NL'].includes(entity.countryCode)) return 'assets/europe.jpg';
    return entity.program?.category === 'arts' || entity.program?.category === 'social' ? 'assets/library.jpg' : 'assets/campus.jpg';
}
function emptyState(title, message, button = '', action = '') {
    return `<div class="empty-state"><span aria-hidden="true">↗</span><h3>${escapeHTML(title)}</h3><p>${escapeHTML(message)}</p>${button ? `<button class="btn-secondary" data-action="${action}">${escapeHTML(button)} ↗</button>` : ''}</div>`;
}
function programIdentity(entity) {
    const program=entity.program,id=escapeHTML(entity.id);
    return `<div class="program-identity"><h3 class="program-heading"><button type="button" class="program-title" data-i18n-ignore data-action="university" data-id="${id}">${escapeHTML(program?.title||entity.name)}</button></h3>${program?`<p class="program-university" data-i18n-ignore>${escapeHTML(entity.name)}</p><p class="program-study-mode"><span>სწავლის ფორმატი</span><span>${escapeHTML(modeLabel(program.mode))}</span></p>`:`<p class="program-field" data-i18n-ignore>${escapeHTML(entity.domains?.[0]||entity.country)}</p>`}</div>`;
}
function programCard(entity, compare = true) {
    const id = escapeHTML(entity.id);
    const favorite = favoritesList.includes(entity.id);
    const program = entity.program;
    const label = program ? (program.verificationStatus==='official-directory'?(program.provenance?.sourceId?.startsWith('daad')?'DAAD · ოფიციალური კატალოგი':'ოფიციალური პროგრამების კატალოგი'):'პროგრამის ოფიციალური წყარო') : 'უნივერსიტეტების დირექტორია';
    const tags = program
        ? `<span class="tag tag-neutral">${escapeHTML(optionLabel(CatalogCore.DEGREES, program.degree))}</span><span class="tag tag-neutral">${escapeHTML(programLanguage(program))}</span><span class="tag">${escapeHTML(fieldLabel(program))}</span>`
        : `<span class="tag tag-neutral">${escapeHTML(optionLabel(CatalogCore.REGIONS, entity.region))}</span>${entity.programCount ? `<span class="tag tag-green">${entity.programCount} პროგრამის აღწერა</span>` : '<span class="tag tag-neutral">პროგრამები დასამატებელია</span>'}`;
    return `<article class="program-card ${program ? '' : 'institution-card'}"><div class="program-cover" data-action="university" data-id="${id}" role="button" tabindex="0" aria-label="${escapeHTML(entity.name)} — დეტალები"><img src="${campusImage(entity)}" alt="საილუსტრაციო ფოტო; არ წარმოადგენს უნივერსიტეტის კამპუსს" loading="lazy"><span class="program-location">◎ ${escapeHTML(entity.country)}</span><button class="fav-btn ${favorite ? 'active' : ''}" data-action="favorite" data-id="${id}" aria-label="${favorite ? 'ფავორიტებიდან წაშლა' : 'ფავორიტებში დამატება'}" aria-pressed="${favorite}">${favorite ? '♥' : '♡'}</button></div><div class="program-body">${programIdentity(entity)}<span class="program-category">${label}</span><div class="program-tags">${tags}</div>${program?.funding?.opportunityIds?.length?`<span class="funding-association">✳ დაფინანსების ${program.funding.opportunityIds.length} შესაძლო გზა</span>`:''}${FundingUI.summary(entity)}${StudentDiscovery.scoreBadge(entity)}<div class="program-bottom"><div class="program-price"><strong>${program ? escapeHTML(tuitionText(program)) : 'გაიცანი უნივერსიტეტი'}</strong><span>${program ? 'საცხოვრებელი და სხვა ხარჯები ცალკეა' : 'საფასური და მიღება პროგრამაზეა დამოკიდებული'}</span></div><button class="text-button" data-action="university" data-id="${id}">დეტალები <span>↗</span></button></div></div>${compare ? `<div class="program-compare"><label class="compare-checkbox"><input type="checkbox" data-action="compare" data-id="${id}" ${compareList.includes(entity.id) ? 'checked' : ''}> შედარება</label><span class="program-deadline">${program ? `ვადა: ${program.deadline?.date ? formatDate(program.deadline.date) : 'დასაზუსტებელია'}` : escapeHTML(entity.countryCode)}</span></div>` : ''}</article>`;
}
async function fetchUniversities() {
    if (catalogRequest) return catalogRequest;
    universitiesStatus = 'loading';
    ['uniResultsGrid','featuredPrograms'].forEach(id => $(id).innerHTML = '<div class="skeleton-card"></div><div class="skeleton-card"></div>');
    catalogRequest = (async () => {
        try {
            const response = await api('/catalog.json', {signal:AbortSignal.timeout(30000)});
            const data = await response.json();
            if (!Array.isArray(data.institutions) || !Array.isArray(data.programs)) throw new Error('Invalid catalog');
            catalogData = data;
            entityMap = new Map(data.institutions.map(i => [i.id, entityFromInstitution(i)]));
            programByInstitution = new Map();
            data.programs.forEach(program => {
                entityMap.set(program.id, entityFromProgram(program));
                const linked = programByInstitution.get(program.institutionId) || [];
                linked.push(program); programByInstitution.set(program.institutionId, linked);
            });
            allUniversities = [...entityMap.values()]; universitiesStatus = 'ready'; populateFilters(); renderCatalogSummary();
        } catch { universitiesStatus = 'error'; }
        finally { catalogRequest = null; }
        filterAndSortUnis(false); renderFeatured(); renderFavorites();
    })();
    return catalogRequest;
}
function optionsHTML(options, emptyLabel) {
    return `<option value="">${emptyLabel}</option>` + options.map(option => `<option value="${escapeHTML(option.value ?? option.code ?? option.id)}">${escapeHTML(option.label ?? option.name)}</option>`).join('');
}
function populateFilters() {
    const countries = catalogData.metadata.countries;
    const targets = [['filterCountry','ყველა ქვეყანა'],['heroCountry','ნებისმიერი ქვეყანა'],['advisorCountry','ნებისმიერი ქვეყანა'],['citizenshipSelect','აირჩიე მოქალაქეობა']];
    targets.forEach(([id,label]) => { const previous = $(id).value; $(id).innerHTML = optionsHTML(countries,label); $(id).value = previous; });
    if (!$('citizenshipSelect').value) $('citizenshipSelect').value = 'GE';
    $('citizenshipSelect').innerHTML = optionsHTML(Object.values(CatalogCore.COUNTRIES).map(c=>({value:c.code,label:c.name})).sort((a,b)=>a.label.localeCompare(b.label,'ka')),'აირჩიე მოქალაქეობა');
    $('citizenshipSelect').value = 'GE';
    $('filterRegion').innerHTML = optionsHTML(CatalogCore.REGIONS,'ყველა რეგიონი');
    $('regionSelect').innerHTML = optionsHTML(CatalogCore.REGIONS,'ნებისმიერი რეგიონი');
    ['filterDegree','heroDegree','degreeSelect'].forEach(id => $(id).innerHTML = optionsHTML(CatalogCore.DEGREES,'ყველა საფეხური'));
    ['filterField','majorSelect'].forEach(id => $(id).innerHTML = optionsHTML(CatalogCore.FIELDS,'ყველა მიმართულება'));
    ['filterLang','studyLangSelect'].forEach(id => $(id).innerHTML = optionsHTML(CatalogCore.LANGUAGES,'ყველა ენა'));
    StudentDiscovery.init(); FundingUI.init();
}
function renderCatalogSummary() {
    const meta = catalogData.metadata;
    $('catalogCoverage').innerHTML = `<div><strong>${meta.institutionCount.toLocaleString('en-US')}</strong><span>დაწესებულება დირექტორიაში</span></div><div><strong>${meta.countryCount}</strong><span>ქვეყანა და ტერიტორია</span></div><div><strong>${meta.programCount}</strong><span>პროგრამა ოფიციალური წყაროებით</span></div><p>${meta.institutionsWithPrograms} დაწესებულების პროგრამები · ${meta.fundingSchemeCount} დაფინანსების სქემა. პროგრამების დაფარვა ნაწილობრივია; პრიორიტეტია გერმანია და ევროპა. უცნობი საფასური და მიღების მოთხოვნები დასაზუსტებელია.</p>`;
    $('catalogSource').innerHTML = `წყარო: <a href="${escapeHTML(safeLink(meta.repositoryUrl || meta.sourceUrl) || '#')}" target="_blank" rel="noopener noreferrer">Hipo directory ↗</a> · განახლდა ${escapeHTML(meta.retrievedAt)} · სია არ არის სრული აკრედიტაციის რეესტრი.`;
    const europe=meta.programCoverage?.europe;
    if(europe){
        $('catalogCoverage').insertAdjacentHTML('beforeend',`<details class="europe-coverage"><summary>ევროპის პროგრამები <span data-i18n-ignore>· ${europe.countriesWithPrograms} / ${europe.countryCount}</span></summary><p>აირჩიე ქვეყანა პროგრამების სანახავად. სიაში შედის ტრანსკონტინენტური ქვეყნები და განათლების სისტემები; პროგრამების დაფარვა ნაწილობრივია.</p><div class="europe-country-grid">${europe.countries.map(row=>`<button type="button" data-europe-country="${row.countryCode}"><span>${escapeHTML(CatalogCore.countryInfo(row.countryCode).name)}</span><b data-i18n-ignore>${row.programCount}</b></button>`).join('')}</div></details>`);
        $('catalogCoverage').querySelectorAll('[data-europe-country]').forEach(button=>button.addEventListener('click',()=>{resetFilters(false);$('filterCountry').value=button.dataset.europeCountry;StudentDiscovery.refreshMulti('filterCountry');setCatalogView('programs');$('uniResultsGrid').scrollIntoView({behavior:'smooth',block:'start'});}));
    }
}
function setCatalogView(view, keepFilters = false) {
    if (!['institutions','programs'].includes(view)) return;
    if (catalogView !== view) clearCompare();
    catalogView = view;
    $('sortOption').options[0].textContent = view === 'programs' ? 'სახელით: A–Z' : 'პროგრამების მონაცემებით';
    document.querySelectorAll('[data-catalog-view]').forEach(button => { const active = button.dataset.catalogView === view; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
    $('programFilters').hidden = false;
    $('resultsKind').textContent = view === 'programs' ? 'პროგრამა' : 'უნივერსიტეტი';
    $('programSearch').placeholder = view === 'programs' ? 'მოძებნე პროგრამა ან უნივერსიტეტი...' : 'მოძებნე უნივერსიტეტი, ქვეყანა ან დომენი...';
    $('catalogModeNote').textContent = view === 'programs' ? 'აქ მხოლოდ ოფიციალური წყაროებით აღწერილი პროგრამებია. სხვა უნივერსიტეტების პროგრამები ეტაპობრივად დაემატება.' : 'პროგრამის უცნობი საფასური, ენა ან მოთხოვნები უნივერსიტეტის თვისებად არ მიიჩნევა.';
    [...$('sortOption').options].forEach(option => { if (option.value.startsWith('price')) option.disabled = view !== 'programs'; });
    if (view !== 'programs' && $('sortOption').value.startsWith('price')) $('sortOption').value = 'default';
    filterAndSortUnis(!keepFilters);
}
function updatePriceLabel() { /* Budget is entered explicitly; an empty budget imposes no fee filter. */ }
function programFilters() { return StudentDiscovery.filters(); }
function filteredUniversities() { return catalogData ? StudentDiscovery.results(catalogView) : []; }
function todayISO() { return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function filterAndSortUnis(resetPage = true) {
    if (resetPage) currentPage = 1;
    $('catalogPagination').innerHTML = '';
    if (universitiesStatus === 'loading') return;
    if (universitiesStatus === 'error') { $('uniResultsGrid').innerHTML = emptyState('კატალოგი ვერ ჩაიტვირთა','გადაამოწმე კავშირი სერვერთან. კატალოგის წაკითხვას MongoDB არ სჭირდება.','ხელახლა ცდა','retry-universities'); return; }
    const entities = filteredUniversities(); $('resultsCount').textContent = entities.length.toLocaleString('en-US');
    if (!entities.length) { $('uniResultsGrid').innerHTML = emptyState('ამ პირობებით ჩანაწერი ვერ მოიძებნა','შეცვალე პირობები ან გადადი უნივერსიტეტების ფართო დირექტორიაში. უცნობი ფასი უფასო სწავლას არ ნიშნავს.','ფილტრების გასუფთავება','reset-filters'); return; }
    const pages = Math.ceil(entities.length/PAGE_SIZE); currentPage = Math.min(Math.max(1,currentPage),pages);
    $('uniResultsGrid').innerHTML = entities.slice((currentPage-1)*PAGE_SIZE,currentPage*PAGE_SIZE).map(entity => programCard(entity)).join('');
    if (pages > 1) {
        const start = Math.max(1,Math.min(currentPage-2,pages-4));
        const numbers = Array.from({length:Math.min(5,pages)},(_,i) => start+i);
        $('catalogPagination').innerHTML = `<button data-action="page" data-page="${currentPage-1}" aria-label="წინა გვერდი" ${currentPage===1?'disabled':''}>←</button>${numbers.map(n=>`<button class="${n===currentPage?'active':''}" data-action="page" data-page="${n}" ${n===currentPage?'aria-current="page"':''}>${n}</button>`).join('')}<span>/ ${pages}</span><button data-action="page" data-page="${currentPage+1}" aria-label="შემდეგი გვერდი" ${currentPage===pages?'disabled':''}>→</button>`;
    }
}
function renderFeatured() {
    if (universitiesStatus === 'error') { $('featuredPrograms').innerHTML = emptyState('კატალოგი ვერ ჩაიტვირთა','სცადე სერვერთან დაკავშირება ხელახლა.','ხელახლა ცდა','retry-universities'); return; }
    const featured = catalogData?.programs.slice(0,3).map(p=>entityMap.get(p.id)) || [];
    $('featuredPrograms').innerHTML = featured.map(entity=>programCard(entity,false)).join('');
}
function resetFilters(render = true) { StudentDiscovery.reset(); if(render)filterAndSortUnis(); }
function toggleCompare(id,checkbox) {
    const existing = entityMap.get(compareList[0]); const incoming = entityMap.get(id);
    if (checkbox.checked && existing && existing.kind !== incoming?.kind) { checkbox.checked=false; notify('უნივერსიტეტები და პროგრამები ცალ-ცალკე შეადარე.'); return; }
    if (checkbox.checked && compareList.length>=3) { checkbox.checked=false; notify('შეგიძლია შეადარო მაქსიმუმ 3 ჩანაწერი.'); return; }
    compareList = checkbox.checked ? [...new Set([...compareList,id])] : compareList.filter(item=>item!==id); renderCompareBar();
}
function renderCompareBar() { $('compareCount').textContent=compareList.length; $('compareBar').style.display=compareList.length&&$('page-universities').classList.contains('active')?'flex':'none'; }
function clearCompare() { compareList=[]; document.querySelectorAll('[data-action="compare"]').forEach(input=>input.checked=false); renderCompareBar(); }
function openCompareModal() {
    const entities=compareList.map(id=>entityMap.get(id)).filter(Boolean); if(!entities.length)return;
    $('compareTableHead').innerHTML='<th scope="col">შენი არჩევანი</th>'+entities.map(entity=>`<th scope="col">${escapeHTML(entity.name)}<small>${escapeHTML(entity.country)}</small></th>`).join('');
    const programs=entities[0].kind==='program';
    const features=programs ? [
        ['პროგრამა',e=>e.program.title],['საფეხური',e=>optionLabel(CatalogCore.DEGREES,e.program.degree)],['ენა',e=>optionLabel(CatalogCore.LANGUAGES,e.program.language)],['ხანგრძლივობა',e=>e.program.durationMonths?`${e.program.durationMonths} თვე`:'დასაზუსტებელია'],['სწავლის საფასური',e=>tuitionText(e.program)],['საფასურის შენიშვნა',e=>e.program.tuition?.note||'დასაზუსტებელია'],['სრული დაფინანსება',e=>e.program.funding?.fullFunding===true?'ოფიციალურად მითითებულია':'არ დასტურდება / დასაზუსტებელია'],['ბოლო ვადა',e=>e.program.deadline?.date?formatDate(e.program.deadline.date):'დასაზუსტებელია']
    ] : [['ქვეყანა',e=>e.country],['რეგიონი',e=>optionLabel(CatalogCore.REGIONS,e.region)],['დომენი',e=>e.domains?.join(', ')],['აღწერილი პროგრამები',e=>String(e.programCount)],['მიღება და საფასური',()=> 'კონკრეტული პროგრამის მიხედვით'],['სიის სტატუსი',()=> 'დირექტორიაშია; არ არის აკრედიტაციის დადასტურება']];
    features.push(['შესაბამისობა / 100',e=>{const score=StudentDiscovery.score(e);return score?.fitScore!=null?`${score.fitScore} / 100`:'მონაცემები არასაკმარისია';}],['შეფასების მონაცემთა დაფარვა',e=>{const score=StudentDiscovery.score(e);return score?`${score.dataCoverage}%`:'დასაზუსტებელია';}],['კოჰორტის ისტორიული მიღება',e=>{const rate=StudentDiscovery.score(e)?.admissionChance.baseline;return rate?`${rate.percent}% (${rate.cohort}); პირადი შანსი არ არის`:'სანდო სტატისტიკა არ არის მითითებული';}]);
    $('compareTableBody').innerHTML=features.map(([label,read])=>`<tr><td>${label}</td>${entities.map(entity=>`<td>${escapeHTML(read(entity)||'დასაზუსტებელია')}</td>`).join('')}</tr>`).join(''); openModal('compareModal');
}
function toggleFavorite(id) {
    const added=!favoritesList.includes(id);
    if(added&&!entityMap.has(id))return;
    if(added&&favoritesList.length>=200){notify('შენი სია უკვე შეიცავს 200 ჩანაწერს. ჯერ წაშალე არასაჭირო არჩევანი.');return;}
    favoritesList=added?[...favoritesList,id]:favoritesList.filter(item=>item!==id); writeStored(favoriteKey(),favoritesList);
    document.querySelectorAll('[data-action="favorite"]').forEach(button=>{if(button.dataset.id!==id)return;button.classList.toggle('active',added);button.textContent=added?'♥':'♡';button.setAttribute('aria-pressed',String(added));button.setAttribute('aria-label',added?'ფავორიტებიდან წაშლა':'ფავორიტებში დამატება');});
    renderFavorites(); notify(added?'შენახულია შენს ფავორიტებში.':'ჩანაწერი ფავორიტებიდან წაიშალა.');
    if(currentUser){currentUser.favorites=[...favoritesList];api('/api/user/profile',{method:'PUT',headers:authHeaders(),body:JSON.stringify({favorites:favoritesList})}).catch(()=>notify('შენახულია ამ ბრაუზერში; ანგარიშთან სინქრონიზაცია ვერ მოხერხდა.',true));}
}
function renderFavorites() {
    if (typeof StudentWorkspace !== 'undefined') StudentWorkspace.render();
    ['sidebarFavCount','statFavorites'].forEach(id=>$(id).textContent=favoritesList.length);
    if(universitiesStatus==='loading'){$('favoritesList').innerHTML='<div class="skeleton-card"></div>';return;}
    if(!favoritesList.length){$('favoritesList').innerHTML=emptyState('შენი მოკლე სია მზადაა შესავსებად','შეინახე როგორც უნივერსიტეტები, ისე კონკრეტული პროგრამები.','აღმოაჩინე კატალოგი','universities');return;}
    $('favoritesList').innerHTML=favoritesList.map(id=>{const entity=entityMap.get(id);return entity?programCard(entity,false):`<div class="empty-state"><h3>ჩანაწერი მიმდინარე კატალოგში ვერ მოიძებნა</h3><p>ის შეიძლება ძველი საცდელი მონაცემებიდან იყოს შენახული.</p><button class="btn-secondary" data-action="favorite" data-id="${escapeHTML(id)}">სიიდან წაშლა</button></div>`;}).join('');
}
function sourceLinks(sources) {
    return `<ul class="source-links">${(sources||[]).map(source=>{const url=safeLink(source.url);return url?`<li><a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.label||source.name||'წყარო')} ↗</a><small>${escapeHTML(source.checkedAt||source.retrievedAt||'')}</small></li>`:'';}).join('')}</ul>`;
}
function openDynamicUniModal(id) {
    const entity=entityMap.get(id);if(!entity)return;
    const p=entity.program; $('uniModalTitle').setAttribute('data-i18n-ignore',''); $('uniModalTitle').textContent=entity.name; $('uniModalTag').textContent=entity.country;
    const favorite=$('modalFavBtn'); favorite.dataset.action='favorite';favorite.dataset.id=id;favorite.textContent=favoritesList.includes(id)?'♥':'♡';favorite.classList.toggle('active',favoritesList.includes(id));favorite.setAttribute('aria-pressed',String(favoritesList.includes(id)));
    $('uniModal').querySelector('.modal-cover img').src=campusImage(entity);
    let body='';
    if(p){
        const req=p.requirements||{};
        const details=[['პროგრამა',p.title],['საფეხური',optionLabel(CatalogCore.DEGREES,p.degree)],['მიმართულება',fieldLabel(p)],['ენა',programLanguage(p)],['სწავლის რეჟიმი',modeLabel(p.mode)],['ხანგრძლივობა',p.durationMonths?`${p.durationMonths} თვე`:'დასაზუსტებელია'],['სწავლის საფასური',tuitionText(p)],['ვისთვისაა საფასური',p.tuition?.applicantScope==='non-eu'?'EU/EEA-ს გარეთ მყოფი აპლიკანტი':p.tuition?.applicantScope==='international'?'საერთაშორისო აპლიკანტი':'წყაროს პირობების მიხედვით'],['მინ. აკადემიური მოსწრება',req.gpaMin4!=null?`${req.gpaMin4} / 4 GPA`:req.gpaMinPercent!=null?`${req.gpaMinPercent}%`:'ერთიანი პროცენტული ზღვარი არ არის დადასტურებული'],['ენის მოთხოვნა',req.languageTest?`${req.languageTest.name}: ${req.languageTest.minScore}${req.languageTest.componentsMinScore?` · თითო კომპონენტი: ${req.languageTest.componentsMinScore}`:''}`:req.languageLevel||'დასაზუსტებელია'],['განაცხადის ვადა',p.deadline?.date?formatDate(p.deadline.date):'დასაზუსტებელია'],['მიღების ციკლი',p.deadline?.cycle||'დასაზუსტებელია']];
        body=`<div class="detail-grid">${details.map(([label,value])=>`<div><span>${label}</span><strong${label==='პროგრამა'?' data-i18n-ignore':''}>${escapeHTML(value)}</strong></div>`).join('')}</div><div class="catalog-data-note"><strong>საფასური და ფინანსები</strong><p>${escapeHTML(p.tuition?.note||'მოითხოვე მიმდინარე ფასის დაზუსტება.')}</p><p>ცხოვრების, დაზღვევის, ვიზისა და სხვა ხარჯები ამ თანხაში ავტომატურად არ შედის. სტიპენდია გარანტირებული არ არის.</p></div><p class="detail-description">${escapeHTML(req.note||'ზუსტი აკადემიური წინაპირობები გადაამოწმე პროგრამის ოფიციალურ გვერდზე.')}</p><p class="detail-description">${escapeHTML(p.deadline?.note||'')}</p><h3 class="coverage-heading">წყაროები და შემოწმების თარიღი</h3>${sourceLinks(p.sources)}`;
        if(p.studyLocation?.note)body=`<div class="catalog-data-note"><strong>სწავლის ფაქტობრივი ლოკაცია</strong><p data-i18n-ignore>${escapeHTML(p.studyLocation.city)} · ${escapeHTML(CatalogCore.countryInfo(p.studyLocation.countryCode).name)}</p><p>${escapeHTML(p.studyLocation.note)}</p></div>`+body;
    }else{
        const linked=programByInstitution.get(id)||[];
        body=`<p class="detail-description">ეს დაწესებულება უნივერსიტეტების საერთაშორისო დირექტორიაშია. ჩანაწერი შეიცავს სახელს, ქვეყანასა და ვებსაიტს. ის არ ადასტურებს კონკრეტული პროგრამის არსებობას, აკრედიტაციას ან მიღების პირობებს.</p><div class="detail-grid"><div><span>ქვეყანა</span><strong>${escapeHTML(entity.country)}</strong></div><div><span>დომენი</span><strong>${escapeHTML(entity.domains?.join(', '))}</strong></div><div><span>აღწერილი პროგრამები</span><strong>${linked.length}</strong></div><div><span>საფასური / მიღების ვადები</span><strong>კონკრეტული პროგრამის მიხედვით</strong></div></div><h3 class="coverage-heading">პროგრამები ჩვენს კატალოგში</h3>${linked.length?FundingUI.programList(id):'<p class="detail-description">ამ უნივერსიტეტის პროგრამების ოფიციალური აღწერები ჯერ დასამატებელია. ეწვიე უნივერსიტეტის ვებსაიტს — მიმართულება, საფასური და მიღების პირობები იქ გადაამოწმე.</p>'}<h3 class="coverage-heading">დირექტორიის წყარო</h3>${sourceLinks([entity.source])}`;
    }
    $('uniModalDesc').innerHTML=body+FundingUI.section(entity)+StudentDiscovery.scorePanel(entity)+'<p class="scholarship-footnote">ფოტო საილუსტრაციოა. პირობები შეიძლება შეიცვალოს; განაცხადამდე გადაამოწმე ოფიციალური წყარო.</p>';
    const link=safeLink(entity.website);$('uniModalLink').style.display=link?'flex':'none';$('uniModalLink').textContent=p?'პროგრამის ოფიციალური გვერდი ↗':'უნივერსიტეტის ვებსაიტი ↗';if(link)$('uniModalLink').href=link;openModal('uniModal');
}
function modeLabel(mode){return {'full-time':'სრული დატვირთვა','part-time':'ნაწილობრივი დატვირთვა',online:'ონლაინ'}[mode]||'დასაზუსტებელია';}

function readAdvisorPreferences() {
    const cert=$('hasCertSelect').value==='yes';
    const testName=$('certNameSelect').value==='other'?$('certNameCustom').value.trim():$('certNameSelect').value;
    return StudentDiscovery.advisorChoices({countryCode:$('advisorCountry').value,region:$('regionSelect').value,degree:$('degreeSelect').value,field:$('majorSelect').value,language:$('studyLangSelect').value,mode:$('advisorMode').value,budget:$('advisorBudget').value===''?null:Number($('advisorBudget').value),currency:$('advisorCurrency').value,budgetPeriod:'year',requiresFullFunding:$('advisorFunding').checked,gpa4:$('gpa').value===''?null:Number($('gpa').value),languageLevel:$('langLevelSelect').value,languageTests:cert&&testName&&$('certScore').value!==''?[{name:testName,score:Number($('certScore').value),...(testName==='TOEFL iBT'?{scoreScale:'0-120'}:{}),...( $('certComponentScore').value!=='' ? {minComponentScore:Number($('certComponentScore').value)} : {} )}]:[],experienceYears:$('expSelect').value===''?null:Number($('expSelect').value),citizenshipCode:$('citizenshipSelect').value});
}
function syncCertificateBounds() {
    const name=$('certNameSelect').value;
    const ielts=name==='IELTS Academic',toefl=name==='TOEFL iBT';
    $('certScore').max=ielts?'9':toefl?'120':'1000'; $('certScore').step=ielts?'0.5':'1';
    $('certComponentScore').max=ielts?'9':toefl?'30':'1000'; $('certComponentScore').step=ielts?'0.5':'1';
}
function openAdvisorDirectory() {
    closeAllModals();resetFilters(false);
    $('filterCountry').value=lastAdvisorPreferences?.countryCode||'';
    $('filterRegion').value=lastAdvisorPreferences?.region||'';
    setCatalogView('institutions');navigateTo('page-universities');
}
function advisorResultCard(result) {
    const entity=entityMap.get(result.program.id);if(!entity)return '';
    const checked=result.reasons||[];const missing=[...(result.missing||[]),...(result.warnings||[])];
    const text=item=>typeof item==='string'?item:item.message||item.label||item.reason||String(item);
    const criteria=[...checked.map(reason=>({status:'matched',explanation:text(reason)})),...missing.map(reason=>({status:'unknown',explanation:text(reason)}))];
    return `<article class="advisor-match">${programIdentity(entity)}<p class="advisor-card-tuition">${escapeHTML(tuitionText(entity.program))}</p>${StudentDiscovery.scoreBadge(entity,lastAdvisorPreferences,criteria)}</article>`;
}
async function analyzeProfile(event) {
    event.preventDefault();
    if(universitiesStatus!=='ready'){notify('ჯერ დაელოდე კატალოგის ჩატვირთვას, ან სცადე ხელახლა.',true);return;}
    if(!$('gpa').checkValidity()){$('gpa').reportValidity();notify('მიუთითე GPA 0–4 სკალაზე.',true);return;}
    const prefs=readAdvisorPreferences();
    if(prefs.gpa4!==null&&(!Number.isFinite(prefs.gpa4)||prefs.gpa4<0||prefs.gpa4>4)){notify('მიუთითე GPA 0–4 სკალაზე.',true);return;}
    lastAdvisorPreferences=prefs;
    $('aiForm').style.display='none';$('result-container').style.display='block';
    $('result-container').innerHTML='<div class="advisor-loading"><span>✧</span><h3>ვამოწმებთ შენს პირობებს.</h3><p>ოფიციალური პროგრამების მონაცემების მიხედვით.</p></div>';
    advisorTimer=setTimeout(()=>{
        const result=CatalogCore.recommendPrograms(catalogData.programs,catalogData.institutions,prefs,{asOf:todayISO()});
        const scores=new Map(AdmissionScoring.rankPrograms(catalogData.programs,catalogData.institutions,prefs,{asOf:todayISO(),statistics:catalogData.admissionStatistics||[]}).map((item,index)=>[item.programId,index]));
        for(const key of ['matches','needsVerification'])result[key].sort((a,b)=>scores.get(a.program.id)-scores.get(b.program.id));
        const exact=result.matches||[];const verify=result.needsVerification||[];
        const exclusions=(result.excluded||[]).length?`<details class="advisor-exclusions"><summary>რატომ გამოირიცხა ${result.excludedCount} პროგრამა?</summary>${result.excluded.slice(0,12).map(item=>`<div><strong>${escapeHTML(item.program.institutionName)} — ${escapeHTML(item.program.title)}</strong><ul>${item.exclusionReasons.map(reason=>`<li>${escapeHTML(reason)}</li>`).join('')}</ul></div>`).join('')}${result.excludedCount>12?'<p class="small-note">ნაჩვენებია პირველი 12 ჩანაწერი.</p>':''}</details>`:'';
        const section=(title,items,description)=>items.length?`<section class="advisor-group"><h3>${title} <span>${items.length}</span></h3><p>${description}</p>${items.slice(0,6).map(advisorResultCard).join('')}${items.length>6?'<p class="small-note">ნაჩვენებია პირველი 6 ჩანაწერი.</p>':''}</section>`:'';
        $('result-container').innerHTML=`<div class="advisor-result-heading"><span class="eyebrow">EXPLAINABLE PROGRAM MATCHING</span><h3>${exact.length?'შენი პირობების შესაბამისი ჩანაწერები.':verify.length?'აღმოვაჩინეთ შესამოწმებელი შესაძლებლობები.':'ამ პირობებით შესაბამისი პროგრამა არ გვაქვს.'}</h3><p>შემოწმდა ${catalogData.programs.length} პროგრამა ოფიციალური წყაროებით. ფართო დირექტორიის ${catalogData.institutions.length.toLocaleString('en-US')} დაწესებულების უცნობი პროგრამები შესაბამისობად არ ითვლება.</p></div><div class="advisor-counts"><span>ემთხვევა: <b>${exact.length}</b></span><span>დასაზუსტებელია: <b>${verify.length}</b></span><span>გამოირიცხა: <b>${result.excludedCount}</b></span></div>${section('ცნობილი პირობები ემთხვევა',exact,'ეს ნიშნავს მოთხოვნებთან შესაბამისობას არსებული მონაცემებით; მიღებას ან სტიპენდიას არ იძლევა.')}${section('საჭიროა დაზუსტება',verify,'ქვემოთ მითითებული ინფორმაცია აკლია, განსხვავებული სკალითაა ან დამატებით გადამოწმებას მოითხოვს. ეს ჩანაწერები კვალიფიცირებულ შეთავაზებად არ ითვლება.')}${!exact.length&&!verify.length?'<div class="empty-state"><h3>არჩევანი ავტომატურად არ შეგიცვალეთ.</h3><p>სცადე სხვა ქვეყანა, მიმართულება, ვალუტა ან ბიუჯეტი. ყველა უნივერსიტეტი ხელმისაწვდომია ფართო დირექტორიაში.</p></div>':''}${exclusions}<p class="scholarship-footnote">ეს შეფასება ითვლება კატალოგის პირობებით. სასაუბრო AI აგენტი ცალკე ჩანართშია ხელმისაწვდომი. ვალუტა ავტომატურად არ გადაითვლება. სრული დაფინანსება არ იგულისხმება სწავლის ნულოვანი საფასურით.</p><div class="advisor-result-actions"><button class="text-button" onclick="resetAdvisor()">← პირობების შეცვლა</button><button class="btn-main" data-action="apply-scoring-profile">გამოიყენე პროფილი კატალოგში ↗</button><button type="button" class="btn-secondary" data-action="discuss-ai">განვიხილოთ AI-სთან ✧</button><button class="btn-secondary" data-action="advisor-directory">ამ ლოკაციის დირექტორია ↗</button></div>`;
        $('aiModal').querySelector('.modal-box').scrollTo({top:0,behavior:'smooth'});
    },200);
}
