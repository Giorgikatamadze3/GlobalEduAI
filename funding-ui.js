'use strict';

const FundingUI = (() => {
    const esc=value=>escapeHTML(String(value??''));
    const calls={open:'მიღება ღიაა','not-yet-open':'მიღება ჯერ არ დაწყებულა',closed:'მიღება დახურულია',unknown:'ვადა გადასამოწმებელია'};
    const statuses={listed:'კავშირი დადასტურებულია',potential:'შესაძლო გარე დაფინანსება','needs-verification':'პირობები დასაზუსტებელია'};
    function assessmentCard(a,overview=false) {
        const coverage=a.coverage;
        const tuition=coverage.tuitionFull===true?'შესაძლებელია სრული სწავლის საფასურის დაფარვა':coverage.tuitionFull===false?'სწავლის საფასურს სრულად არ ფარავს':'სწავლის საფასურის დაფარვა დასაზუსტებელია';
        const living=coverage.livingSupport===true?'საცხოვრებელი ხარჯების მხარდაჭერა გათვალისწინებულია':coverage.livingSupport===false?'საცხოვრებელი ხარჯების მხარდაჭერა არ შედის':'საცხოვრებელი ხარჯები დასაზუსტებელია';
        const conditions=[...(a.reasons||[]),...(a.missing||[])];
        const dates=[a.call.opensAt?`იწყება: ${formatDate(a.call.opensAt)}`:'',a.call.deadline?`ვადა: ${formatDate(a.call.deadline)}`:'',a.call.cycle?`ციკლი: ${a.call.cycle}`:''].filter(Boolean).join(' · ');
        const linked=(a.associatedProgramIds||[]).map(id=>entityMap.get(id)).filter(Boolean);
        const programmes=linked.length?`<div class="funding-linked-programs"><strong>დადასტურებული კავშირი: ${linked.length} პროგრამა</strong>${linked.slice(0,6).map(entity=>`<button class="text-button" data-action="university" data-id="${esc(entity.id)}">${esc(entity.program.title)} ↗</button>`).join('')}${linked.length>6?`<small>და კიდევ ${linked.length-6} პროგრამა</small>`:''}</div>`:'';
        const scope=`${a.scope.degrees.map(degree=>optionLabel(CatalogCore.DEGREES,degree)).join(' · ')}${a.scope.countryCodes.length?` / ${a.scope.countryCodes.map(code=>CatalogCore.countryInfo(code).name).join(', ')}`:''}`;
        return `<article class="funding-card"><div class="funding-card-top"><span class="funding-provider">${esc(a.provider)}</span><span class="funding-call ${esc(a.callStatus)}">${esc(calls[a.callStatus]||calls.unknown)}</span></div><h4>${esc(a.title)}</h4><p class="funding-scope">${esc(scope)}</p>${overview?'':`<span class="funding-association">${esc(a.associationStatus==='listed'?statuses.listed:statuses[a.status]||statuses['needs-verification'])}</span>`}<ul class="funding-benefits"><li>${tuition}</li><li>${living}</li></ul>${dates?`<p class="funding-dates">${esc(dates)}</p>`:''}<details class="funding-rules"><summary>მოთხოვნები, გამონაკლისები და წყაროები</summary><p>${esc(coverage.note)}</p>${a.call.note?`<p>${esc(a.call.note)}</p>`:''}${conditions.length?`<ul>${conditions.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}${(a.notes||[]).map(note=>`<p>${esc(note)}</p>`).join('')}${sourceLinks(a.sources)}</details>${programmes}${overview?`<button type="button" class="text-button" data-funding-filter="${esc(a.id)}">შესაბამისი პროგრამები ↗</button>`:''}<small class="funding-no-guarantee">დაფინანსება კონკურსით გაიცემა. კავშირი არ ნიშნავს პირად შესაბამისობას ან დაფინანსების გარანტიას.</small></article>`;
    }
    function section(entity) {
        if(!catalogData?.funding)return '';
        const p=entity.program;
        const institution=p?entityMap.get(p.institutionId):entity;
        const options={asOf:todayISO()};
        const assessments=p?FundingCore.fundingForProgram(p,institution,catalogData.funding,null,options):FundingCore.fundingForInstitution(institution,programByInstitution.get(entity.id)||[],catalogData.funding,null,options);
        const relevant=assessments.filter(a=>a.status!=='ineligible');
        relevant.sort((a,b)=>Number(b.associationStatus==='listed')-Number(a.associationStatus==='listed'));
        return `<section class="funding-section"><div class="funding-section-heading"><span class="eyebrow">FUND YOUR NEXT CHAPTER</span><h3>დაფინანსების გზები <span>${relevant.length}</span></h3><p>${p?'შესაძლებლობები ამ პროგრამის ცნობილი მონაცემების მიხედვით.':'ინსტიტუციური სქემები და ჩვენთან აღწერილი პროგრამების შესაძლო გარე დაფინანსება. სქემა უნივერსიტეტის ყველა პროგრამას არ ეხება.'} მოქალაქეობა, გამოცდილება და სხვა პირადი პირობები ცალკე გადაამოწმე.</p></div>${relevant.length?`<div class="funding-grid">${relevant.map(a=>assessmentCard(a)).join('')}</div>`:'<div class="catalog-data-note"><p>ამ ჩანაწერისთვის დადასტურებული შესაძლებლობა ჩვენს ნაწილობრივ კატალოგში ჯერ არ არის. ეს დაფინანსების არარსებობას არ ნიშნავს — გადაამოწმე უნივერსიტეტის ოფიციალური გვერდი.</p></div>'}</section>`;
    }
    function programRows(id,query='',page=1) {
        const all=programByInstitution.get(id)||[];
        const found=all.filter(p=>p.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
        const pages=Math.max(1,Math.ceil(found.length/12));page=Math.max(1,Math.min(pages,Number(page)||1));
        const rows=found.slice((page-1)*12,page*12).map(p=>`<button class="advisor-program" data-action="university" data-id="${esc(p.id)}"><div><strong>${esc(p.title)}</strong><small>${esc(optionLabel(CatalogCore.DEGREES,p.degree))} · ${esc(tuitionText(p))}</small></div><span>↗</span></button>`).join('');
        return `<p class="funding-list-count">ნაჩვენებია ${found.length?((page-1)*12+1):0}–${Math.min(page*12,found.length)} / ${found.length} პროგრამა · დაფარვა ნაწილობრივია</p>${rows||'<p>ამ ძიებით პროგრამა ვერ მოიძებნა.</p>'}${pages>1?`<div class="funding-pagination"><button class="btn-secondary" data-program-page="${page-1}" ${page===1?'disabled':''}>← წინა</button><span>${page} / ${pages}</span><button class="btn-secondary" data-program-page="${page+1}" ${page===pages?'disabled':''}>შემდეგი →</button></div>`:''}`;
    }
    function programList(id) {
        return `<div class="funding-program-list" data-institution="${esc(id)}"><label class="funding-program-search">პროგრამის ძიება<input type="search" data-program-query placeholder="მოძებნე დასახელებით..."></label><div data-program-rows>${programRows(id)}</div></div>`;
    }
    function init() {
        const select=$('filterFundingScheme');
        select.innerHTML=optionsHTML(catalogData.funding.schemes.map(s=>({value:s.id,label:s.title})),'ყველა შესაძლებლობა');
        const grid=document.querySelector('#page-scholarships .scholarship-grid');
        if(grid){
            const assessments=FundingCore.fundingForProgram(null,null,catalogData.funding,null,{asOf:todayISO()});
            grid.className='funding-grid scholarship-grid';
            grid.innerHTML=assessments.map(a=>assessmentCard(a,true)).join('');
            document.querySelector('#page-scholarships .heading-meta').textContent=`${assessments.length} სქემა · გერმანია და ევროპა · შემოწმდა ${catalogData.funding.metadata.checkedAt}`;
        }
    }
    document.addEventListener('input',event=>{
        if(!event.target.matches('[data-program-query]'))return;
        const box=event.target.closest('[data-institution]');
        box.querySelector('[data-program-rows]').innerHTML=programRows(box.dataset.institution,event.target.value);
    });
    document.addEventListener('click',event=>{
        const page=event.target.closest('[data-program-page]');
        if(page){const box=page.closest('[data-institution]');box.querySelector('[data-program-rows]').innerHTML=programRows(box.dataset.institution,box.querySelector('input').value,page.dataset.programPage);}
        const filter=event.target.closest('[data-funding-filter]');
        if(filter){resetFilters();$('filterFundingScheme').value=filter.dataset.fundingFilter;setCatalogView('programs',true);navigateTo('page-universities');}
    });
    return {init,section,programList};
})();
