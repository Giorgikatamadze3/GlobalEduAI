'use strict';

const $ = id => document.getElementById(id);
const API_BASE = location.protocol === 'file:' || ['5500','5501','5173','4173'].includes(location.port)
    ? 'http://localhost:3000' : '';
const PAGE_SIZE = 12;
let allUniversities = [];
let agencies = [];
let compareList = [];
let favoritesList = [];
let currentUser = DESIGN_PREVIEW ? {...PREVIEW_USER, favorites:[...PREVIEW_USER.favorites]} : null;
let currentPage = 1;
let universitiesStatus = 'loading';
let previousFocus = null;
let advisorTimer;

function storageKey(key) { return DESIGN_PREVIEW ? `designPreview:${key}` : key; }
function readStored(key, fallback) {
    try { return JSON.parse(localStorage.getItem(storageKey(key))) ?? fallback; }
    catch { return fallback; }
}
function writeStored(key, value) {
    try { localStorage.setItem(storageKey(key), JSON.stringify(value)); } catch { /* Storage can be disabled. */ }
}
function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function plainText(value = '') {
    return new DOMParser().parseFromString(String(value), 'text/html').body.textContent || '';
}
function safeLink(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
}
function formatPrice(value) { return value == null ? 'დასაზუსტებელია' : `${Number(value).toLocaleString(I18n.getLanguage())}`; }
function formatDate(value) {
    if (!value) return 'დასაზუსტებელია';
    const date = new Date(value);
    const locale={ka:'ka-GE',en:'en-GB',ru:'ru-RU',de:'de-DE',fr:'fr-FR',es:'es-ES',tr:'tr-TR'}[globalThis.I18n?.getLanguage?.()||'ka'];
    return Number.isNaN(date.getTime()) ? 'დასაზუსტებელია' : date.toLocaleDateString(locale,{day:'numeric',month:'long',year:'numeric',...(/^\d{4}-\d{2}-\d{2}$/.test(value)?{timeZone:'UTC'}:{})});
}
function notify(message, error = false) {
    const toast = document.createElement('div');
    toast.className = `toast${error ? ' error' : ''}`;
    const icon = document.createElement('span'); icon.textContent = error ? '!' : '✓';
    const text = document.createElement('div'); text.textContent = message;
    const close = document.createElement('button'); close.textContent = '×'; close.setAttribute('aria-label', 'შეტყობინების დახურვა');
    close.onclick = () => toast.remove();
    toast.append(icon, text, close); $('toastRegion').append(toast);
    setTimeout(() => toast.remove(), error ? 8000 : 4500);
}
async function api(path, options = {}) {
    if (DESIGN_PREVIEW) {
        const previewResponse = previewAccountRequest(path, options);
        if (previewResponse) return previewResponse;
        if (path === '/api/agencies') return new Response(JSON.stringify(PREVIEW_AGENCIES), {headers:{'Content-Type':'application/json'}});
    }
    const response = await fetch(`${API_BASE}${path}`, { signal:AbortSignal.timeout(15000), credentials:'include', ...options });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const error = new Error(body.message || 'მოთხოვნა ვერ შესრულდა. სცადე ხელახლა.');
        error.status = response.status; error.fields = body.fields || {}; error.code=body.code;
        if(body.code==='UPGRADE_REQUIRED'&&typeof BillingUI!=='undefined')BillingUI.upgrade();
        if (response.status === 401 && !path.startsWith('/api/auth/')) expireAccountSession();
        throw error;
    }
    return response;
}
function favoriteKey() { return `globalEduFavorites:${currentUser?._id || currentUser?.email || 'guest'}`; }
function restoreFavorites() {
    const saved = readStored(favoriteKey(), null);
    favoritesList = currentUser ? [...(currentUser.favorites || [])] : (Array.isArray(saved) ? saved : []);
}

// Navigation and dialogs
function navigateTo(pageId, updateHash = true) {
    pageId=pageId.split('?')[0];
    if(updateHash)Experience.saveScroll();
    if(['page-admin','page-business'].includes(pageId)&&!$(pageId)){
        if(currentUser?.permissions?.admin){Experience.loadAdmin(pageId,updateHash).catch(()=>{});return;}
        pendingAuthPage=authReady?null:pageId;pageId=currentUser?'page-dashboard':'page-register';
    }
    if(!updateHash&&pageId==='page-universities')Experience.restoreSearch();
    if (['page-scholarships','page-loans'].includes(pageId)) pageId='page-funding';
    if (!$(pageId)?.classList.contains('app-page')) return navigateTo('page-home',false);
    if(['page-admin','page-business'].includes(pageId)&&!currentUser?.permissions?.admin){pendingAuthPage=authReady?null:pageId;pageId=currentUser?'page-dashboard':'page-register';}
    if (['page-dashboard','page-billing'].includes(pageId) && !currentUser) { pendingAuthPage = authReady ? null : pageId; pageId = 'page-register'; }
    document.querySelectorAll('.app-page').forEach(page => page.classList.toggle('active', page.id === pageId));
    const privatePage = ['page-register', 'page-dashboard','page-admin','page-business','page-billing','page-reset-password'].includes(pageId);
    $('main-nav').style.display = privatePage ? 'none' : 'flex';
    $('main-footer').style.display = privatePage ? 'none' : 'block';
    document.querySelectorAll('.nav-links [data-page]').forEach(link => {
        const active = link.dataset.page === pageId;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    $('navLinks').classList.remove('open'); $('menuToggle').setAttribute('aria-expanded', 'false');
    if(['page-home','page-universities','page-funding','page-dashboard'].includes(pageId)&&!catalogData&&!catalogRequest)fetchUniversities();
    if(pageId==='page-agencies'&&!agencies.length)fetchAgencies();
    if (pageId === 'page-universities') filterAndSortUnis(false);
    if (pageId === 'page-dashboard') renderFavorites();
    if(pageId==='page-admin')AdminUI.load();
    if(pageId==='page-business')BusinessUI.load();
    if(pageId==='page-billing')BillingUI.refresh();
    if(pageId==='page-universities')BillingUI.track('discovery');
    renderCompareBar();
    if (updateHash && location.hash !== `#${pageId.replace('page-', '')}`) history.pushState(null, '', pageId==='page-universities'?Experience.searchHash():`#${pageId.replace('page-', '')}`);
    Experience.focusPage(pageId);
    window.scrollTo({top:!updateHash&&pageId==='page-universities'?history.state?.catalogScroll||0:0,behavior:'instant'});
}
function openModal(id) {
    if (id !== 'aiModal') ChatAdvisor.onClose();
    const visible = document.querySelector('.modal-overlay[style*="flex"]');
    if (!visible) previousFocus = document.activeElement;
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    $(id).style.display = 'flex'; document.body.classList.add('modal-open');
    $(id).querySelector('[role="dialog"]').focus();
}
function closeAllModals() {
    ChatAdvisor.onClose();
    clearTimeout(advisorTimer);
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
    document.body.classList.remove('modal-open');
    if ($('result-container').querySelector('.advisor-loading')) resetAdvisor();
    if (previousFocus?.isConnected) previousFocus.focus();
}
function showAiModal(event) { event?.preventDefault(); openModal('aiModal'); ChatAdvisor.switchTab('profile'); }
function toggleTheme() {
    const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme; writeStored('globalEduTheme', theme); syncThemeButtons();
}
function syncThemeButtons() {
    const dark = document.documentElement.dataset.theme === 'dark';
    ['themeToggle', 'themeToggleDash'].forEach(id => { $(id).textContent = dark ? '☀' : '☾'; $(id).setAttribute('aria-label', dark ? 'ნათელი თემის ჩართვა' : 'მუქი თემის ჩართვა'); });
}
function toggleAccordion(header) {
    const content = header.nextElementSibling;
    const shouldOpen = !content.classList.contains('open');
    document.querySelectorAll('.accordion-header').forEach(item => {
        const open = item === header && shouldOpen;
        item.setAttribute('aria-expanded', String(open));
        item.nextElementSibling.classList.toggle('open', open);
        item.querySelector('.acc-icon').textContent = open ? '−' : '+';
    });
}

function openScholarshipModal(id) {
    const sch = SCHOLARSHIPS[id]; if (!sch) return;
    $('schModalTitle').textContent = sch.title; $('schModalTag').textContent = sch.country;
    $('schModalDesc').innerHTML = `<p class="scholarship-description">${escapeHTML(sch.desc)}</p><h3 class="coverage-heading">რას მოიცავს დაფინანსება</h3><ul class="coverage-list">${sch.coverage.map(item => `<li><span>✓</span>${escapeHTML(item)}</li>`).join('')}</ul><p class="scholarship-footnote">დაფინანსების მოცულობა და მოთხოვნები პროგრამის მიხედვით განსხვავდება. მიმდინარე ინფორმაცია გადაამოწმე ოფიციალურ ვებსაიტზე.</p>`;
    $('schModalLink').href = safeLink(sch.link) || '#'; openModal('scholarshipModal');
}
async function fetchAgencies() {
    try {
        const response = await api('/api/agencies'); agencies = await response.json();
        if (!Array.isArray(agencies)) throw new Error('Unexpected agencies response');
        $('agenciesGrid').innerHTML = agencies.length ? agencies.map((agency,i) => `<article class="agency-card"><div class="agency-card-top"><span class="agency-avatar">${escapeHTML(agency.name.split(' ').slice(0,2).map(word => word[0]).join(''))}</span><span class="mini-label">განათლების კონსულტაცია</span></div><h3>${escapeHTML(agency.name)}</h3><p>${escapeHTML(agency.desc)}</p><div class="agency-tags"><span class="tag tag-neutral">პროგრამის შერჩევა</span><span class="tag tag-neutral">აპლიკაცია</span></div><button class="btn-secondary" data-action="agency" data-index="${i}">ნახე პროფილი და კონტაქტი <span>↗</span></button></article>`).join('') : emptyState('კონსულტანტების სია მზადდება', 'მანამდე შეგიძლია უნივერსიტეტები და სტიპენდიები შეისწავლო.');
    } catch { $('agenciesGrid').innerHTML = emptyState('კონსულტანტების სია ვერ ჩაიტვირთა', 'შეამოწმე სერვერთან კავშირი და სცადე ხელახლა.', 'ხელახლა ცდა', 'retry-agencies'); }
}
function openAgency(index) {
    const agency = agencies[index]; if (!agency) return;
    $('agencyModalTitle').textContent = agency.name; $('agencyModalDescription').textContent = agency.desc;
    const old=$('agencyContactDetails');old?.remove();const details=document.createElement('div');details.id='agencyContactDetails';details.className='agency-contact-details';const website=safeLink(agency.website);
    details.innerHTML=`<p>კატალოგში ყოფნა პარტნიორობას ან გადამოწმებას არ ნიშნავს.</p><dl><dt>მომსახურების ენა და ფორმატი</dt><dd>${escapeHTML(agency.languages?.join(', ')||'დასაზუსტებელია')}</dd><dt>ფასი და პასუხის დრო</dt><dd>${escapeHTML(agency.pricingNote||'დასაზუსტებელია უშუალოდ კონსულტანტთან')}</dd></dl>${website?`<a class="btn-main" href="${escapeHTML(website)}" target="_blank" rel="noopener noreferrer">ოფიციალური ვებსაიტი ↗</a>`:'<p>ამ ჩანაწერის მოქმედი კონტაქტი ჯერ დადასტურებული არ არის. მანამდე შეგიძლია პროგრამები და მათი ოფიციალური წყაროები შეისწავლო.</p><button class="btn-secondary" data-discover-programs>პროგრამების ძიება</button>'}`;$('agencyModalDescription').after(details);openModal('agencyModal');
}

// Profile-based guidance: program matching, without invented admission probabilities.
function toggleCustomInput(selectId, customId) {
    const custom = $(customId); const show = $(selectId).value === 'other';
    custom.style.display = show ? 'block' : 'none'; custom.required = show; if (!show) custom.value = '';
}
function toggleCertVisibility() {
    const show = $('hasCertSelect').value === 'yes'; $('certNameWrapper').style.display = show ? 'block' : 'none'; $('certNameSelect').required = show;
    if (!show) { $('certScore').value = ''; $('certComponentScore').value = ''; $('certNameSelect').value = ''; $('certNameCustom').value = ''; $('certNameCustom').required = false; $('certNameCustom').style.display = 'none'; }
}
function finalValue(selectId, customId) { return $(selectId).value === 'other' ? $(customId).value.trim() : $(selectId).value; }
function resetAdvisor() { clearTimeout(advisorTimer); $('aiForm').style.display = 'block'; $('result-container').style.display = 'none'; $('result-container').innerHTML = ''; }
// One delegated handler also covers cards created after API responses.
document.addEventListener('click', event => {
    const target = event.target.closest('[data-action]'); if (!target) return;
    const action = target.dataset.action;
    if (action === 'favorite') { event.stopPropagation(); toggleFavorite(target.dataset.id); }
    if (action === 'university') openDynamicUniModal(target.dataset.id);
    if (action === 'retry-universities') fetchUniversities();
    if (action === 'retry-agencies') fetchAgencies();
    if (action === 'reset-filters') resetFilters();
    if (action === 'universities') navigateTo('page-universities');
    if (action === 'scholarships') navigateTo('page-scholarships');
    if (action === 'agency') openAgency(Number(target.dataset.index));
    if (action === 'page' && !target.disabled) { currentPage = Number(target.dataset.page); filterAndSortUnis(false); $('programSearch').scrollIntoView({behavior:'smooth',block:'start'}); }
    if (action === 'advisor-catalog') { closeAllModals(); setCatalogView('institutions'); navigateTo('page-universities'); }
    if (action === 'catalog-view') setCatalogView(target.dataset.catalogView);
    if (action === 'advisor-directory') openAdvisorDirectory();
    if (action === 'discuss-ai') ChatAdvisor.discussProfile();
});
document.addEventListener('change', event => { if (event.target.matches('[data-action="compare"]')) toggleCompare(event.target.dataset.id,event.target); });
document.addEventListener('keydown', event => {
    const overlay = [...document.querySelectorAll('.modal-overlay')].find(modal => modal.style.display === 'flex');
    if (event.key === 'Escape') { closeAllModals(); $('navLinks').classList.remove('open'); $('menuToggle').setAttribute('aria-expanded','false'); }
    if (event.target.matches('.program-cover') && ['Enter',' '].includes(event.key)) { event.preventDefault(); openDynamicUniModal(event.target.dataset.id); }
    if (event.key === 'Tab' && overlay) {
        const items = [...overlay.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === overlay.querySelector('[role="dialog"]'))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
});
document.querySelectorAll('.modal-overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) closeAllModals(); }));
$('ai-btn-nav').addEventListener('click',showAiModal); $('ai-btn-hero').addEventListener('click',showAiModal);
['themeToggle','themeToggleDash'].forEach(id => $(id).addEventListener('click',toggleTheme));
$('menuToggle').addEventListener('click', () => { const open = $('navLinks').classList.toggle('open'); $('menuToggle').setAttribute('aria-expanded',String(open)); });
$('loginForm').addEventListener('submit',event => submitAuth(event)); $('registerForm').addEventListener('submit',event => submitAuth(event,true));
$('profileForm').addEventListener('submit',saveProfile);
$('advisorProfileForm').addEventListener('submit',saveAdvisorAccount);
$('certNameSelect').addEventListener('change',syncCertificateBounds);
let searchTimer;
$('programSearch').addEventListener('input',() => { clearTimeout(searchTimer); searchTimer=setTimeout(()=>filterAndSortUnis(),120); });
$('heroSearch').addEventListener('submit', async event => { event.preventDefault();await fetchUniversities(); resetFilters(false); $('filterCountry').value=$('heroCountry').value; $('filterDegree').value=$('heroDegree').value; StudentDiscovery.refreshMulti('filterCountry');StudentDiscovery.refreshMulti('filterDegree');setCatalogView('programs'); navigateTo('page-universities');Experience.results(); });
document.querySelectorAll('.password-toggle').forEach(button => button.addEventListener('click',() => { const input = $(button.dataset.input); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; button.setAttribute('aria-label', show ? 'პაროლის დამალვა' : 'პაროლის ჩვენება'); button.setAttribute('aria-pressed',String(show));button.textContent=I18n.t(show?'დამალვა':'ჩვენება'); }));
document.querySelectorAll('.accordion-header').forEach((header,i) => {
    header.setAttribute('role','button'); header.tabIndex = 0; header.setAttribute('aria-expanded','false'); header.setAttribute('aria-controls',`faq-${i}`); header.nextElementSibling.id = `faq-${i}`; header.querySelector('.acc-icon').textContent = '+';
    header.addEventListener('keydown',event => { if (['Enter',' '].includes(event.key)) { event.preventDefault(); toggleAccordion(header); } });
});
document.querySelectorAll('.ai-input-group').forEach(group => { const select = group.querySelector('select,input'); const label = group.querySelector('label'); if (select?.id && label) label.htmlFor = select.id; });
window.addEventListener('popstate',() => navigateTo(`page-${location.hash.slice(1) || 'home'}`,false));
window.addEventListener('hashchange',() => navigateTo(`page-${location.hash.slice(1) || 'home'}`,false));

const savedTheme = readStored('globalEduTheme','light');
document.documentElement.dataset.theme = savedTheme === 'dark' ? 'dark' : 'light'; syncThemeButtons();
if (!DESIGN_PREVIEW) { try { localStorage.removeItem('globalEduToken'); localStorage.removeItem('globalEduUser'); } catch {} }
const catalogMobile=matchMedia('(max-width:760px)');
const syncCatalogDrawer=()=>{$('catalogFilterDrawer').open=!catalogMobile.matches;};
syncCatalogDrawer();catalogMobile.addEventListener('change',syncCatalogDrawer);
ContentUI.init(); BillingUI.init();
initAccountForms();
ChatAdvisor.init();Experience.init();LanguagePicker.init();StudyCalendar.init();AccountSecurity.init();CatalogUpdates.init();
if (DESIGN_PREVIEW) { $('previewBanner').hidden = false; document.body.classList.add('preview-mode'); }
restoreFavorites(); updateAccountUI(); renderFavorites();
navigateTo(`page-${location.hash.slice(1)||'home'}`,false);
bootstrapAccount();
