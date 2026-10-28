'use strict';

const $ = id => document.getElementById(id);
const API_BASE = location.protocol === 'file:' || ['5500','5501','5173','4173'].includes(location.port)
    ? 'http://localhost:3000' : '';
const PAGE_SIZE = 12;
let allUniversities = [];
let agencies = [];
let compareList = [];
let favoritesList = [];
let uploadedFiles = [];
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
function formatPrice(value) { return value == null ? 'დასაზუსტებელია' : `${Number(value).toLocaleString('en-US')}`; }
function formatDate(value) {
    if (!value) return 'დასაზუსტებელია';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'დასაზუსტებელია' : date.toLocaleDateString('ka-GE',/^\d{4}-\d{2}-\d{2}$/.test(value)?{timeZone:'UTC'}:{});
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
        error.status = response.status; error.fields = body.fields || {};
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
    if (!$(pageId)?.classList.contains('app-page')) return;
    if (pageId === 'page-dashboard' && !currentUser) { pendingAuthPage = authReady ? null : 'page-dashboard'; pageId = 'page-register'; }
    document.querySelectorAll('.app-page').forEach(page => page.classList.toggle('active', page.id === pageId));
    const privatePage = ['page-register', 'page-dashboard'].includes(pageId);
    $('main-nav').style.display = privatePage ? 'none' : 'flex';
    $('main-footer').style.display = privatePage ? 'none' : 'block';
    document.querySelectorAll('.nav-links [data-page]').forEach(link => {
        const active = link.dataset.page === pageId;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    $('navLinks').classList.remove('open'); $('menuToggle').setAttribute('aria-expanded', 'false');
    if (pageId === 'page-universities') filterAndSortUnis(false);
    if (pageId === 'page-dashboard') renderFavorites();
    renderCompareBar();
    if (updateHash && location.hash !== `#${pageId.replace('page-', '')}`) history.pushState(null, '', `#${pageId.replace('page-', '')}`);
    window.scrollTo({ top:0, behavior:'instant' });
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
        $('agenciesGrid').innerHTML = agencies.length ? agencies.map((agency,i) => `<article class="agency-card"><div class="agency-card-top"><span class="agency-avatar">${escapeHTML(agency.name.split(' ').slice(0,2).map(word => word[0]).join(''))}</span><span class="mini-label">განათლების კონსულტაცია</span></div><h3>${escapeHTML(agency.name)}</h3><p>${escapeHTML(agency.desc)}</p><div class="agency-tags"><span class="tag tag-neutral">პროგრამის შერჩევა</span><span class="tag tag-neutral">აპლიკაცია</span></div><button class="btn-secondary" data-action="agency" data-index="${i}">გაიცანი კონსულტანტი <span>↗</span></button></article>`).join('') : emptyState('კონსულტანტების სია მზადდება', 'მანამდე შეგიძლია უნივერსიტეტები და სტიპენდიები შეისწავლო.');
    } catch { $('agenciesGrid').innerHTML = emptyState('კონსულტანტების სია ვერ ჩაიტვირთა', 'შეამოწმე სერვერთან კავშირი და სცადე ხელახლა.', 'ხელახლა ცდა', 'retry-agencies'); }
}
function openAgency(index) {
    const agency = agencies[index]; if (!agency) return;
    $('agencyModalTitle').textContent = agency.name; $('agencyModalDescription').textContent = agency.desc; openModal('agencyModal');
}

// Documents and PDF packet
function handleFiles(files) {
    let added = 0;
    for (const file of files) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { notify(`${file.name}: აირჩიე PDF ფორმატის ფაილი.`, true); continue; }
        if (file.size > 20 * 1024 * 1024) { notify(`${file.name}: ფაილის ზომა აღემატება 20 MB-ს.`, true); continue; }
        if (uploadedFiles.length >= 20) { notify('ერთ პაკეტში შეგიძლია დაამატო მაქსიმუმ 20 დოკუმენტი.', true); break; }
        if (uploadedFiles.some(item => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
        uploadedFiles.push({file,category:$('docCategory').selectedOptions[0].textContent}); added++;
    }
    renderDocuments(); if (added) { $('pdf-preview').style.display = 'none'; notify(`დაემატა ${added} დოკუმენტი.`); }
}
function renderDocuments() {
    $('documentsTable').querySelector('tbody').innerHTML = uploadedFiles.map(({file,category},i) => `<tr><td><div class="file-name"><span class="file-icon">PDF</span><strong>${escapeHTML(file.name)}</strong></div></td><td>${escapeHTML(category)}</td><td>${file.size < 1024*1024 ? `${Math.ceil(file.size/1024)} KB` : `${(file.size/(1024*1024)).toFixed(1)} MB`}</td><td><button class="file-remove" data-action="remove-file" data-index="${i}" aria-label="${escapeHTML(file.name)} — წაშლა">×</button></td></tr>`).join('');
    $('documentsEmpty').style.display = uploadedFiles.length ? 'none' : 'block';
    $('statDocuments').textContent = uploadedFiles.length; $('pdfFileCount').textContent = `${uploadedFiles.length} დოკუმენტი არჩეულია`;
}
let pdfLibraryRequest;
function loadPdfLibrary() {
    if(window.PDFLib)return Promise.resolve(window.PDFLib);
    if(!pdfLibraryRequest)pdfLibraryRequest=new Promise((resolve,reject)=>{
        const script=document.createElement('script');script.src='assets/vendor/pdf-lib.min.js';
        script.onload=()=>window.PDFLib?resolve(window.PDFLib):reject(new Error('PDF მოდული ვერ ჩაიტვირთა.'));
        script.onerror=()=>{script.remove();pdfLibraryRequest=null;reject(new Error('PDF მოდულის ჩატვირთვა ვერ მოხერხდა. სცადე ხელახლა.'));};
        document.head.append(script);
    });
    return pdfLibraryRequest;
}
async function generatePDF() {
    if (!uploadedFiles.length) { notify('ჯერ შეარჩიე PDF დოკუმენტები.'); switchDashTab('documents'); return; }
    const button = $('generate-btn'); button.disabled = true; $('pdf-loading').style.display = 'block'; $('pdf-preview').style.display = 'none'; $('pdf-progress').style.width = '45%';
    const selectedFiles=[...uploadedFiles];
    try {
        const {PDFDocument}=await loadPdfLibrary();const merged=await PDFDocument.create();
        for(const [index,{file}]of selectedFiles.entries()){
            const source=await PDFDocument.load(await file.arrayBuffer());
            const pages=await merged.copyPages(source,source.getPageIndices());pages.forEach(page=>merged.addPage(page));
            $('pdf-progress').style.width=`${Math.round(10+80*(index+1)/selectedFiles.length)}%`;
        }
        const blob=new Blob([await merged.save()],{type:'application/pdf'});const url = URL.createObjectURL(blob);
        const link = document.createElement('a'); link.href = url; link.download = 'GlobalEdu_Application.pdf'; document.body.append(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        $('pdf-progress').style.width = '100%'; $('pdf-preview').style.display = 'block'; notify('შენი PDF პაკეტი მზადაა.');
    } catch (error) { notify(error.message || 'ფაილების გაერთიანება ვერ მოხერხდა.', true); }
    finally { $('pdf-loading').style.display = 'none'; button.disabled = false; }
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
    if (action === 'remove-file') { uploadedFiles.splice(Number(target.dataset.index),1); renderDocuments(); $('pdf-preview').style.display = 'none'; }
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
$('heroSearch').addEventListener('submit', event => { event.preventDefault(); resetFilters(false); $('filterCountry').value=$('heroCountry').value; $('filterDegree').value=$('heroDegree').value; StudentDiscovery.refreshMulti('filterCountry');StudentDiscovery.refreshMulti('filterDegree');setCatalogView($('heroDegree').value?'programs':'institutions'); navigateTo('page-universities'); });
document.querySelectorAll('.password-toggle').forEach(button => button.addEventListener('click',() => { const input = $(button.dataset.input); const show = input.type === 'password'; input.type = show ? 'text' : 'password'; button.setAttribute('aria-label', show ? 'პაროლის დამალვა' : 'პაროლის ჩვენება'); button.setAttribute('aria-pressed',String(show)); }));
$('dragDropZone').addEventListener('click',() => $('docInput').click());
$('docInput').addEventListener('change',event => { handleFiles(event.target.files); event.target.value = ''; });
['dragenter','dragover'].forEach(type => $('dragDropZone').addEventListener(type,event => { event.preventDefault(); $('dragDropZone').classList.add('dragover'); }));
['dragleave','drop'].forEach(type => $('dragDropZone').addEventListener(type,event => { event.preventDefault(); $('dragDropZone').classList.remove('dragover'); if (type === 'drop') handleFiles(event.dataTransfer.files); }));
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
initAccountForms();
ChatAdvisor.init();
if (DESIGN_PREVIEW) { $('previewBanner').hidden = false; document.body.classList.add('preview-mode'); }
restoreFavorites(); updateAccountUI(); renderDocuments(); renderFavorites();
navigateTo($( `page-${location.hash.slice(1)}` ) ? `page-${location.hash.slice(1)}` : 'page-home',false);
fetchUniversities(); fetchAgencies();
bootstrapAccount();
