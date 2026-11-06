'use strict';
const crypto=require('node:crypto');
const bcrypt=require('bcryptjs');
const lifetime=20*60*1000;
// A reset token is bound to the current salted password hash. An atomic
// compare-and-change makes it single use across concurrent serverless instances.
function sign(payload,user,secret){return crypto.createHmac('sha256',secret+'\0'+user.passwordHash).update('globaledu-password-reset-v1:'+payload).digest('base64url');}
function createToken(user,now,secret){if(typeof secret!=='string'||secret.length<32)throw Error('A recovery signing secret is required.');const payload=Buffer.from(JSON.stringify({id:user.id,expires:now+lifetime,nonce:crypto.randomBytes(32).toString('base64url')})).toString('base64url');return payload+'.'+sign(payload,user,secret);}
function inspectToken(token,now){
    if(typeof token!=='string'||token.length>1500||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))return null;
    try{const [payload,signature]=token.split('.'),data=JSON.parse(Buffer.from(payload,'base64url').toString());if(typeof data.id!=='string'||data.id.length>128||!Number.isSafeInteger(data.expires)||data.expires<=now||data.expires>now+lifetime||typeof data.nonce!=='string'||data.nonce.length!==43)return null;return {payload,signature,...data};}catch{return null;}
}
function attachRecoveryRoutes({router,store,originAllowed,rateLimit,wrap,validatePassword,validateEmail,onlyKeys,clock,mailer,reserveRecovery,cookieOptions,cookieName}){
    router.get('/auth/recovery/status',(req,res)=>res.json({available:mailer.configured===true}));
    router.post('/auth/password-reset/request',originAllowed,rateLimit,wrap(async(req,res)=>{
        onlyKeys(req.body,['email']);const email=validateEmail(req.body.email);
        if(!mailer.configured)return res.status(503).json({code:'RECOVERY_NOT_CONFIGURED',message:'ელფოსტით აღდგენა ჯერ არ არის ჩართული. ახალი ანგარიშის შექმნის ნაცვლად მოგვიანებით სცადე.'});
        if(reserveRecovery&&!await reserveRecovery(email,req.ip)){res.set('Retry-After','3600');return res.status(429).json({message:'აღდგენის მოთხოვნების ლიმიტი ამოიწურა. მოგვიანებით სცადე.'});}
        const started=Date.now();const user=await store.findByEmail(email);
        // Return the same message and minimum duration for unknown, suspended,
        // successful and failed delivery cases; never return or log the token.
        try{if(user?.accountStatus==='active')await mailer.send(user.email,createToken(user,clock(),mailer.signingSecret));}catch{/* Delivery is deliberately not exposed to a requester. */}
        await new Promise(resolve=>setTimeout(resolve,Math.max(0,(mailer.minimumDurationMs??4000)-(Date.now()-started))));
        res.status(202).json({message:'თუ ასეთი ანგარიში არსებობს, აღდგენის ბმულს ელფოსტით მიიღებ. ბმული 20 წუთი მოქმედებს.'});
    }));
    router.post('/auth/password-reset/confirm',originAllowed,rateLimit,wrap(async(req,res)=>{
        if(!mailer.configured)return res.status(503).json({code:'RECOVERY_NOT_CONFIGURED',message:'ელფოსტით აღდგენა ჯერ არ არის ჩართული.'});
        onlyKeys(req.body,['token','password','passwordConfirm']);const password=validatePassword(req.body.password);
        if(password!==req.body.passwordConfirm)return res.status(400).json({message:'პაროლები ერთმანეთს არ ემთხვევა.',fields:{passwordConfirm:true}});
        const data=inspectToken(req.body.token,clock());const invalid=()=>res.status(400).json({message:'აღდგენის ბმული არასწორია, ვადა გაუვიდა ან უკვე გამოყენებულია.'});
        if(!data)return invalid();const user=await store.findById(data.id);if(!user||user.accountStatus!=='active')return invalid();
        const expected=Buffer.from(sign(data.payload,user,mailer.signingSecret)),actual=Buffer.from(data.signature);if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return invalid();
        if(!await store.changePassword(user.id,user.passwordHash,await bcrypt.hash(password,12)))return invalid();
        res.clearCookie(cookieName,cookieOptions);res.json({message:'პაროლი შეიცვალა. შედი ახალი პაროლით.'});
    }));
}
module.exports={createToken,inspectToken,attachRecoveryRoutes};
