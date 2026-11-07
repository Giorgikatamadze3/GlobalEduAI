'use strict';
const StudentWorkspace=(()=>{
    const Core=StudentWorkspaceCore;
    const stageNames={researching:'ვიკვლევ',preparing:'ვამზადებ განაცხადს',submitted:'განაცხადი გაგზავნილია',offer:'შეთავაზება მივიღე',closed:'დავასრულე'};
    const taskNames={shortlist:'შეარჩიე სასურველი პროგრამები',requirements:'გადაამოწმე მიღების მოთხოვნები',funding:'შეამოწმე დაფინანსების პირობები',documents:'მოამზადე საჭირო დოკუმენტები'};
    let bound=false,loadedKey=null,loading=null,cloud=null,revision=0,saving=false;
    function key(){return Core.accountKey(currentUser,DESIGN_PREVIEW);}
    function read(){if(!DESIGN_PREVIEW&&loadedKey===key()&&cloud)return Core.normalize(cloud);try{return Core.normalize(JSON.parse(localStorage.getItem(key())));}catch{return Core.normalize(null);}}
    async function load(){
        if(DESIGN_PREVIEW||currentUser?.role!=='student'||loading||loadedKey===key())return;
        const accountKey=key();loading=accountKey;
        try{const old=localStorage.getItem(accountKey);if(old&&!localStorage.getItem(accountKey+':legacy'))localStorage.setItem(accountKey+':legacy',old);}catch{/* A cloud plan does not depend on local storage availability. */}
        try{const r=await api('/api/user/workspace'),data=await r.json();if(key()!==accountKey)return;cloud=Core.normalize(data.workspace);revision=data.workspace.revision;loadedKey=accountKey;render();}
        catch{if(key()===accountKey)notify('გეგმის სინქრონიზაცია ვერ მოხერხდა. ბრაუზერის ჩანაწერი შენარჩუნებულია.',true);}
        finally{if(loading===accountKey)loading=null;if(currentUser?.role==='student'&&key()!==accountKey)load();}
    }
    async function save(value){
        if(!key()||currentUser?.role!=='student'||saving)return false;
        if(!DESIGN_PREVIEW&&loadedKey!==key()){notify('ჯერ განაახლე გეგმის მონაცემები.',true);await load();return false;}
        const accountKey=key(),normalized=Core.normalize(value);saving=true;
        try{
            if(!DESIGN_PREVIEW){const r=await api('/api/user/workspace',{method:'PUT',headers:authHeaders(),body:JSON.stringify({workspace:normalized,revision})});const data=await r.json();if(key()!==accountKey)return false;revision=data.workspace.revision;cloud=Core.normalize(data.workspace);}
            try{localStorage.setItem(accountKey,JSON.stringify(normalized));}catch{/* Cloud save remains successful when local storage is unavailable. */}
            return true;
        }catch(error){notify(error.message,true);if(error.status===409){loadedKey=null;await load();}return false;}
        finally{saving=false;}
    }
    function programs(){return favoritesList.map(id=>entityMap.get(id)?.program).filter(Boolean);}
    function render(){
        const overview=$('studentWorkspaceOverview'),board=$('studentPlannerBoard');
        if(!overview||!board)return;
        if(currentUser?.role!=='student'){overview.innerHTML='';board.innerHTML='';return;}
        if(loadedKey!==key()&&!loading){cloud=null;load();}
        if(typeof StudyCalendar!=='undefined')StudyCalendar.render();
        const p=programs(),state=read(),completion=Core.completion(currentUser),upcoming=Core.deadlines(p,todayISO());
        overview.innerHTML=`<div class="workspace-topline"><div><span class="eyebrow">შენი შემდეგი ნაბიჯი</span><h3>დიდი გეგმები, პატარა ნაბიჯებით.</h3></div><button class="text-button" onclick="switchDashTab('planner')">ჩემი გეგმა ↗</button></div><div class="workspace-grid"><article class="workspace-card completion-card"><div class="workspace-card-top"><span class="workspace-symbol" aria-hidden="true">◎</span><strong>პროფილის შევსება</strong><b>${completion.percent}%</b></div><progress max="100" value="${completion.percent}" aria-label="პროფილის შევსება">${completion.percent}%</progress><p>${completion.completed} / ${completion.total}</p><span class="small-note">შეავსე განათლებისა და საკონტაქტო ველები ქვემოთ.</span></article><article class="workspace-card"><div class="workspace-card-top"><span class="workspace-symbol" aria-hidden="true">↗</span><strong>უახლოესი ვადები</strong></div>${upcoming.length?`<ul class="workspace-deadlines">${upcoming.slice(0,3).map(item=>`<li><button data-action="university" data-id="${escapeHTML(item.id)}" data-i18n-ignore>${escapeHTML(item.title)}</button><time datetime="${item.date}">${formatDate(item.date)}</time></li>`).join('')}</ul>`:'<p>შენახულ პროგრამებში მომავალი დადასტურებული ვადა ჯერ არ არის.</p>'}<span class="small-note">აქ ჩანს მხოლოდ წყაროში მითითებული პროგრამის ვადა.</span></article></div><article class="workspace-card workspace-checklist"><div><span class="eyebrow">განაცხადის მომზადება</span><h3>შენი მოკლე გზამკვლევი</h3><p class="small-note">მონიშნე შესრულებული ნაბიჯები შენს ანგარიშში.</p></div><div>${Object.entries(taskNames).map(([id,label])=>`<label class="workspace-task"><input type="checkbox" data-workspace-task="${id}" ${state.tasks[id]?'checked':''}><span>${label}</span></label>`).join('')}</div></article>`;
        board.innerHTML=universitiesStatus==='loading'?'<p role="status">იტვირთება საერთაშორისო კატალოგი...</p>':!p.length?`<div class="workspace-empty"><span aria-hidden="true">♡</span><h3>პირველი ნაბიჯი — შენი არჩევანი</h3><p>კატალოგში შეინახე კონკრეტული პროგრამა და აქ დაგეგმე განაცხადი.</p><button class="btn-main" onclick="navigateTo('page-universities')">პროგრამების აღმოჩენა ↗</button></div>`:p.map(program=>{
            const plan=state.plans[program.id]||{stage:'researching',targetDate:'',note:''};
            return `<form class="workspace-plan" data-plan-id="${escapeHTML(program.id)}"><div class="workspace-plan-heading"><span class="workspace-symbol" aria-hidden="true">↗</span><div><button type="button" class="workspace-program-title" data-action="university" data-id="${escapeHTML(program.id)}" data-i18n-ignore>${escapeHTML(program.title)}</button><p data-i18n-ignore>${escapeHTML(program.institutionName)}</p></div><span class="tag tag-neutral">${stageNames[plan.stage]}</span></div><div class="workspace-source-date"><span>პროგრამის ოფიციალური ვადა</span><strong>${program.deadline?.date?formatDate(program.deadline.date):'დასაზუსტებელია'}</strong>${program.deadline?.cycle?`<small data-i18n-ignore>${escapeHTML(program.deadline.cycle)}</small>`:''}</div><div class="form-grid"><div class="form-group"><label for="stage-${program.id}">ჩემი ეტაპი</label><select id="stage-${program.id}" name="stage">${Object.entries(stageNames).map(([value,label])=>`<option value="${value}" ${plan.stage===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="form-group"><label for="date-${program.id}">ჩემი სამიზნე თარიღი</label><input id="date-${program.id}" name="targetDate" type="date" value="${plan.targetDate}"><small class="small-note">პირადი გეგმა; უნივერსიტეტის ვადას არ ცვლის.</small></div></div><div class="form-group"><label for="note-${program.id}">ჩემი ჩანაწერი</label><textarea id="note-${program.id}" name="note" maxlength="1000" rows="2" placeholder="რა გაქვს მოსამზადებელი?">${escapeHTML(plan.note)}</textarea></div><div class="workspace-plan-footer"><span class="small-note">ეტაპს შენ ანახლებ; საიტი განაცხადს არ აგზავნის.</span><button type="submit" class="btn-secondary">გეგმის შენახვა</button></div></form>`;
        }).join('');
        if(!bound){
            bound=true;
            overview.addEventListener('change',async event=>{const input=event.target,id=input.dataset.workspaceTask;if(!Object.hasOwn(taskNames,id))return;const state=read();state.tasks[id]=input.checked;input.disabled=true;if(await save(state))notify(DESIGN_PREVIEW?'ნაბიჯი შენახულია ამ ბრაუზერში.':'ნაბიჯი შენახულია შენს ანგარიშში.');else input.checked=!input.checked;input.disabled=false;});
            board.addEventListener('submit',async event=>{const form=event.target.closest('[data-plan-id]');if(!form)return;event.preventDefault();if(!programs().some(p=>p.id===form.dataset.planId))return;const data=new FormData(form),state=read();state.plans[form.dataset.planId]={stage:data.get('stage'),targetDate:data.get('targetDate'),note:data.get('note')};const button=form.querySelector('[type=submit]');button.disabled=true;if(await save(state)){render();notify(DESIGN_PREVIEW?'გეგმა შენახულია ამ ბრაუზერში.':'გეგმა შენახულია შენს ანგარიშში.');}button.disabled=false;});
            window.addEventListener('storage',event=>{if(event.key===key())render();});
            // I18n translates the existing DOM without discarding an unsaved note.
        }
    }
    function exportPlan(){
        if(currentUser?.role!=='student')return;
        const data={exportedAt:todayISO(),storage:DESIGN_PREVIEW?'This browser only.':'Account-synced personal plan; not university application status.',...read(),programs:programs().map(p=>({id:p.id,title:p.title,institutionName:p.institutionName,url:p.programUrl,officialDeadline:p.deadline}))};
        const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='globaledu-study-plan.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
    async function importLocal(){
        let local;try{local=Core.normalize(JSON.parse(localStorage.getItem(key()+':legacy')||localStorage.getItem(key())));}catch{return;}
        const current=read(),merged={plans:{...local.plans,...current.plans},tasks:{...current.tasks}};
        for(const name of Object.keys(taskNames))merged.tasks[name]=current.tasks[name]||local.tasks[name];
        if(await save(merged)){render();notify('ბრაუზერის ძველი ჩანაწერები ანგარიშში დამატებულია. არსებული ჩანაწერები შენარჩუნებულია.');}
    }
    return Object.freeze({render,exportPlan,importLocal,snapshot:()=>currentUser?.role==='student'?read():Core.normalize(null)});
})();
