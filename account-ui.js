'use strict';

let authReady = DESIGN_PREVIEW;
let pendingAuthPage = null;
let registrationRole = 'student';
let previewAccount = DESIGN_PREVIEW ? structuredClone(PREVIEW_USER) : null;
let sessionCheck = null;

function authHeaders() { return {'Content-Type':'application/json'}; }
function accountErrorMessage(error) {
    return ['TypeError','TimeoutError','AbortError'].includes(error.name)
        ? 'სერვერთან კავშირი ვერ დამყარდა. შეამოწმე, რომ npm start გაშვებულია და საიტი Localhost-ზეა გახსნილი.' : error.message;
}
function clearAccountErrors(form, errorId) {
    const box = $(errorId); box.hidden = true; box.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach(input => { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-errormessage'); });
}
function showAccountError(form, errorId, error) {
    const box = $(errorId); box.textContent = accountErrorMessage(error); box.hidden = false;
    const mappings = {
        registerForm:{name:'regName',email:'regEmail',phone:'regPhone',password:'regPassword',passwordConfirm:'regPasswordConfirm',termsAccepted:'regTerms',educationLevel:'regEducationLevel',citizenshipCode:'regCitizenship',graduationYear:'regGraduationYear',organizationName:'regOrganization',position:'regPosition',website:'regWebsite',bio:'regBio'},
        loginForm:{email:'loginEmail',password:'loginPassword'},
        profileForm:{name:'profileFirstName',phone:'profilePhone',educationLevel:'profileEducationLevel',citizenshipCode:'profileCitizenship',graduationYear:'profileGraduationYear'},
        advisorProfileForm:{organizationName:'advisorOrganization',position:'advisorPosition',website:'advisorWebsite',bio:'advisorBio'}
    };
    let first;
    for (const field of Object.keys(error.fields || {})) {
        const input = $(mappings[form.id]?.[field]||AcademicProfileUI.errorFields(form.id==='registerForm'?'reg':'profile')[field]);
        if (input) { input.setAttribute('aria-invalid','true'); input.setAttribute('aria-errormessage',errorId); first ||= input; }
    }
    if (first) first.focus(); else { box.tabIndex = -1; box.focus(); }
}
function switchAuthTab(tab) {
    const login = tab === 'login';
    $('loginForm').style.display = login ? 'block' : 'none'; $('registerForm').style.display = login ? 'none' : 'block';
    document.querySelectorAll('.auth-tab-btn').forEach((button,i) => { const active = i === (login ? 0 : 1); button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
}
function setRegistrationRole(role) {
    registrationRole = role === 'advisor' ? 'advisor' : 'student';
    document.querySelectorAll('input[name="accountRole"]').forEach(input => { input.checked = input.value === registrationRole; });
    for (const [id,value] of [['regStudentFields','student'],['regAdvisorFields','advisor']]) {
        const group = $(id); const active = registrationRole === value; group.hidden = !active;
        group.querySelectorAll('input,select,textarea').forEach(input => { input.disabled = !active; });
    }
    $('regOrganization').required = registrationRole === 'advisor'; $('regPosition').required = registrationRole === 'advisor';
    if(typeof AcademicProfileUI!=='undefined')AcademicProfileUI.syncCertificate('reg');
    clearAccountErrors($('registerForm'),'registerError');
}
function initAccountForms() {
    AcademicProfileUI.init();
    const options = Object.values(CatalogCore.COUNTRIES).sort((a,b) => a.name.localeCompare(b.name,'ka'))
        .map(country => `<option value="${country.code}">${escapeHTML(country.name)}</option>`).join('');
    for (const id of ['regCitizenship','profileCitizenship']) $(id).innerHTML = '<option value="">არ ვუთითებ</option>' + options;
    for (const id of ['regGraduationYear','profileGraduationYear']) $(id).max = new Date().getUTCFullYear()+20;
    for (const id of ['regSpecialties','advisorSpecialties']) $(id).innerHTML = CatalogCore.FIELDS.map(field => `<label class="specialty-choice"><input type="checkbox" value="${escapeHTML(field.value)}"><span>${escapeHTML(field.label)}</span></label>`).join('');
    $('registerForm').addEventListener('reset',() => queueMicrotask(() => setRegistrationRole('student')));
    $('regPasswordConfirm').addEventListener('input',() => $('regPasswordConfirm').setCustomValidity(''));
    $('regPassword').addEventListener('input',() => $('regPasswordConfirm').setCustomValidity(''));
    setRegistrationRole('student');
    window.addEventListener('focus',() => { if (authReady && currentUser && !DESIGN_PREVIEW) refreshAccountSession(); });
}
function readStudentFields(prefix) {
    const id = prefix === 'reg' ? {education:'regEducationLevel',citizenship:'regCitizenship',year:'regGraduationYear'} : {education:'profileEducationLevel',citizenship:'profileCitizenship',year:'profileGraduationYear'};
    return {educationLevel:$(id.education).value,citizenshipCode:$(id.citizenship).value,graduationYear:$(id.year).value === '' ? null : Number($(id.year).value),...AcademicProfileUI.read(prefix)};
}
function readAdvisorFields(prefix) {
    const register = prefix === 'reg';
    return {organizationName:$(register?'regOrganization':'advisorOrganization').value.trim(),position:$(register?'regPosition':'advisorPosition').value.trim(),website:$(register?'regWebsite':'advisorWebsite').value.trim(),bio:$(register?'regBio':'advisorBio').value.trim(),specialties:[...$(register?'regSpecialties':'advisorSpecialties').querySelectorAll('input:checked')].map(input => input.value)};
}
function updateAccountUI() {
    if (typeof StudentWorkspace !== 'undefined') StudentWorkspace.render();
    if (typeof ChatAdvisor !== 'undefined') ChatAdvisor.accountChanged();
    if (typeof StudentDiscovery !== 'undefined') StudentDiscovery.restoreProfile();
    $('navRegBtn').innerHTML = `${currentUser ? 'კაბინეტი' : 'შესვლა'} <span>↗</span>`;
    $('navRegBtn').onclick = () => navigateTo(currentUser ? 'page-dashboard' : 'page-register');
    const advisor = currentUser?.role === 'advisor';
    document.querySelectorAll('[data-account-role]').forEach(element => { element.hidden = element.dataset.accountRole !== currentUser?.role; });
    $('studentProfileFields').hidden = !currentUser || advisor;
    if (!currentUser) return;
    const parts = String(currentUser.name || '').trim().split(/\s+/);
    $('profileFirstName').value = parts[0] || ''; $('profileLastName').value = parts.slice(1).join(' ');
    $('profileEmail').value = currentUser.email || ''; $('profilePhone').value = currentUser.phone || '';
    $('profileTopName').textContent = parts[0] || 'მეგობარო'; $('sidebarName').textContent = currentUser.name || '';
    $('sidebarRole').textContent = advisor ? 'განათლების მრჩეველი' : 'სტუდენტის ანგარიში';
    $('accountRoleBadge').textContent = advisor ? 'მრჩეველი · შემოწმების მოლოდინში' : 'სტუდენტის პირადი სივრცე';
    $('profileWelcomeCopy').textContent = advisor ? 'შეავსე შენი პროფესიული პროფილი და ორგანიზაციის ინფორმაცია.' : 'შენი დიდი გეგმები იწყება აქ. მოაწესრიგე პროფილი და შეინახე სასურველი უნივერსიტეტები.';
    const initials = parts.slice(0,2).map(word => word[0] || '').join('').toUpperCase();
    $('mainAvatar').textContent = initials; $('sidebarAvatar').textContent = initials;
    const student = currentUser.studentProfile || {};
    AcademicProfileUI.populate(student);
    $('profileEducationLevel').value = student.educationLevel || ''; $('profileCitizenship').value = student.citizenshipCode || ''; $('profileGraduationYear').value = student.graduationYear ?? '';
    const profile = currentUser.advisorProfile || {};
    for (const [id,key] of [['advisorOrganization','organizationName'],['advisorPosition','position'],['advisorWebsite','website'],['advisorBio','bio']]) $(id).value = profile[key] || '';
    $('advisorSpecialties').querySelectorAll('input').forEach(input => input.checked = (profile.specialties || []).includes(input.value));
}
function switchDashTab(tab) {
    const titles = {profile:'ჩემი პროფილი',planner:'ჩემი გეგმა',documents:'დოკუმენტები',application:'PDF გენერაცია',favorites:'ჩემი ფავორიტები',organization:'პროფესიული პროფილი'};
    if (!currentUser || !titles[tab]) return;
    if ((tab === 'organization' && currentUser.role !== 'advisor') || (['documents','application','planner'].includes(tab) && currentUser.role !== 'student')) tab = 'profile';
    document.querySelectorAll('.dash-tab-content').forEach(panel => panel.style.display = panel.id === `tab-${tab}` ? 'block' : 'none');
    document.querySelectorAll('.dash-tab-btn').forEach(button => { const active = button.dataset.tab === tab; button.classList.toggle('active',active); button.setAttribute('aria-pressed',String(active)); });
    $('dashboard-title').textContent = titles[tab];
    if (tab === 'favorites') renderFavorites();
    if (typeof StudentWorkspace !== 'undefined') StudentWorkspace.render();
}
function applyAccount(user) {
    if (!user || !['student','advisor'].includes(user.role) || !user.id && !user._id) throw new Error('სერვერმა ანგარიშის არასწორი მონაცემები დააბრუნა.');
    const changed = currentUser?._id !== user._id;
    currentUser = user;
    if (changed) { uploadedFiles = []; renderDocuments(); $('pdf-preview').style.display = 'none'; }
    restoreFavorites(); updateAccountUI(); renderFavorites(); renderFeatured(); if(catalogData)filterAndSortUnis(false);
}
function expireAccountSession() {
    const hadAccount = Boolean(currentUser); currentUser = null; uploadedFiles = [];
    restoreFavorites(); updateAccountUI(); renderDocuments(); renderFavorites(); renderFeatured();
    $('profileForm').reset(); $('advisorProfileForm').reset(); $('pdf-preview').style.display = 'none';
    if(catalogData)filterAndSortUnis(false);
    if ($('page-dashboard').classList.contains('active')) { switchAuthTab('login'); navigateTo('page-register'); }
    if (hadAccount) notify('სესია დასრულდა. პირად სივრცეში შესასვლელად გაიარე ავტორიზაცია.');
}
async function refreshAccountSession() {
    if (sessionCheck) return sessionCheck;
    sessionCheck = (async() => {
        try { const response = await api('/api/auth/me'); const user = (await response.json()).user; if (JSON.stringify(user) !== JSON.stringify(currentUser)) applyAccount(user); }
        catch (error) { if (error.status === 401) expireAccountSession(); }
        finally { sessionCheck = null; }
    })();
    return sessionCheck;
}
async function bootstrapAccount() {
    const status = $('authSessionStatus'); status.hidden = false; status.textContent = 'ვამოწმებთ შენს სესიას…';
    // Wait for the server before enabling account submission, including an initial session request.
    document.querySelectorAll('#loginForm button[type="submit"],#registerForm button[type="submit"]').forEach(button => button.disabled = true);
    try {
        const response = await api('/api/auth/me'); applyAccount((await response.json()).user);
        $('authServiceStatus').textContent = DESIGN_PREVIEW ? 'ანგარიშის ვიზუალური დემო' : 'შენი პირადი სივრცე მზადაა';
    } catch (error) {
        if (error.status === 401) { currentUser = null; $('authServiceStatus').textContent = 'სტუდენტებისა და განათლების მრჩეველებისთვის'; }
        else { $('authServiceStatus').textContent = accountErrorMessage(error); $('authServiceStatus').dataset.error = 'true'; }
    } finally {
        authReady = true; status.hidden = true;
        document.querySelectorAll('#loginForm button[type="submit"],#registerForm button[type="submit"]').forEach(button => button.disabled = false);
        if (pendingAuthPage && currentUser && $('page-register').classList.contains('active')) { switchDashTab('profile'); navigateTo(pendingAuthPage,false); }
        else if (pendingAuthPage) switchAuthTab('login');
        pendingAuthPage = null;
    }
}
async function logout() {
    const buttons = [...document.querySelectorAll('[onclick="logout()"]')]; buttons.forEach(button => button.disabled = true);
    try {
        await api('/api/auth/logout',{method:'POST'});
        currentUser = null; uploadedFiles = [];
        restoreFavorites(); updateAccountUI(); renderDocuments(); renderFavorites(); renderFeatured(); filterAndSortUnis(false);
        $('profileForm').reset(); $('advisorProfileForm').reset(); $('loginForm').reset(); $('registerForm').reset();
        document.querySelectorAll('.dash-tab-content').forEach(panel => panel.style.display = panel.id === 'tab-profile' ? 'block' : 'none');
        $('pdf-preview').style.display = 'none'; navigateTo('page-home'); notify('ანგარიშიდან გამოხვედი.');
    } catch (error) { notify(accountErrorMessage(error),true); }
    finally { buttons.forEach(button => button.disabled = false); }
}
async function submitAuth(event, register = false) {
    event.preventDefault(); if (!authReady) return;
    const form = event.currentTarget; const errorId = register ? 'registerError' : 'loginError';
    clearAccountErrors(form,errorId);
    if (register && $('regPassword').value !== $('regPasswordConfirm').value) {
        showAccountError(form,errorId,{message:'პაროლები ერთმანეთს არ ემთხვევა.',fields:{passwordConfirm:true}}); return;
    }
    const button = form.querySelector('[type="submit"]'); const original = button.innerHTML;
    button.disabled = true; button.textContent = register ? 'იქმნება შენი ანგარიში…' : 'შევდივართ…';
    const phone = register ? $('regPhone').value.trim() : '';
    const payload = register
        ? {name:$('regName').value.trim(),email:$('regEmail').value.trim(),phone:phone.startsWith('+') ? phone : `${$('countryCode').value}${phone}`,password:$('regPassword').value,passwordConfirm:$('regPasswordConfirm').value,role:registrationRole,termsAccepted:$('regTerms').checked,...(registrationRole === 'student' ? {studentProfile:readStudentFields('reg')} : {advisorProfile:readAdvisorFields('reg')})}
        : {email:$('loginEmail').value.trim(),password:$('loginPassword').value,rememberMe:$('loginRemember').checked};
    try {
        const response = await api(`/api/auth/${register?'register':'login'}`,{method:'POST',headers:authHeaders(),body:JSON.stringify(payload)});
        applyAccount((await response.json()).user); switchDashTab('profile'); navigateTo('page-dashboard');
        form.reset(); $('authServiceStatus').textContent = 'შენი პირადი სივრცე მზადაა'; delete $('authServiceStatus').dataset.error;
        notify(register ? 'შენი ანგარიში შექმნილია. კეთილი იყოს შენი მობრძანება!' : 'კეთილი იყოს შენი დაბრუნება!');
    } catch (error) { showAccountError(form,errorId,error); }
    finally { button.disabled = false; button.innerHTML = original; }
}
async function saveAccountForm(event, professional) {
    event.preventDefault(); if (!currentUser) return navigateTo('page-register');
    const form = event.currentTarget; const errorId = professional ? 'advisorProfileError' : 'profileError'; clearAccountErrors(form,errorId);
    const button = form.querySelector('[type="submit"]'); const original = button.innerHTML; button.disabled = true; button.textContent = 'ინახება…';
    const payload = professional ? {advisorProfile:readAdvisorFields('advisor')} : {name:`${$('profileFirstName').value.trim()} ${$('profileLastName').value.trim()}`.trim(),phone:$('profilePhone').value.trim(),...(currentUser.role === 'student' ? {studentProfile:readStudentFields('profile')} : {})};
    try {
        const response = await api(professional?'/api/advisor/profile':'/api/user/profile',{method:'PUT',headers:authHeaders(),body:JSON.stringify(payload)});
        applyAccount((await response.json()).user); notify('შენი მონაცემები განახლდა.');
    } catch (error) { showAccountError(form,errorId,error); }
    finally { button.disabled = false; button.innerHTML = original; }
}
function saveProfile(event) { return saveAccountForm(event,false); }
function saveAdvisorAccount(event) { return saveAccountForm(event,true); }

// This explicit design-preview adapter never calls the account database.
function previewAccountRequest(path,options) {
    if (!path.startsWith('/api/auth/') && !['/api/user/profile','/api/student/profile','/api/advisor/profile'].includes(path)) return null;
    const body = JSON.parse(options.body || '{}');
    if (path.endsWith('/logout')) { previewAccount = null; return Response.json({message:'დემო სესია დასრულდა'}); }
    if (path.endsWith('/status')) return Response.json({provider:'preview',ready:true});
    if (path.endsWith('/register')) previewAccount = {...structuredClone(PREVIEW_USER),...body,id:'design-preview',_id:'design-preview',favorites:[],studentProfile:body.role === 'student' ? body.studentProfile : null,advisorProfile:body.role === 'advisor' ? {...body.advisorProfile,verificationStatus:'pending'} : null};
    if (path.endsWith('/login')) previewAccount = structuredClone(PREVIEW_USER);
    if (!previewAccount) throw Object.assign(new Error('დემო სესია დასრულებულია.'),{status:401});
    if ((options.method || 'GET') === 'PUT') {
        for (const key of ['name','phone','favorites']) if (key in body) previewAccount[key] = body[key];
        for (const key of ['studentProfile','advisorProfile']) if (key in body) previewAccount[key] = {...previewAccount[key],...body[key]};
    }
    const {password,passwordConfirm,termsAccepted,...safe} = previewAccount;
    return Response.json({user:safe},{status:path.endsWith('/register') ? 201 : 200});
}
