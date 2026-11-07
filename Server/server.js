require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet:true });
const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadCatalog } = require('./catalog-service');
const { createConfiguredAccountStore } = require('./account-store-config');
const { createAuthRouter } = require('./auth');
const { createAdvisorRouter } = require('./ai-agent');
const baseCatalog = loadCatalog();
const {createContentStore}=require('./content-store');
const {createContentService}=require('./content-service');
const {createAdminRouter}=require('./admin-router');
const contentStore=createContentStore();
const content=createContentService({baseCatalog,store:contentStore});
const catalog=new Proxy({},{get:(_target,key)=>content.catalog[key]});
const accountStore = createConfiguredAccountStore();
const billingStore=require('./billing-store').createBillingStore();
const paymentProvider=require('./bog-payments').createBogProvider();
const billingService=require('./billing-service').createBillingService({store:billingStore,provider:paymentProvider,origin:process.env.BILLING_PUBLIC_ORIGIN||'https://globaleduai.vercel.app'});
const {createBillingRouter,createBillingPublicRouter,billingError}=require('./billing-router');
const authRouter=createAuthRouter({store:accountStore,billingStore,billingRouter:createBillingRouter({store:billingStore,service:billingService,accountStore}),adminRouter:createAdminRouter({content}),cookieSecure:process.env.NODE_ENV==='production'||process.env.VERCEL==='1'});

const app = express();
if(process.env.VERCEL==='1')app.set('trust proxy',1);
app.locals.accountStore = accountStore;
app.locals.contentStore = contentStore;
app.locals.billingStore=billingStore;
app.use(cors((req,callback) => {
    const origin = req.get('origin');
    let allowed = false;
    if (origin) {
        try {
            const requested = new URL(origin);
            const own = new URL(`${req.protocol}://${req.get('host')}`);
            allowed = origin === requested.origin && requested.origin === own.origin;
            if (!allowed && process.env.NODE_ENV !== 'production') {
                const loopback = new Set(['localhost','127.0.0.1','[::1]']);
                const ports = new Set(['3000','5500','5501','5173','4173',own.port,String(process.env.PORT || '3000')]);
                allowed = origin === requested.origin && requested.protocol === 'http:' && loopback.has(requested.hostname) && loopback.has(own.hostname) && ports.has(requested.port);
            }
        } catch { allowed = false; }
    }
    callback(null,{origin:allowed?origin:false,credentials:true,methods:['GET','POST','PUT','OPTIONS'],allowedHeaders:['Content-Type','Authorization']});
}));
app.use('/api',require('./database-config').migrationMaintenance());
app.use('/api',async(req,res,next)=>{await content.refresh();next();});
app.get('/api/content',(req,res)=>{res.set('Cache-Control','no-store');res.json(content.publicChanges());});
// Signed callbacks must receive the raw bytes before the JSON parser.
app.use('/api/billing',createBillingPublicRouter({store:billingStore,service:billingService,provider:paymentProvider,accountStore}));
app.use('/api/advisor-agent',express.json({limit:'128kb'}),(req,res,next)=>req.path.replace(/\/+$/,'').toLowerCase()==='/chat'?authRouter.originAllowed(req,res,()=>authRouter.authenticated(req,res,next)):next(),createAdvisorRouter({catalog,billingStore}));
app.use('/api/user/workspace',express.json({limit:'1mb'}));
app.use(express.json({limit:'64kb'}));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
for (const filename of ['locale-extensions.js','language-picker.js','study-calendar-core.js','study-calendar.js','account-security.js','catalog-updates.js','features.css','experience-core.js','experience-ui.js','experience.css','billing-ui.js','business-ui.js','billing.css','content-ui.js','admin-ui.js','content.css','index.html','i18n.js','style.css','ai-agent.css','funding.css','script.js','catalog-core.js','scoring-core.js','funding-core.js','funding-ui.js','catalog-ui.js','discovery-ui.js','ai-agent-ui.js','account-ui.js', 'student-profile-core.js', 'academic-profile-ui.js', 'account-workspace.css', 'student-workspace-core.js', 'student-workspace.js','preview-data.js','scholarships.js']) {
    app.get(`/${filename}`, (req,res) => res.sendFile(path.join(__dirname, '..', filename)));
}
app.get('/', (req,res) => res.sendFile(path.join(__dirname, '../index.html')));
const publicPages=require('./public-pages').createPublicPages({catalog});
app.get('/:lang/programs/:id',(req,res,next)=>require('../i18n').LANGUAGES.includes(req.params.lang)?publicPages.program(req,res):next());
app.get('/:lang/countries/:code',(req,res,next)=>require('../i18n').LANGUAGES.includes(req.params.lang)?publicPages.country(req,res):next());
app.get('/sitemap.xml',publicPages.sitemap);
app.get('/sitemap-:lang.xml',publicPages.sitemap);
app.get('/robots.txt',publicPages.robots);

// Public discovery works from the versioned local catalog, independently of MongoDB.
function serveCatalog(req,res) {
    if(process.env.VERCEL==='1'&&req.path==='/api/catalog')return res.redirect(307,'/catalog.json');
    res.set({'ETag':catalog.etag, 'Cache-Control':'public, max-age=300'});
    res.vary('Accept-Encoding');
    if (req.headers['if-none-match'] === catalog.etag) return res.status(304).end();
    res.type('application/json');
    if (req.acceptsEncodings('gzip')) {
        res.set('Content-Encoding','gzip'); return res.send(catalog.gzip);
    }
    res.send(catalog.json);
}
app.get('/api/catalog',serveCatalog);
app.get('/catalog.json',serveCatalog);
app.get('/api/catalog/meta', (req,res) => res.json(catalog.payload.metadata));
app.get('/api/catalog/refresh-status',(req,res)=>{
    let status={status:'not-run',intervalHours:6,lastSuccessfulAt:null};try{status=require('./data/catalog-refresh-status.json');}catch{}
    res.set('Cache-Control','no-store').json({status:status.status,intervalHours:6,attemptedAt:status.attemptedAt||null,completedAt:status.completedAt||null,lastSuccessfulAt:status.lastSuccessfulAt||null,successfulSources:status.successfulSources||0,failedSources:status.failedSources||0});
});
app.get('/api/institutions', (req,res) => res.json(catalog.listInstitutions(req.query)));
app.get('/api/institutions/:id', (req,res) => {
    const institution = catalog.institutionById(req.params.id);
    if (!institution) return res.status(404).json({message:'უნივერსიტეტი ვერ მოიძებნა.'});
    const funding=catalog.fundingForInstitution(institution.id).filter(a=>a.status!=='ineligible').map(({programAssessments,associatedProgramIds=[],...assessment})=>({...assessment,associatedProgramIds:associatedProgramIds.slice(0,24),associatedProgramCount:associatedProgramIds.length}));
    res.json({institution, programs:catalog.payload.programs.filter(p => p.institutionId === institution.id), funding, coverage:'partial'});
});
app.post('/api/recommendations', (req,res) => {
    if (!req.body || Array.isArray(req.body) || typeof req.body !== 'object') return res.status(400).json({message:'შეიყვანე შერჩევის პირობები.'});
    const asOf=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tbilisi',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    res.json(catalog.recommend(req.body, {asOf}));
});
app.get('/api/programs', (req,res) => res.json({items:catalog.payload.programs, total:catalog.payload.programs.length}));
app.get('/api/programs/:id', (req,res) => {
    const program=catalog.programById(req.params.id);
    if(!program)return res.status(404).json({message:'პროგრამა ვერ მოიძებნა.'});
    res.json({program,funding:catalog.fundingForProgram(program.id).filter(a=>a.status!=='ineligible')});
});
app.get('/api/funding', (req,res) => res.json(catalog.payload.funding));

app.use('/api',authRouter);

// Compatibility endpoint: real institutions only; the former synthetic collection is not served.
app.get('/api/universities', (req,res) => res.json(catalog.payload.institutions));

// სააგენტოების API
app.get('/api/agencies', (req, res) => {
    try {
        const agencies = [
            { id: 1, name: "LEAF Education", desc: "სრული მხარდაჭერა ევროპისა და აშშ-ს წამყვან უნივერსიტეტებში ჩასაბარებლად.", icon: "🍃" },
            { id: 2, name: "Prime Study", desc: "პროფესიონალური კონსულტაცია და სავიზო მხარდაჭერა ევროპის ქვეყნებში.", icon: "⭐" },
            { id: 3, name: "EducationUSA", desc: "ოფიციალური ცენტრი, რომელიც დაგეხმარებათ აშშ-ში სწავლის გაგრძელებაში.", icon: "🇺🇸" },
            { id: 4, name: "Global Study", desc: "სტიპენდიების მოძიება, აპლიკაციის მენეჯმენტი და ენის კურსები საზღვარგარეთ.", icon: "🌍" },
            { id: 5, name: "EuroEdu Consultants", desc: "ფოკუსირებული ევროკავშირის უნივერსიტეტებზე და Erasmus პროგრამებზე.", icon: "🇪🇺" },
            { id: 6, name: "Future Leaders Academy", desc: "სამოტივაციო წერილების (SOP) და ინტერვიუს მომზადების სერვისები.", icon: "🎯" }
        ];
        res.status(200).json(agencies);
    } catch (error) { res.status(500).json({ message: "შეცდომა სააგენტოების ჩატვირთვისას." }); }
});

app.post(['/api/generate-pdf','/api/send-application'],(req,res)=>res.status(410).json({code:'FEATURE_RETIRED',message:'PDF გაერთიანება ამოღებულია. გამოიყენე სასწავლო კალენდარი და პირადი გეგმა.'}));

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    const listener = app.listen(PORT);
    listener.on('listening', () => console.log(`GlobalEdu: http://localhost:${PORT} — ${catalog.payload.metadata.institutionCount} უნივერსიტეტი; ანგარიშები: ${accountStore.info.provider}`));
    listener.on('error', error => { accountStore.close(); console.error(error.code === 'EADDRINUSE' ? `პორტი ${PORT} დაკავებულია. გადატვირთე გაშვებული სერვერი ან აირჩიე სხვა PORT.` : 'სერვერის გაშვება ვერ მოხერხდა.'); process.exitCode = 1; });
    let shuttingDown = false;
    const shutdown = () => {
        if (shuttingDown) return;
        shuttingDown = true;
        listener.close(() => Promise.resolve(accountStore.close()).catch(()=>{}));
        listener.closeIdleConnections();
    };
    process.once('SIGINT',shutdown);
    process.once('SIGTERM',shutdown);
}
module.exports = app;
