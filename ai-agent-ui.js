'use strict';

const ChatAdvisor = (() => {
    let messages = [];
    let enabled = false;
    let controller = null;
    let statusRequest = null;
    let checkedAt = 0;
    let scope;
    let generation = 0;
    let initialized = false;
    const profileKeys = ['priorDegree','priorSubject','degreeStatus','academicUniversity','academicFaculty','studyGoal','countryCodes','regions','degrees','fields','subjectFields','languages','modes','budget','currency','budgetPeriod','requiresFullFunding','gpa4','languageLevel','languageTests','experienceYears','citizenshipCode','weights','weightPreset'];

    function inputState() {
        const count = [...$('agentMessage').value].length;
        $('agentCharacterCount').textContent = `${count} / 2000`;
        $('agentSend').disabled = !enabled || Boolean(controller) || !$('agentMessage').value.trim();
        $('agentStop').hidden = !controller;
        $('agentClear').disabled = !messages.length && !controller;
        $('agentShareProfile').disabled = Boolean(controller);
        $('agentMessage').readOnly = Boolean(controller);
    }
    function getProfile() {
        if (!$('agentShareProfile').checked) return null;
        const raw = readAdvisorPreferences();
        return Object.fromEntries(profileKeys.filter(key => key in raw).map(key => [key,raw[key]]));
    }
    function profileSummary() {
        $('agentContextSummary').hidden = !$('agentShareProfile').checked;
        if (!$('agentShareProfile').checked) {
            $('agentContextSummary').textContent = 'გაზიარება გამორთულია. საუბარი შენი კითხვებით იწყება.'; return;
        }
        const profile = getProfile();
        const tags = [
            ...(profile.countryCodes || []).map(code => CatalogCore.COUNTRIES[code]?.name || code),
            ...(profile.degrees || []).map(value => optionLabel(CatalogCore.DEGREES,value)),
            ...(profile.fields || []).map(value => optionLabel(CatalogCore.FIELDS,value)),
            ...(profile.budget !== null && profile.budget !== undefined ? [`ბიუჯეტი: ${profile.budget} ${profile.currency} / წელი`] : []),
            ...(profile.gpa4 !== null && profile.gpa4 !== undefined ? [`GPA: ${profile.gpa4} / 4`] : [])
        ];
        $('agentContextSummary').textContent = tags.length ? `გაიზიარება ფორმაში მითითებული ინტერესები და შედეგები: ${tags.slice(0,5).join(' · ')}${tags.length>5?'…':''}` : 'გაიზიარება შეფასების ფორმაში მითითებული პირობები. მათი შეცვლა პროფილის შეფასების ჩანართში შეგიძლია.';
        if(profile.priorDegree||profile.academicUniversity||profile.academicFaculty||profile.studyGoal)$('agentContextSummary').textContent+=' გაზიარებულ პროფილში აკადემიური ბექგრაუნდი და სასწავლო მიზანიც შედის.';
    }
    function scrollConversation() { const panel = $('agentConversation'); panel.scrollTop = panel.scrollHeight; }
    function textElement(tag,className,value) { const node = document.createElement(tag); if (className) node.className = className; node.textContent = value; return node; }
    function renderMessage(message) {
        const item = document.createElement('article'); item.className = 'agent-message'; item.dataset.role = message.role;
        const heading = textElement('div','agent-message-heading','');
        if (message.role === 'assistant') { const avatar = textElement('span','agent-avatar','✧'); avatar.setAttribute('aria-hidden','true'); heading.append(avatar); }
        heading.append(textElement('span','',message.role === 'assistant' ? 'GlobalEdu AI' : 'შენ'));
        const body=textElement('div','agent-message-body',message.content);body.dataset.i18nIgnore='';
        item.append(heading,body);
        if (message.sources?.length) {
            const sources = document.createElement('div'); sources.className = 'agent-message-sources'; sources.setAttribute('aria-label','პასუხთან დაკავშირებული წყაროები');
            message.sources.slice(0,8).forEach(source => {
                const url = safeLink(source.url); if (!url) return;
                const link = textElement('a','',`${source.title || new URL(url).hostname} ↗`);link.dataset.i18nIgnore=''; link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
            });
            item.append(sources);
        }
        if (message.matches?.length) {
            const matches = document.createElement('div'); matches.className = 'agent-matches'; matches.append(textElement('span','','საუბრისას მოძიებული ჩანაწერები'));
            message.matches.slice(0,6).forEach(match => {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'agent-match';
                const copy = document.createElement('div'),name=textElement('strong','',match.name);name.dataset.i18nIgnore='';copy.append(name);
                if (match.title || match.countryCode) {const title=textElement('small','',match.title || CatalogCore.COUNTRIES[match.countryCode]?.name || match.countryCode);if(match.title)title.dataset.i18nIgnore='';copy.append(title);}
                button.append(copy,textElement('span','','↗'));
                button.addEventListener('click',async() => {
                    if (!entityMap.has(match.id)) await fetchUniversities();
                    if (entityMap.has(match.id)) openDynamicUniModal(match.id); else notify('ჩანაწერი მიმდინარე კატალოგში ვერ მოიძებნა.',true);
                });
                matches.append(button);
            });
            item.append(matches);
        }
        return item;
    }
    function render() {
        $('agentWelcome').hidden = Boolean(messages.length);
        $('agentMessages').replaceChildren(...messages.map(renderMessage));
        inputState();
    }
    function showError(message) { $('agentError').textContent = message; $('agentError').hidden = false; }
    function hideError() { $('agentError').hidden = true; $('agentError').textContent = ''; }
    async function checkStatus(force = false) {
        if (statusRequest) return statusRequest;
        if (!force && checkedAt && Date.now()-checkedAt < 30000) return;
        $('agentCheckStatus').disabled = true;
        $('agentStatusLabel').textContent = 'ხელმისაწვდომობა მოწმდება'; $('agentStatusDot').dataset.state = 'checking';
        statusRequest = (async() => {
            try {
                const response = await api('/api/advisor-agent/status'); const data = await response.json();
                enabled = data.enabled === true;
                $('agentStatusLabel').textContent = enabled ? 'შეგიძლია საუბარი დაიწყო' : 'AI ჩატი ჯერ მიუწვდომელია';
                $('agentStatusDot').dataset.state = enabled ? 'ready' : 'unavailable';
                $('agentAvailability').hidden = enabled;
                $('agentAvailabilityTitle').textContent = 'AI ჩატი ჯერ მიუწვდომელია';
                $('agentAvailabilityCopy').textContent = 'სასაუბრო სერვისი ჯერ არ არის გააქტიურებული. მანამდე გამოიყენე პროფილის შეფასება და უნივერსიტეტების კატალოგი.';
                checkedAt = Date.now();
            } catch {
                enabled = false; checkedAt = 0;
                $('agentStatusLabel').textContent = 'სერვისი დროებით მიუწვდომელია'; $('agentStatusDot').dataset.state = 'unavailable';
                $('agentAvailability').hidden = false; $('agentAvailabilityTitle').textContent = 'სერვისთან კავშირი ვერ დამყარდა';
                $('agentAvailabilityCopy').textContent = 'ცოტა ხანში სცადე ხელახლა. შეფასების ფორმა და კატალოგი კვლავ ხელმისაწვდომია.';
            } finally { statusRequest = null; $('agentCheckStatus').disabled = false; inputState(); }
        })();
        return statusRequest;
    }
    function switchTab(tab, focus = false) {
        const chat = tab === 'chat';
        $('advisorProfilePanel').hidden = chat; $('advisorChatPanel').hidden = !chat;
        for (const [id,active] of [['advisorProfileTab',!chat],['advisorChatTab',chat]]) { $(id).setAttribute('aria-selected',String(active)); $(id).tabIndex = active ? 0 : -1; }
        $('aiModal').querySelector('.modal-box').classList.toggle('agent-chat-mode',chat);
        $('aiTitle').innerHTML = chat ? 'შენი <span class="accent-text">AI მრჩეველი.</span>' : 'ვიპოვოთ <span class="accent-text">შენი პროგრამა.</span>';
        $('advisorModeDescription').textContent = chat ? 'დავგეგმოთ შენი შემდეგი ნაბიჯი.' : 'შეაფასე შენი ინტერესები ან ესაუბრე AI აგენტს და ერთად დაგეგმეთ სწავლის შემდეგი ნაბიჯი.';
        if (chat) { accountChanged(); profileSummary(); checkStatus(); if (!messages.length) $('agentConversation').scrollTop = 0; }
        if (focus) $(chat?'advisorChatTab':'advisorProfileTab').focus();
        $('aiModal').querySelector('.modal-box').scrollTop = 0;
    }
    function open() { openModal('aiModal'); switchTab('chat'); }
    function discussProfile() {
        open(); $('agentShareProfile').checked = true; profileSummary();
        if (!controller) { $('agentMessage').value = 'ამიხსენი ჩემი პროფილის შეფასება: რა შეესაბამება პროგრამების მოთხოვნებს და რა საკითხები უნდა დავაზუსტო?'; inputState(); $('agentMessage').focus(); }
    }
    function cancel({silent=false} = {}) {
        if (!controller) return;
        generation++; controller.abort(); controller = null;
        const latest = messages.at(-1);
        if (latest?.role === 'user') { $('agentMessage').value = latest.content; messages.pop(); }
        $('agentThinking').hidden = true; render();
        if (!silent) showError('პასუხის მიღება შეჩერებულია. შეგიძლია კითხვა შეცვალო ან ხელახლა გაგზავნო.');
    }
    function clear() {
        cancel({silent:true}); generation++; messages = []; $('agentMessage').value = ''; hideError(); render();
        $('agentConversation').scrollTop = 0;
    }
    function accountChanged() {
        const next = `${DESIGN_PREVIEW?'preview:':''}${currentUser?.id || currentUser?._id || 'guest'}`;
        if (scope === next) return;
        scope = next; clear(); $('agentShareProfile').checked = false; profileSummary();
    }
    async function send(event) {
        event.preventDefault(); if (controller || !enabled) return;
        const content = $('agentMessage').value.trim(); if (!content || [...content].length > 2000) return;
        if($('agentShareProfile').checked&&!$('gpa').checkValidity()){showError('GPA მიუთითე 0–4 სკალაზე. შეასწორე შედეგი პროფილის შეფასების ჩანართში.');return;}
        hideError(); const profile = getProfile();
        // Keep seven complete turns and the new question; no chat content enters localStorage.
        const history = messages.slice(-14).map(message => ({role:message.role,content:message.content}));
        while (history.length && history.reduce((total,message) => total+message.content.length,content.length) > 24000) history.splice(0,2);
        messages.push({role:'user',content}); $('agentMessage').value = '';
        controller = new AbortController(); const requestController = controller; const turn = ++generation;
        $('agentThinking').hidden = false; render(); scrollConversation();
        try {
            const signal = AbortSignal.any([requestController.signal,AbortSignal.timeout(55000)]);
            const response = await api('/api/advisor-agent/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({messages:[...history,{role:'user',content}],profile,locale:window.I18n?.getLanguage?.()||'ka'})});
            const data = await response.json(); if (turn !== generation) return;
            if (typeof data.reply !== 'string' || !data.reply.trim()) throw new Error('პასუხი ვერ მივიღეთ. სცადე ხელახლა.');
            messages.push({role:'assistant',content:data.reply,sources:Array.isArray(data.sources)?data.sources:[],matches:Array.isArray(data.matches)?data.matches:[]});
            $('agentStatusLabel').textContent = 'შეგიძლია საუბარი გააგრძელო'; $('agentStatusDot').dataset.state = 'ready';
            if (messages.length > 40) messages = messages.slice(-40);
        } catch (error) {
            if (turn !== generation) return;
            messages.pop(); $('agentMessage').value = content;
            showError(['AbortError','TimeoutError'].includes(error.name) ? 'პასუხის მიღებას მეტი დრო დასჭირდა. შენი კითხვა შენახულია — სცადე ხელახლა.' : error.name === 'TypeError' ? 'სერვერთან კავშირი გაწყდა. სცადე ხელახლა.' : error.message);
            if (error.status === 503) { checkedAt = 0; $('agentStatusLabel').textContent = 'სერვისი ამჟამად მიუწვდომელია'; $('agentStatusDot').dataset.state = 'unavailable'; }
        } finally {
            if (turn === generation) { controller = null; $('agentThinking').hidden = true; render(); scrollConversation(); }
        }
    }
    function init() {
        if (initialized) return; initialized = true;
        $('agentChatForm').addEventListener('submit',send);
        $('agentMessage').addEventListener('input',inputState);
        $('agentMessage').addEventListener('keydown',event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); if (!$('agentSend').disabled) $('agentChatForm').requestSubmit(); } });
        $('agentStop').addEventListener('click',() => cancel()); $('agentClear').addEventListener('click',clear);
        $('agentCheckStatus').addEventListener('click',() => checkStatus(true));
        $('agentShareProfile').addEventListener('change',profileSummary);
        $('aiForm').addEventListener('change',profileSummary);
        document.querySelectorAll('[data-agent-prompt]').forEach(button => button.addEventListener('click',() => { if (controller) return; $('agentMessage').value = button.dataset.agentPrompt; inputState(); $('agentMessage').focus(); }));
        document.querySelector('.advisor-mode-tabs').addEventListener('keydown',event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const chat = $('advisorChatTab').getAttribute('aria-selected') === 'true'; switchTab(event.key === 'Home' ? 'profile' : event.key === 'End' ? 'chat' : chat ? 'profile' : 'chat',true); });
        accountChanged(); render();
    }
    return {init,open,discussProfile,switchTab,accountChanged,onClose:() => cancel({silent:true})};
})();
