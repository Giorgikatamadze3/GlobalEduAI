'use strict';

const express = require('express');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const Core = require('../catalog-core');

const COOKIE_NAME='globaledu_session';
const TERMS_VERSION='2026-10-27';
const EDUCATION_LEVELS=new Set(['high-school','bachelor','master','phd','other']);
const SPECIALTIES=new Set(Core.FIELDS.map(field=>field.value));
const hashToken=token=>crypto.createHash('sha256').update(token).digest('hex');
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const normalizedEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
const text=value=>typeof value==='string'?value.trim():'';

class ValidationError extends Error {
    constructor(message,fields={}) {super(message);this.status=400;this.fields=fields;}
}
function fail(message,field){throw new ValidationError(message,field?{[field]:message}:{});}
function onlyKeys(value,keys,label='მონაცემები'){
    if(!isObject(value))fail(`${label}: მიუთითე ვალიდური მონაცემები.`);
    const forbidden=Object.keys(value).filter(key=>!keys.includes(key));
    if(forbidden.length)fail(`${label}: შეიცავს დაუშვებელ ველს.`,forbidden[0]);
}
function validateName(value){const name=text(value);if(name.length<2||name.length>100)fail('სახელი და გვარი უნდა შეიცავდეს 2–100 სიმბოლოს.','name');return name;}
function validateEmail(value){const email=normalizedEmail(value);if(email.length>254||!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email))fail('მიუთითე სწორი ელ. ფოსტა.','email');return email;}
function validatePhone(value){const raw=text(value);if(!/^[+\d\s().-]+$/.test(raw))fail('მიუთითე სწორი ტელეფონის ნომერი.','phone');const phone=raw.replace(/[\s().-]/g,'');if(!/^\+?\d{7,15}$/.test(phone))fail('ტელეფონი უნდა შეიცავდეს 7–15 ციფრს.','phone');return phone;}
function validatePassword(value){
    if(typeof value!=='string'||[...value].length<10||Buffer.byteLength(value,'utf8')>72||!/[\p{L}]/u.test(value)||!/[\p{N}]/u.test(value))fail('პაროლი უნდა შეიცავდეს მინიმუმ 10 სიმბოლოს, ერთ ასოსა და ერთ ციფრს; მაქსიმუმ 72 UTF-8 ბაიტი.','password');
    return value;
}
function shortText(value,max,field){if(typeof value!=='string'||value.trim().length>max)fail(`ველი უნდა შეიცავდეს მაქსიმუმ ${max} სიმბოლოს.`,field);return value.trim();}
function validateStudent(value={},partial=false){
    onlyKeys(value,['educationLevel','citizenshipCode','graduationYear',...require('../student-profile-core').EXTRA_FIELDS],'სტუდენტის პროფილი');const result={};
    try{Object.assign(result,require('../student-profile-core').normalizeExtras(value));}catch(error){fail(error.message,error.field);}
    if('educationLevel'in value){const level=text(value.educationLevel);if(level&&!EDUCATION_LEVELS.has(level))fail('აირჩიე განათლების სწორი საფეხური.','educationLevel');result.educationLevel=level;}
    if('citizenshipCode'in value){const code=text(value.citizenshipCode).toUpperCase();if(code&&!Core.COUNTRIES[code])fail('აირჩიე მოქალაქეობა სიიდან.','citizenshipCode');result.citizenshipCode=code;}
    if('graduationYear'in value){const year=value.graduationYear===''||value.graduationYear===null?null:value.graduationYear;if(year!==null&&(!Number.isInteger(year)||year<1950||year>new Date().getUTCFullYear()+20))fail('მიუთითე დასრულების სწორი წელი.','graduationYear');result.graduationYear=year;}
    return partial?result:{educationLevel:'',citizenshipCode:'',graduationYear:null,...result};
}
function validateAdvisor(value={},partial=false){
    onlyKeys(value,['organizationName','position','website','bio','specialties'],'მრჩეველის პროფილი');const result={};
    for(const [key,max]of [['organizationName',150],['position',100],['bio',2000]])if(key in value)result[key]=shortText(value[key],max,key);
    if(!partial||'organizationName'in value)if((result.organizationName||'').length<2)fail('მიუთითე ორგანიზაციის ან პრაქტიკის სახელი.','organizationName');
    if(!partial||'position'in value)if((result.position||'').length<2)fail('მიუთითე შენი პოზიცია.','position');
    if('website'in value){const website=shortText(value.website,2048,'website');if(website){let parsed;try{parsed=new URL(website);}catch{fail('ვებსაიტი მიუთითე სრული https:// ან http:// მისამართით.','website');}if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.href.length>2048)fail('მიუთითე უსაფრთხო HTTP(S) ვებსაიტის მისამართი.','website');result.website=parsed.href;}else result.website='';}
    if('specialties'in value){if(!Array.isArray(value.specialties)||value.specialties.length>20||value.specialties.some(item=>!SPECIALTIES.has(item)))fail('აირჩიე მხარდაჭერილი საკონსულტაციო მიმართულებები.','specialties');result.specialties=[...new Set(value.specialties)];}
    return partial?result:{organizationName:'',position:'',website:'',bio:'',specialties:[],...result};
}
function publicUser(user){
    return {_id:user.id,id:user.id,name:user.name,email:user.email,phone:user.phone,role:user.role,favorites:user.favorites||[],
        studentProfile:user.role==='student'?user.studentProfile:null,
        advisorProfile:user.role==='advisor'?user.advisorProfile:null,
        createdAt:user.createdAt,updatedAt:user.updatedAt};
}
function cookieToken(req){
    const header=req.headers.cookie||'';const pair=header.split(';').map(s=>s.trim()).find(s=>s.startsWith(`${COOKIE_NAME}=`));
    if(!pair)return null;try{const token=decodeURIComponent(pair.slice(COOKIE_NAME.length+1));return /^[a-f0-9]{64}$/.test(token)?token:null;}catch{return null;}
}

function createAuthRouter({store,cookieSecure=process.env.NODE_ENV==='production',clock=()=>Date.now(),rateLimitOptions={}}={}){
    if(!store)throw new Error('Authentication requires an account store.');
    const router=express.Router();const buckets=new Map();
    const sessionHours=12,rememberDays=30;
    const dummyHash=bcrypt.hashSync('GlobalEdu-Dummy-Password-9230',12);
    const now=()=>new Date(clock()).toISOString();
    const cookieOptions={httpOnly:true,sameSite:'lax',secure:cookieSecure,path:'/'};
    const wrap=handler=>async(req,res,next)=>{try{await handler(req,res,next);}catch(error){next(error);}};
    function originAllowed(req,res,next){
        const origin=req.headers.origin;
        if(origin){
            let allowed=false;
            try{const url=new URL(origin);const own=new URL(`${req.protocol}://${req.get('host')}`);allowed=url.origin===own.origin;
                if(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&['localhost','127.0.0.1','[::1]'].includes(own.hostname))allowed=['3000','5500','5501','5173','4173',own.port].includes(url.port)&&url.protocol==='http:';
            }catch{allowed=false;}
            if(!allowed)return res.status(403).json({message:'ამ მისამართიდან ანგარიშის შეცვლა დაუშვებელია.'});
        }
        next();
    }
    function rateLimit(req,res,next){
        const windowMs=rateLimitOptions.windowMs||15*60*1000,max=rateLimitOptions.max||30,key=`${req.ip}:${req.path.toLowerCase().replace(/\/+$/,'')}`,time=clock();
        let bucket=buckets.get(key);if(!bucket||bucket.resetAt<=time){bucket={count:0,resetAt:time+windowMs};buckets.set(key,bucket);}
        if(buckets.size>5000)for(const [id,item]of buckets)if(item.resetAt<=time)buckets.delete(id);
        bucket.count++;if(bucket.count>max){res.set('Retry-After',String(Math.max(1,Math.ceil((bucket.resetAt-time)/1000))));return res.status(429).json({message:'ცდების ლიმიტი ამოიწურა. ცოტა ხანში სცადე ხელახლა.'});}next();
    }
    async function issueSession(req,res,user,remember=false){
        const previous=cookieToken(req);if(previous)await store.deleteSession(hashToken(previous));
        const token=crypto.randomBytes(32).toString('hex');const duration=remember?rememberDays*86400000:sessionHours*3600000;
        await store.pruneSessions(now());await store.createSession({idHash:hashToken(token),userId:user.id,createdAt:now(),expiresAt:new Date(clock()+duration).toISOString()});
        res.cookie(COOKIE_NAME,token,{...cookieOptions,...(remember?{maxAge:duration}:{})});
    }
    const authenticated=wrap(async(req,res,next)=>{
        const token=cookieToken(req),session=token?await store.findSession(hashToken(token),now()):null;
        const user=session?await store.findById(session.userId):null;
        if(!user||user.accountStatus!=='active'){res.clearCookie(COOKIE_NAME,cookieOptions);return res.status(401).json({message:'ანგარიშში შესვლა აუცილებელია ან სესია ამოიწურა.'});}
        req.account=user;req.sessionHash=hashToken(token);next();
    });
    const role=expected=>(req,res,next)=>req.account.role===expected?next():res.status(403).json({message:'ამ განყოფილებაზე წვდომა შენს როლს არ აქვს.'});
    router.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
    router.use(wrap(async(req,res,next)=>{
        if(/^\/(?:auth(?:\/|$)|(?:user|student|advisor)\/profile(?:\/|$))/i.test(req.path)&&req.path.toLowerCase()!=='/auth/status'){
            try{if(typeof store.ready==='function')await store.ready();}
            catch{throw Object.assign(new Error('Account database unavailable.'),{code:'AUTH_DATABASE_UNAVAILABLE'});}
        }
        next();
    }));
    router.get('/auth/status',wrap(async(req,res)=>{
        const provider=store.info?.provider||'unknown';
        try{if(typeof store.ready==='function')await store.ready();res.json({provider,ready:true,roles:['student','advisor']});}
        catch{res.status(503).json({provider,ready:false,roles:['student','advisor'],message:'ანგარიშების საცავი დროებით მიუწვდომელია.'});}
    }));
    router.post('/auth/register',originAllowed,rateLimit,wrap(async(req,res)=>{
        const body=req.body;onlyKeys(body,['name','email','phone','password','passwordConfirm','role','termsAccepted','studentProfile','advisorProfile']);
        if(!['student','advisor'].includes(body.role))fail('აირჩიე სტუდენტის ან მრჩეველის ანგარიში.','role');
        const name=validateName(body.name),email=validateEmail(body.email),phone=validatePhone(body.phone),password=validatePassword(body.password);
        if(typeof body.passwordConfirm!=='string'||password!==body.passwordConfirm)fail('პაროლები ერთმანეთს არ ემთხვევა.','passwordConfirm');
        if(body.termsAccepted!==true)fail('ანგარიშის შესაქმნელად წესებზე თანხმობა აუცილებელია.','termsAccepted');
        if(body.role==='student'&&body.advisorProfile!==undefined)fail('სტუდენტის ანგარიშს მრჩეველის პროფილი ვერ მიენიჭება.','advisorProfile');
        if(body.role==='advisor'&&body.studentProfile!==undefined)fail('მრჩეველის ანგარიშს სტუდენტის პროფილი ვერ მიენიჭება.','studentProfile');
        const studentProfile=body.role==='student'?validateStudent(body.studentProfile||{}):null;
        const advisorProfile=body.role==='advisor'?{...validateAdvisor(body.advisorProfile||{}),verificationStatus:'pending'}:null;
        if(await store.findByEmail(email))return res.status(409).json({message:'ეს ელ. ფოსტა უკვე რეგისტრირებულია.',fields:{email:'გამოიყენე სხვა ელ. ფოსტა ან შედი ანგარიშში.'}});
        const user=await store.createUser({id:crypto.randomUUID(),name,email,phone,passwordHash:await bcrypt.hash(password,12),role:body.role,studentProfile,advisorProfile,favorites:[],createdAt:now(),updatedAt:now(),termsAcceptedAt:now(),termsVersion:TERMS_VERSION});
        await issueSession(req,res,user,false);res.status(201).json({message:'ანგარიში წარმატებით შეიქმნა.',user:publicUser(user)});
    }));
    router.post('/auth/login',originAllowed,rateLimit,wrap(async(req,res)=>{
        onlyKeys(req.body,['email','password','rememberMe']);const email=validateEmail(req.body.email);
        if(typeof req.body.password!=='string'||!req.body.password||Buffer.byteLength(req.body.password,'utf8')>72)fail('მიუთითე პაროლი.','password');
        if(req.body.rememberMe!==undefined&&typeof req.body.rememberMe!=='boolean')fail('დამახსოვრების არჩევანი არასწორია.','rememberMe');
        const user=await store.findByEmail(email);const matches=await bcrypt.compare(req.body.password,user?.passwordHash||dummyHash);
        if(!user||!matches||user.accountStatus!=='active')return res.status(401).json({message:'ელ. ფოსტა ან პაროლი არასწორია.'});
        await issueSession(req,res,user,req.body.rememberMe===true);res.json({user:publicUser(user)});
    }));
    router.get('/auth/me',authenticated,(req,res)=>res.json({user:publicUser(req.account)}));
    router.post('/auth/logout',originAllowed,wrap(async(req,res)=>{const token=cookieToken(req);if(token)await store.deleteSession(hashToken(token));res.clearCookie(COOKIE_NAME,cookieOptions);res.json({message:'ანგარიშიდან გამოხვედი.'});}));
    const sendProfile=(req,res)=>res.json({user:publicUser(req.account)});
    async function updateProfile(req,res){
        const body=req.body;onlyKeys(body,['name','phone','favorites','studentProfile','advisorProfile']);const patch={};
        if('name'in body)patch.name=validateName(body.name);if('phone'in body)patch.phone=validatePhone(body.phone);
        if('favorites'in body){if(!Array.isArray(body.favorites)||body.favorites.length>200||body.favorites.some(id=>typeof id!=='string'||!id||id.length>200))fail('ფავორიტების სია არასწორია.','favorites');patch.favorites=[...new Set(body.favorites)];}
        if('studentProfile'in body){if(req.account.role!=='student')fail('სტუდენტის პროფილის შეცვლა ამ როლისთვის დაუშვებელია.','studentProfile');patch.studentProfile={...req.account.studentProfile,...validateStudent(body.studentProfile,true)};}
        if('advisorProfile'in body){if(req.account.role!=='advisor')fail('მრჩეველის პროფილის შეცვლა ამ როლისთვის დაუშვებელია.','advisorProfile');patch.advisorProfile={...req.account.advisorProfile,...validateAdvisor(body.advisorProfile,true),verificationStatus:req.account.advisorProfile?.verificationStatus||'pending'};}
        if(!Object.keys(patch).length)fail('შესაცვლელი მონაცემი არ არის მითითებული.');
        const user=await store.updateUser(req.account.id,patch);res.json({message:'პროფილი წარმატებით განახლდა.',user:publicUser(user)});
    }
    router.get('/user/profile',authenticated,sendProfile);router.put('/user/profile',originAllowed,authenticated,wrap(updateProfile));
    router.get('/student/profile',authenticated,role('student'),sendProfile);router.put('/student/profile',originAllowed,authenticated,role('student'),wrap(updateProfile));
    router.get('/advisor/profile',authenticated,role('advisor'),sendProfile);router.put('/advisor/profile',originAllowed,authenticated,role('advisor'),wrap(updateProfile));
    router.use((error,req,res,next)=>{
        if(error instanceof ValidationError)return res.status(400).json({message:error.message,fields:error.fields});
        if(error.code==='AUTH_DATABASE_UNAVAILABLE')return res.status(503).json({code:'AUTH_DATABASE_UNAVAILABLE',message:'ანგარიშების საცავი დროებით მიუწვდომელია. სცადე მოგვიანებით.'});
        if(error.code==='EMAIL_EXISTS')return res.status(409).json({message:'ეს ელ. ფოსტა უკვე რეგისტრირებულია.',fields:{email:'ელ. ფოსტა უკვე გამოყენებულია.'}});
        console.error('Account request failed:',error.code||error.name);res.status(500).json({message:'ანგარიშის მოთხოვნა ვერ შესრულდა. სცადე ხელახლა.'});
    });
    return router;
}
module.exports={createAuthRouter,publicUser,validatePassword,COOKIE_NAME};
