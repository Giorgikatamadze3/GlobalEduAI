require('dotenv').config({ path: require('path').join(__dirname, '.env'), quiet:true });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { PDFDocument } = require('pdf-lib');
const nodemailer = require('nodemailer');
const path = require('path');
const { loadCatalog } = require('./catalog-service');
const { createConfiguredAccountStore } = require('./account-store-config');
const { createAuthRouter } = require('./auth');
const { createAdvisorRouter } = require('./ai-agent');
const catalog = loadCatalog();
const accountStore = createConfiguredAccountStore();

const app = express();
if(process.env.VERCEL==='1')app.set('trust proxy',1);
app.locals.accountStore = accountStore;
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
app.use('/api/advisor-agent',express.json({limit:'128kb'}),createAdvisorRouter({catalog}));
app.use(express.json({limit:'64kb'}));
app.get('/assets/vendor/pdf-lib.min.js',(req,res)=>res.sendFile(require.resolve('pdf-lib/dist/pdf-lib.min.js')));
app.use('/assets', express.static(path.join(__dirname, '../assets')));
for (const filename of ['index.html','i18n.js','style.css','ai-agent.css','funding.css','script.js','catalog-core.js','scoring-core.js','funding-core.js','funding-ui.js','catalog-ui.js','discovery-ui.js','ai-agent-ui.js','account-ui.js','preview-data.js','scholarships.js']) {
    app.get(`/${filename}`, (req,res) => res.sendFile(path.join(__dirname, '..', filename)));
}
app.get('/', (req,res) => res.sendFile(path.join(__dirname, '../index.html')));

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

app.use('/api',createAuthRouter({store:accountStore,cookieSecure:process.env.NODE_ENV==='production'||process.env.VERCEL==='1'}));

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

const upload = multer({storage:multer.memoryStorage(),limits:{files:20,fileSize:20*1024*1024}});
app.post('/api/generate-pdf', upload.array('documents'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ message: "ფაილები არ არის." });
        const mergedPdf = await PDFDocument.create();
        for (const file of req.files) {
            const pdf = await PDFDocument.load(file.buffer);
            const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));
        }
        const pdfBytes = await mergedPdf.save();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="GlobalEdu_Application.pdf"');
        res.send(Buffer.from(pdfBytes));
    } catch (error) { res.status(500).json({ message: "PDF-ის გენერაცია ვერ მოხერხდა." }); }
});

app.post('/api/send-application', (req,res,next)=>{
    if(process.env.ENABLE_APPLICATION_EMAIL!=='true'||!process.env.EMAIL_USER||!process.env.EMAIL_PASS)return res.status(503).json({message:'აპლიკაციის ელფოსტით გაგზავნა ამ ეტაპზე ხელმისაწვდომი არ არის.'});
    next();
},upload.single('finalPdf'), async (req, res) => {
    try {
        const { uniEmail, studentName, messageBody } = req.body;
        const pdfFile = req.file;
        let transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
        let mailOptions = {
            from: `"GlobalEdu Admissions" <${process.env.EMAIL_USER}>`,
            to: uniEmail, subject: `New Application Submission: ${studentName}`, text: messageBody,
            attachments: [{ filename: `${studentName.replace(' ', '_')}_Application.pdf`, content: pdfFile.buffer }]
        };
        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: "აპლიკაცია გაიგზავნა!" });
    } catch (error) { res.status(500).json({ message: "მეილის გაგზავნა ვერ მოხერხდა." }); }
});

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
