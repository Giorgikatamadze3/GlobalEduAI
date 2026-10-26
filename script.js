// ================= 1. ნავიგაცია & UI =================
const aiBtnNav = document.getElementById('ai-btn-nav');
const aiBtnHero = document.getElementById('ai-btn-hero');

function showAiModal(event) { if (event) event.preventDefault(); document.getElementById('aiModal').style.display = 'flex'; }
if (aiBtnNav) aiBtnNav.addEventListener('click', showAiModal);
if (aiBtnHero) aiBtnHero.addEventListener('click', showAiModal);

window.closeAllModals = function() { document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none'); };
window.closeAiModal = function() { document.getElementById('aiModal').style.display = 'none'; };
window.closeUniModal = function() { document.getElementById('uniModal').style.display = 'none'; };
window.onclick = function(event) { if (event.target.classList.contains('modal-overlay')) closeAllModals(); };
window.onkeydown = function(event) { if (event.key === "Escape") closeAllModals(); };

window.navigateTo = function(pageId) {
    document.querySelectorAll('.app-page').forEach(page => page.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    const mainNav = document.getElementById('main-nav');
    const mainFooter = document.getElementById('main-footer');
    if (pageId === 'page-register' || pageId === 'page-dashboard') {
        if(mainNav) mainNav.style.display = 'none'; if(mainFooter) mainFooter.style.display = 'none';
    } else {
        if(mainNav) mainNav.style.display = 'flex'; if(mainFooter) mainFooter.style.display = 'block';
    }
    if(pageId === 'page-universities') { filterAndSortUnis(); renderCompareBar(); } 
    else { const cBar = document.getElementById('compareBar'); if(cBar) cBar.style.display = 'none'; }
};

window.resetNavBtn = function() {
    const navBtn = document.getElementById('navRegBtn');
    if(navBtn) { navBtn.innerText = 'შესვლა'; navBtn.style.background = 'linear-gradient(135deg, var(--secondary) 0%, var(--secondary-hover) 100%)'; navBtn.setAttribute('onclick', "navigateTo('page-register')"); }
    localStorage.removeItem('globalEduToken'); localStorage.removeItem('globalEduUser');
};

function toggleTheme() {
    const htmlElement = document.documentElement; 
    const newTheme = htmlElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    htmlElement.setAttribute('data-theme', newTheme);
    const icon = newTheme === 'light' ? '🌙' : '☀️';
    if(document.getElementById('themeToggle')) document.getElementById('themeToggle').innerText = icon;
    if(document.getElementById('themeToggleDash')) document.getElementById('themeToggleDash').innerText = icon;
}
if(document.getElementById('themeToggle')) document.getElementById('themeToggle').addEventListener('click', toggleTheme);
if(document.getElementById('themeToggleDash')) document.getElementById('themeToggleDash').addEventListener('click', toggleTheme);

window.toggleAccordion = function(element) {
    const content = element.nextElementSibling;
    const icon = element.querySelector('.acc-icon');
    const isOpen = content.classList.contains('open');
    document.querySelectorAll('.accordion-content').forEach(c => { c.classList.remove('open'); c.previousElementSibling.querySelector('.acc-icon').style.transform = 'rotate(0deg)'; });
    if (!isOpen) { content.classList.add('open'); icon.style.transform = 'rotate(180deg)'; }
};

// ================= 2. ავტორიზაცია & კაბინეტი =================
window.switchAuthTab = function(tab) {
    document.querySelectorAll('.auth-tab-btn').forEach(btn => btn.classList.remove('active'));
    event.currentTarget.classList.add('active');
    if(tab === 'login') { document.getElementById('loginForm').style.display = 'block'; document.getElementById('registerForm').style.display = 'none'; } 
    else { document.getElementById('loginForm').style.display = 'none'; document.getElementById('registerForm').style.display = 'block'; }
};

function activateDashboard() {
    navigateTo('page-dashboard');
    const navBtn = document.getElementById('navRegBtn');
    if(navBtn) { navBtn.innerText = 'ჩემი პროფილი'; navBtn.style.background = 'linear-gradient(135deg, #10b981 0%, #059669 100%)'; navBtn.setAttribute('onclick', "navigateTo('page-dashboard')"); }
    const savedUser = JSON.parse(localStorage.getItem('globalEduUser'));
    if(savedUser) {
        const nameParts = savedUser.name.split(' ');
        document.getElementById('profileFirstName').value = nameParts[0] || '';
        document.getElementById('profileLastName').value = nameParts.slice(1).join(' ') || '';
        document.getElementById('profileEmail').value = savedUser.email;
        document.getElementById('profileTopName').innerText = savedUser.name;
        document.getElementById('sidebarName').innerText = savedUser.name;
        const initials = ((nameParts[0]||'')[0] + (nameParts[1]||'')[0] || 'ჩპ').toUpperCase();
        document.getElementById('mainAvatar').innerText = initials; document.getElementById('sidebarAvatar').innerText = initials;
        if(savedUser.favorites) favoritesList = savedUser.favorites;
    }
    renderFavorites(); 
}

const loginForm = document.getElementById('loginForm');
if(loginForm) {
    loginForm.addEventListener('submit', async function(event) {
        event.preventDefault(); 
        const email = loginForm.querySelector('input[type="email"]').value; const password = loginForm.querySelector('input[type="password"]').value;
        try {
            const response = await fetch('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
            const data = await response.json();
            if(response.ok) { localStorage.setItem('globalEduToken', data.token); localStorage.setItem('globalEduUser', JSON.stringify(data.user)); activateDashboard(); } else alert("❌ " + data.message);
        } catch (err) { alert("კავშირი სერვერთან ვერ მოხერხდა!"); }
    });
}

const registerForm = document.getElementById('registerForm');
if(registerForm) {
    registerForm.addEventListener('submit', async function(event) {
        event.preventDefault(); 
        const name = document.getElementById('regName').value; const email = document.getElementById('regEmail').value; const phone = document.getElementById('regPhone').value; const password = document.getElementById('regPassword').value;
        try {
            const response = await fetch('http://localhost:3000/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, phone, password }) });
            const data = await response.json();
            if(response.ok) { alert("🎉 " + data.message); switchAuthTab('login'); } else alert("❌ " + data.message);
        } catch (err) { alert("კავშირი სერვერთან ვერ მოხერხდა!"); }
    });
}

window.switchDashTab = function(tabName) {
    document.querySelectorAll('.dash-tab-content').forEach(tab => tab.style.display = 'none');
    document.querySelectorAll('.dash-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.getElementById('tab-' + tabName).style.display = 'block';
    if(event) event.currentTarget.classList.add('active');
    const titles = { 'profile': 'პირადი პროფილი', 'documents': 'დოკუმენტების ბაზა', 'application': 'განაცხადის გენერაცია', 'favorites': '⭐ ფავორიტები' };
    document.getElementById('dashboard-title').innerText = titles[tabName];
};

window.saveProfile = async function() {
    const btn = event.target; btn.innerText = "ინახება..."; btn.disabled = true;
    const name = document.getElementById('profileFirstName').value + " " + document.getElementById('profileLastName').value;
    const email = document.getElementById('profileEmail').value;
    const token = localStorage.getItem('globalEduToken');
    if(!token) { alert("ავტორიზაცია ვერ მოიძებნა!"); return; }
    try {
        const response = await fetch('http://localhost:3000/api/user/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name, email }) });
        const data = await response.json();
        if(response.ok) { localStorage.setItem('globalEduUser', JSON.stringify(data.user)); alert("✅ " + data.message); document.getElementById('profileTopName').innerText = data.user.name; } else alert("❌ " + data.message);
    } catch (err) { alert("კავშირი სერვერთან ვერ მოხერხდა."); } finally { btn.innerText = "შენახვა"; btn.disabled = false; }
};

let uploadedFiles = [];
const docInput = document.getElementById('docInput');
const dragDropZone = document.getElementById('dragDropZone');
if(dragDropZone && docInput) {
    dragDropZone.addEventListener('click', (e) => { if(e.target.tagName !== 'SELECT' && e.target.tagName !== 'OPTION') docInput.click(); });
    docInput.addEventListener('change', function() { if (this.files && this.files[0]) handleFileUpload(this.files[0]); });
}
window.handleFileUpload = function(file) {
    if(file.type !== "application/pdf") { alert("მხოლოდ PDF ფაილების ატვირთვაა შესაძლებელი."); return; }
    const docCategory = document.getElementById('docCategory');
    const cat = docCategory && docCategory.value !== "" ? docCategory.options[docCategory.selectedIndex].text : 'სხვა ფაილი';
    uploadedFiles.push(file);
    const row = document.createElement('tr');
    row.innerHTML = `<td><strong>${file.name}</strong></td><td>${cat}</td><td>${new Date().toLocaleDateString()}</td><td><span class="status-badge" style="background:#10b981;color:white;padding:5px 10px;border-radius:10px;">ატვირთულია</span></td>`;
    document.querySelector('#documentsTable tbody').appendChild(row); docInput.value = ""; 
};

window.generatePDF = async function() {
    if(uploadedFiles.length === 0) { alert("გთხოვთ, ჯერ ატვირთოთ დოკუმენტები (PDF)!"); return; }
    const btn = document.getElementById('generate-btn'); const loading = document.getElementById('pdf-loading'); const progress = document.getElementById('pdf-progress'); const preview = document.getElementById('pdf-preview');
    btn.disabled = true; loading.style.display = 'block'; preview.style.display = 'none'; progress.style.width = '60%';
    const formData = new FormData(); uploadedFiles.forEach(file => formData.append('documents', file));
    try {
        const response = await fetch('http://localhost:3000/api/generate-pdf', { method: 'POST', body: formData });
        if(response.ok) {
            const blob = await response.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.style.display = 'none'; a.href = url; a.download = 'GlobalEdu_Application.pdf'; document.body.appendChild(a); a.click(); window.URL.revokeObjectURL(url);
            progress.style.width = '100%'; setTimeout(() => { loading.style.display = 'none'; preview.style.display = 'block'; btn.disabled = false; btn.innerText = "🔄 თავიდან გენერირება"; }, 500);
        } else { alert("სერვერმა ფაილების გაერთიანება ვერ შეძლო."); loading.style.display = 'none'; btn.disabled = false; }
    } catch (error) { alert("სერვერთან დაკავშირება ვერ მოხერხდა."); loading.style.display = 'none'; btn.disabled = false; }
};

// ================= 3. AI მრჩეველი ლოგიკა =================
window.toggleCustomInput = function(selectId, customInputId) {
    const selectBox = document.getElementById(selectId); const customInput = document.getElementById(customInputId);
    if (!selectBox || !customInput) return;
    if (selectBox.value === 'other') { customInput.style.display = 'block'; customInput.setAttribute('required', 'true'); } 
    else { customInput.style.display = 'none'; customInput.removeAttribute('required'); customInput.value = ''; }
};

window.toggleCertVisibility = function() {
    const hasCert = document.getElementById('hasCertSelect').value; const certWrapper = document.getElementById('certNameWrapper'); const certSelect = document.getElementById('certNameSelect');
    toggleCustomInput('hasCertSelect', 'hasCertCustom');
    if (hasCert === 'yes') { certWrapper.style.display = 'block'; certSelect.setAttribute('required', 'true'); } 
    else { certWrapper.style.display = 'none'; certSelect.removeAttribute('required'); certSelect.value = ''; document.getElementById('certNameCustom').style.display = 'none'; }
};

function getFinalValue(selectId, customId) {
    let val = document.getElementById(selectId).value;
    if (val === 'other') val = document.getElementById(customId).value;
    return val;
}

window.analyzeProfile = function(event) {
    if(event) event.preventDefault(); 
    
    const gpa = parseInt(document.getElementById('gpa').value) || 0;
    const degree = getFinalValue('degreeSelect', 'degreeCustom');
    const major = getFinalValue('majorSelect', 'majorCustom');
    const region = getFinalValue('regionSelect', 'regionCustom');
    const studyLang = getFinalValue('studyLangSelect', 'studyLangCustom');
    const langLevel = getFinalValue('langLevelSelect', 'langLevelCustom');
    const hasCert = getFinalValue('hasCertSelect', 'hasCertCustom');
    const certName = getFinalValue('certNameSelect', 'certNameCustom');
    const experience = getFinalValue('expSelect', 'expCustom');
    const budget = getFinalValue('budgetSelect', 'budgetCustom');
    
    const resultDiv = document.getElementById('result-container');
    if(!resultDiv) return;
    
    document.getElementById('aiForm').style.display = 'none';
    resultDiv.style.display = 'block';
    
    resultDiv.innerHTML = `
        <div style="background: #0f172a; padding: 25px; border-radius: 16px; font-family: monospace; color: #10b981; margin-top: 20px;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 15px;">
                <div style="width: 12px; height: 12px; border-radius: 50%; background: #10b981; animation: pulse 1s infinite;"></div>
                <span style="font-size: 1.1rem; font-weight: bold; color: #fff;">GlobalEdu AI Core™ ამოქმედდა...</span>
            </div>
            <ul id="ai-logs" style="list-style: none; padding: 0; margin: 0; line-height: 2; opacity: 0.8; color: #10b981;">
                <li id="log-1" style="display:none;">> აკადემიური მონაცემების სკანირება (GPA: ${gpa})... [OK]</li>
                <li id="log-2" style="display:none;">> ენის კომპეტენციის ანალიზი (${studyLang}, სერტიფიკატი: ${hasCert === 'yes' ? certName : 'არ აქვს'})... [OK]</li>
                <li id="log-3" style="display:none;">> ლოკაციისა და ფინანსების თავსებადობის ძიება... [OK]</li>
                <li id="log-4" style="display:none;">> ალბათობის გამოთვლა და უნივერსიტეტების ფილტრაცია... [მიმდინარეობს]</li>
            </ul>
            <div class="progress-bar" style="margin-top: 20px; background: #334155;"><div class="progress-fill" id="ai-progress" style="background: #10b981; width: 0%;"></div></div>
        </div>
    `;

    setTimeout(() => { document.getElementById('log-1').style.display = 'block'; document.getElementById('ai-progress').style.width = '25%'; }, 800);
    setTimeout(() => { document.getElementById('log-2').style.display = 'block'; document.getElementById('ai-progress').style.width = '50%'; }, 1600);
    setTimeout(() => { document.getElementById('log-3').style.display = 'block'; document.getElementById('ai-progress').style.width = '75%'; }, 2400);
    setTimeout(() => { document.getElementById('log-4').style.display = 'block'; document.getElementById('ai-progress').style.width = '100%'; }, 3200);

    setTimeout(function() {
        let baseChance = 30;
        if(gpa >= 90) baseChance += 25; else if(gpa >= 80) baseChance += 15; else if (gpa >= 70) baseChance += 5;
        if (hasCert === 'yes') baseChance += 15; else if (hasCert === 'in_progress') baseChance += 5; else baseChance -= 10; 
        if (langLevel === 'C1' || langLevel === 'C2') baseChance += 10; else if (langLevel === 'B2') baseChance += 5;
        if (experience === '1-2' || experience === '3+') baseChance += 10;
        
        let matchScore = Math.min(Math.max(baseChance, 10), 98); 
        let scoreColor = matchScore >= 80 ? '#10b981' : (matchScore >= 60 ? '#f59e0b' : '#ef4444');
        
        let recommendations = "";
        if (matchScore >= 80) { recommendations = `<li><strong>სტიპენდიები:</strong> თქვენი GPA და სერტიფიკატი იძლევა სრული დაფინანსების შანსს.</li><li><strong>შემდეგი ნაბიჯი:</strong> დაიწყეთ სამოტივაციო წერილის მომზადება წამყვანი უნივერსიტეტებისთვის.</li>`; } 
        else if (matchScore >= 60) { recommendations = `<li><strong>გააუმჯობესეთ პროფაილი:</strong> ${hasCert !== 'yes' ? 'აუცილებლად დაგჭირდებათ ენის ოფიციალური სერტიფიკატი.' : 'სასურველია ენის დონის ამაღლება.'}</li><li><strong>სტრატეგია:</strong> ფოკუსირდით პროგრამებზე მოქნილი მიღების სტანდარტით.</li>`; } 
        else { recommendations = `<li><strong>სუსტი წერტილი:</strong> ${hasCert !== 'yes' ? 'სერტიფიკატის არქონა' : 'დაბალი GPA'} ამცირებს დაფინანსების შანსს.</li><li><strong>ალტერნატივა:</strong> განიხილეთ Foundation წელი.</li>`; }

        let recommendedUnis = allUniversities.filter(u => {
            let isMatch = true;
            if (degree && u.degree !== degree && degree.toLowerCase() !== 'ნებისმიერი') isMatch = false;
            if (major && major !== 'other' && !u.field.toLowerCase().includes(major.toLowerCase()) && !u.category.toLowerCase().includes(major.toLowerCase())) isMatch = false;
            const europe = ['გერმანია', 'იტალია', 'ესტონეთი', 'უნგრეთი', 'ბელგია', 'ნიდერლანდები', 'საფრანგეთი', 'ესპანეთი'];
            if (region === 'europe' && !europe.includes(u.country)) isMatch = false;
            if (region === 'usa' && u.country !== 'აშშ' && u.country !== 'კანადა') isMatch = false;
            if (region === 'uk' && u.country !== 'დიდი ბრიტანეთი') isMatch = false;
            if (studyLang && u.lang.toLowerCase() !== studyLang.toLowerCase()) isMatch = false;
            if (budget && !isNaN(parseInt(budget)) && u.price > parseInt(budget)) isMatch = false;
            return isMatch;
        });

        if (recommendedUnis.length === 0) recommendedUnis = allUniversities.slice(0, 3);
        else recommendedUnis = recommendedUnis.slice(0, 3);

        let uniCardsHTML = recommendedUnis.map(u => `
            <div style="background: var(--bg-page); border: 1px solid var(--border); padding: 15px; border-radius: 12px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: 0.3s;" onclick="openDynamicUniModal('${u.id}')">
                <div><h4 style="margin: 0 0 5px 0; color: var(--text-dark); font-size: 1rem;">${u.name}</h4><span style="font-size: 0.8rem; color: var(--text-muted);">${u.country} • ${u.field}</span></div>
                <div style="text-align: right;"><strong style="color: var(--primary); font-size: 0.9rem;">${u.price === 0 ? 'უფასო' : u.price + '$'}</strong><div style="font-size: 0.8rem; color: #10b981; font-weight: bold;">${u.matchScore}% Match</div></div>
            </div>
        `).join('');

        resultDiv.innerHTML = `
            <div style="background: var(--bg-light); border: 1px solid var(--border); border-radius: 24px; padding: 30px; box-shadow: var(--card-shadow); animation: fadePage 0.5s forwards;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed var(--border); padding-bottom: 20px; margin-bottom: 20px;">
                    <h3 style="margin: 0; color: var(--primary); font-size: 1.5rem;">🧠 AI ანალიზის შედეგი</h3>
                    <button class="btn-secondary" style="padding: 5px 15px; font-size: 0.9rem;" onclick="document.getElementById('result-container').style.display='none'; document.getElementById('aiForm').style.display='block';">თავიდან შევსება</button>
                </div>
                <div style="display: flex; gap: 30px; align-items: center; margin-bottom: 25px;">
                    <div style="width: 110px; height: 110px; border-radius: 50%; border: 8px solid ${scoreColor}; display: flex; justify-content: center; align-items: center; flex-direction: column; background: var(--bg-page); flex-shrink: 0;">
                        <span style="font-size: 2rem; font-weight: 800; color: ${scoreColor};">${matchScore}%</span>
                        <span style="font-size: 0.65rem; color: var(--text-muted); font-weight: bold; text-transform: uppercase;">თავსებადობა</span>
                    </div>
                    <div style="background: var(--bg-page); padding: 15px; border-radius: 12px; border-left: 4px solid ${scoreColor}; flex-grow: 1;">
                        <h4 style="margin: 0 0 10px 0; color: var(--text-dark);">AI-სტრატეგია და რჩევები:</h4>
                        <ul style="margin: 0; padding-left: 20px; color: var(--text-dark); font-size: 0.95rem; line-height: 1.6;">${recommendations}</ul>
                    </div>
                </div>
                <h4 style="color: var(--text-dark); margin-bottom: 15px; border-top: 1px dashed var(--border); padding-top: 20px;">🏛️ თქვენზე მორგებული პროგრამები:</h4>
                <div style="margin-bottom: 20px;">${uniCardsHTML}</div>
                <button class="btn-main full-width" onclick="navigateTo('page-universities'); closeAiModal();">ყველა პროგრამის ნახვა ➔</button>
            </div>`;
    }, 4500); 
};

// ================= 4. უნივერსიტეტების ბაზა (API) =================
let allUniversities = [];
let compareList = [];
let favoritesList = [];

async function fetchUniversities() {
    try {
        const response = await fetch('http://localhost:3000/api/universities');
        if (response.ok) { allUniversities = await response.json(); populateFilters(allUniversities); filterAndSortUnis(); }
    } catch (error) { console.error("ბაზის წაკითხვის შეცდომა", error); }
}

function populateFilters(data) {
    const fieldSelect = document.getElementById('filterField');
    if(!fieldSelect) return;
    const categorized = {};
    data.forEach(u => { if(!categorized[u.category]) categorized[u.category] = new Set(); categorized[u.category].add(u.field); });
    fieldSelect.innerHTML = '<option value="">ყველა მიმართულება</option>';
    Object.keys(categorized).sort().forEach(cat => {
        let optgroup = `<optgroup label="${cat}">`;
        [...categorized[cat]].sort().forEach(field => { optgroup += `<option value="${field}">${field}</option>`; });
        optgroup += `</optgroup>`; fieldSelect.innerHTML += optgroup;
    });
}

window.updatePriceLabel = function() { document.getElementById('priceVal').innerText = document.getElementById('filterPrice').value + " $"; };

window.filterAndSortUnis = function() {
    const country = document.getElementById('filterCountry').value; const degree = document.getElementById('filterDegree').value; const field = document.getElementById('filterField').value; const lang = document.getElementById('filterLang').value; const maxPrice = parseInt(document.getElementById('filterPrice').value); const sortOption = document.getElementById('sortOption').value;

    let filtered = allUniversities.filter(uni => {
        if (country && uni.country !== country) return false; if (degree && uni.degree !== degree) return false; if (field && uni.field !== field) return false; if (lang && uni.lang !== lang) return false; if (uni.price > maxPrice) return false; return true;
    });

    if (sortOption === 'priceAsc') filtered.sort((a, b) => a.price - b.price); else if (sortOption === 'priceDesc') filtered.sort((a, b) => b.price - a.price); else filtered.sort((a, b) => b.matchScore - a.matchScore);
    renderUniversities(filtered);
};

function renderUniversities(unis) {
    const grid = document.getElementById('uniResultsGrid');
    if(!grid) return;
    document.getElementById('resultsCount').innerText = unis.length; grid.innerHTML = '';
    if (unis.length === 0) { grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 60px;"><h3 style="color: var(--text-dark);">პროგრამა ვერ მოიძებნა</h3></div>`; return; }

    unis.forEach(uni => {
        const isFav = favoritesList.includes(uni.id); const isCompared = compareList.includes(uni.id);
        const schText = uni.scholarships.length > 0 ? `<span class="tag tag-blue">🎓 ${uni.scholarships[0]}</span>` : '';
        const priceText = uni.price === 0 ? '<span style="color:#10b981; font-weight:800;">უფასო</span>' : `${uni.price.toLocaleString()} $`;
        const matchColor = uni.matchScore >= 90 ? '#10b981' : (uni.matchScore >= 75 ? '#f59e0b' : '#ef4444');

        grid.innerHTML += `
            <div class="card" style="display:flex; flex-direction:column; justify-content:space-between; position:relative; padding-bottom: 60px;">
                <div class="uni-card-header"><span class="match-badge" style="background: ${matchColor};">${uni.matchScore}% Match</span><button class="fav-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${uni.id}', this)">${isFav ? '❤️' : '🤍'}</button></div>
                <div style="margin-top: 15px; cursor: pointer;" onclick="openDynamicUniModal('${uni.id}')">
                    <h3 style="color: var(--text-dark); font-size:1.2rem; margin-bottom:15px;">${uni.name}</h3>
                    <div style="margin-bottom:15px; display:flex; flex-wrap:wrap; gap:5px;"><span class="tag tag-yellow">${uni.country}</span><span class="tag tag-purple">${uni.lang}</span>${schText}</div>
                    <div class="uni-detail-item"><span>ხარისხი:</span> <strong>${uni.degree}</strong></div><div class="uni-detail-item"><span>მიმართულება:</span> <strong>${uni.field}</strong></div><div class="uni-detail-item" style="border:none;"><span>ფასი:</span> <strong>${priceText}</strong></div>
                </div>
                <label class="compare-checkbox"><input type="checkbox" onchange="toggleCompare('${uni.id}', this)" ${isCompared ? 'checked' : ''}> შედარება</label>
            </div>`;
    });
}

// შედარება, ფავორიტები, და მოდალები
window.toggleCompare = function(id, checkbox) { if(checkbox.checked) { if(compareList.length >= 3) { alert("მაქსიმუმ 3 პროგრამა."); checkbox.checked = false; return; } compareList.push(id); } else compareList = compareList.filter(item => item !== id); renderCompareBar(); };
window.clearCompare = function() { compareList = []; document.querySelectorAll('.compare-checkbox input').forEach(cb => cb.checked = false); renderCompareBar(); };
function renderCompareBar() { const bar = document.getElementById('compareBar'); if(!bar) return; document.getElementById('compareCount').innerText = compareList.length; if(compareList.length > 0) bar.style.display = 'flex'; else bar.style.display = 'none'; }
window.openCompareModal = function() {
    if(compareList.length === 0) return; const thead = document.getElementById('compareTableHead'); const tbody = document.getElementById('compareTableBody');
    thead.innerHTML = '<th style="text-align: left;">მახასიათებელი</th>';
    compareList.forEach(id => { const uni = allUniversities.find(u => u.id === id); thead.innerHTML += `<th><strong style="color:var(--primary); font-size:1.1rem;">${uni.name}</strong><br><span style="font-size:0.8rem;">${uni.country}</span></th>`; });
    const features = [ { label: "ხარისხი", key: "degree" }, { label: "მიმართულება", key: "field" }, { label: "ენა", key: "lang" }, { label: "ფასი", key: "price", format: val => val === 0 ? "უფასო" : val + " $" }, { label: "ბოლო ვადა", key: "deadline" } ];
    tbody.innerHTML = '';
    features.forEach(f => { let row = `<tr><td style="text-align:left; font-weight:600; color:var(--text-muted);">${f.label}</td>`; compareList.forEach(id => { const uni = allUniversities.find(u => u.id === id); let val = uni[f.key]; if(f.format) val = f.format(val); row += `<td><strong>${val}</strong></td>`; }); row += `</tr>`; tbody.innerHTML += row; });
    document.getElementById('compareModal').style.display = 'flex';
};

window.toggleFavorite = function(id, btn) { if(event) event.stopPropagation(); if(favoritesList.includes(id)) { favoritesList = favoritesList.filter(item => item !== id); if(btn) { btn.classList.remove('active'); btn.innerText = '🤍'; } } else { favoritesList.push(id); if(btn) { btn.classList.add('active'); btn.innerText = '❤️'; } } renderFavorites(); };
window.renderFavorites = function() {
    const list = document.getElementById('favoritesList'); if(!list) return; list.innerHTML = '';
    if(favoritesList.length === 0) { list.innerHTML = `<p style="color:var(--text-muted); padding:20px; grid-column: span 2;">არცერთი პროგრამა არაა დამატებული.</p>`; return; }
    const favUnis = favoritesList.map(id => allUniversities.find(u => u.id === id)).sort((a,b) => new Date(a.deadline) - new Date(b.deadline));
    favUnis.forEach(uni => { list.innerHTML += `<div class="card" style="border: 1px solid var(--border);"><div style="display:flex; justify-content:space-between;"><h3 style="margin-top:0; color:var(--primary); font-size:1.1rem;">${uni.name}</h3><button class="btn-action" style="color:#ef4444;" onclick="toggleFavorite('${uni.id}')">❌</button></div><p style="margin: 5px 0 15px 0; color: var(--text-muted); font-size: 0.9rem;">${uni.degree} • ${uni.field}</p><div style="display:flex; gap:10px;"><button class="btn-secondary" style="padding: 5px 10px; font-size: 0.85rem;" onclick="openDynamicUniModal('${uni.id}')">დეტალები</button></div></div>`; });
};

window.openDynamicUniModal = function(id) {
    const uni = allUniversities.find(u => u.id === id); if(!uni) return;
    document.getElementById('uniModalTitle').innerText = uni.name; document.getElementById('uniModalTag').innerText = '📍 ' + uni.country; 
    const isFav = favoritesList.includes(uni.id); const favBtn = document.getElementById('modalFavBtn');
    if(favBtn) { favBtn.innerText = isFav ? '❤️' : '🤍'; favBtn.className = isFav ? 'fav-btn-large active' : 'fav-btn-large'; favBtn.onclick = function() { toggleFavorite(uni.id); openDynamicUniModal(uni.id); }; }
    
    const schInfo = uni.scholarships.length > 0 ? `<div style="padding: 15px; background: #eff6ff; border-radius: 12px; border-left: 4px solid var(--primary); margin-top: 20px;"><p style="margin: 0; color: var(--primary-dark);"><strong>💡 დაფინანსება:</strong> ჩართულია <strong>${uni.scholarships.join(', ')}</strong> პროგრამაში.</p></div>` : '';
    const descHTML = `<p style="font-size: 1.1rem; line-height: 1.8; color: var(--text-dark);">${uni.desc}</p><h4 style="color: var(--text-dark); margin-top: 25px; margin-bottom: 15px;">🎓 პროგრამის დეტალები:</h4><div style="background: var(--bg-page); padding: 20px; border-radius: 16px; border: 1px solid var(--border);"><ul style="padding-left:0; list-style: none; margin:0; line-height:2.2; font-size: 1.05rem; color: var(--text-dark);"><li style="border-bottom: 1px dashed var(--border); padding-bottom: 5px;"><strong>მიმართულება:</strong> ${uni.field}</li><li style="border-bottom: 1px dashed var(--border); padding-bottom: 5px; margin-top: 5px;"><strong>სწავლების ენა:</strong> ${uni.lang}</li><li style="margin-top: 5px;"><strong>სავარაუდო ფასი:</strong> ${uni.price === 0 ? '<span style="color:#10b981; font-weight:800;">უფასო</span>' : '<span style="color:var(--text-dark); font-weight:800;">' + uni.price.toLocaleString() + ' $</span>'}</li></ul></div>${schInfo}`;
    document.getElementById('uniModalDesc').innerHTML = descHTML;
    
    const linkEl = document.getElementById('uniModalLink');
    if(linkEl) { linkEl.href = uni.link; linkEl.target = "_blank"; linkEl.innerHTML = '🌐 ოფიციალურ ვებსაიტზე გადასვლა'; linkEl.style.display = 'block'; linkEl.style.textAlign = 'center'; linkEl.style.marginTop = '25px'; linkEl.style.padding = '15px'; linkEl.style.background = 'linear-gradient(135deg, var(--primary), var(--primary-dark))'; linkEl.style.color = 'white'; linkEl.style.borderRadius = '12px'; linkEl.style.fontWeight = 'bold'; linkEl.style.textDecoration = 'none'; }
    document.getElementById('uniModal').style.display = 'flex';
};

// სტატიკური მოდალები 
window.openInfoModal = function(id) { const data = { gpa: { title: "GPA მოთხოვნები", description: "მინიმუმ 75-80% ევროპის უნივერსიტეტებისთვის." } }; document.getElementById('infoModalTitle').innerHTML = data[id] ? data[id].title : 'ინფორმაცია'; document.getElementById('infoModalDesc').innerHTML = data[id] ? data[id].description : ''; document.getElementById('infoModal').style.display = 'flex'; };

window.openScholarshipModal = function(id) { 
    const data = { daad: { title: "DAAD სტიპენდია", country: "გერმანია", tagClass: "tag-yellow", desc: "გერმანიის აკადემიური გაცვლის სამსახური გთავაზობთ...", coverage: ["ყოველთვიური სტიპენდია", "ჯანმრთელობის დაზღვევა"], link: "https://www.daad.de/en/" }, chevening: { title: "Chevening Scholarship", country: "დიდი ბრიტანეთი", tagClass: "tag-blue", desc: "ბრიტანეთის მთავრობის პროგრამა 1-წლიანი სამაგისტრო პროგრამებისთვის.", coverage: ["სწავლის სრული გადასახადი", "ორმხრივი ავიაბილეთი"], link: "https://www.chevening.org/" }, dsu: { title: "DSU (Need-Based)", country: "იტალია", tagClass: "tag-green", desc: "რეგიონალური სოციალური სტიპენდია იტალიაში (ISEE-ს საფუძველზე).", coverage: ["სწავლის სრული გადასახადი", "უფასო კვება", "უფასო საცხოვრებელი"], link: "https://www.dsu.toscana.it/" }, fulbright: { title: "Fulbright Program", country: "აშშ (USA)", tagClass: "tag-red", desc: "აშშ-ის მთავრობის სრულად დაფინანსებული გაცვლითი პროგრამა.", coverage: ["სწავლის გადასახადი", "სტიპენდია", "J-1 ვიზა"], link: "https://foreign.fulbrightonline.org/" }, erasmus: { title: "Erasmus Mundus", country: "ევროკავშირი", tagClass: "tag-purple", desc: "ერთობლივი სამაგისტრო პროგრამები, მინიმუმ 2 სხვადასხვა ევროპულ ქვეყანაში.", coverage: ["სწავლის სრული გადასახადი", "ყოველთვიური სტიპენდია"], link: "https://erasmus-plus.ec.europa.eu/" }, stipendium: { title: "Stipendium Hungaricum", country: "უნგრეთი", tagClass: "tag-teal", desc: "უნგრეთის მთავრობის სასტიპენდიო პროგრამა ქართველი სტუდენტებისთვისაც.", coverage: ["უფასო სწავლა", "საცხოვრებელი", "სტიპენდია"], link: "https://stipendiumhungaricum.hu/" } }; 
    const sch = data[id]; document.getElementById('schModalTitle').innerText = sch.title; const tagEl = document.getElementById('schModalTag'); tagEl.innerText = sch.country; tagEl.className = 'tag ' + sch.tagClass;
    const covHTML = sch.coverage.map(c => `<li style="border-bottom: 1px dashed var(--border); padding-bottom: 5px; margin-top: 5px;">✅ ${c}</li>`).join('');
    const descHTML = `<p style="font-size: 1.1rem; line-height: 1.8; color: var(--text-dark);">${sch.desc}</p><h4 style="color: var(--text-dark); margin-top: 25px; margin-bottom: 15px;">💰 რას ფარავს სტიპენდია:</h4><div style="background: var(--bg-page); padding: 20px; border-radius: 16px; border: 1px solid var(--border);"><ul style="padding-left:0; list-style: none; margin:0; line-height:2.2; font-size: 1.05rem; color: var(--text-dark);">${covHTML}</ul></div>`;
    document.getElementById('schModalDesc').innerHTML = descHTML; 
    const linkEl = document.getElementById('schModalLink'); if(linkEl) { linkEl.href = sch.link; linkEl.target = "_blank"; linkEl.innerHTML = '🌐 ოფიციალურ საიტზე გადასვლა'; linkEl.style.display = 'block'; linkEl.style.textAlign = 'center'; linkEl.style.marginTop = '25px'; linkEl.style.padding = '15px'; linkEl.style.background = 'linear-gradient(135deg, var(--primary), var(--primary-dark))'; linkEl.style.color = 'white'; linkEl.style.borderRadius = '12px'; linkEl.style.fontWeight = 'bold'; linkEl.style.textDecoration = 'none'; }
    document.getElementById('scholarshipModal').style.display = 'flex'; 
};

// ================= სააგენტოების API (ახალი) =================
async function fetchAgencies() {
    const container = document.getElementById('agenciesGrid');
    if (!container) return;
    try {
        const response = await fetch('http://localhost:3000/api/agencies');
        const agencies = await response.json();
        container.innerHTML = '';
        agencies.forEach(ag => {
            container.innerHTML += `
                <div class="card" style="text-align:center; padding: 40px 30px;">
                    <div style="width:80px; height:80px; background:linear-gradient(135deg, var(--primary-light), #eff6ff); border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:2.5rem; margin:0 auto 20px auto; box-shadow:0 10px 20px rgba(37,99,235,0.1);">
                        ${ag.icon}
                    </div>
                    <h3 style="margin-bottom:15px; font-size: 1.3rem; color: var(--text-dark);">${ag.name}</h3>
                    <p style="color:var(--text-muted); font-size:0.95rem; margin-bottom:25px; line-height: 1.6;">${ag.desc}</p>
                    <button class="btn-main full-width" onclick="alert('✅ მოთხოვნა გაგზავნილია სააგენტოში: ${ag.name}\\nკონსულტანტი მალე დაგიკავშირდებათ!')">📅 ვიზიტის დაჯავშნა</button>
                </div>
            `;
        });
    } catch (e) {
        container.innerHTML = '<p style="text-align:center; grid-column:span 3; color:#ef4444;">კომპანიების ბაზასთან დაკავშირება ვერ მოხერხდა.</p>';
    }
}

document.addEventListener("DOMContentLoaded", () => { fetchUniversities(); fetchAgencies(); });