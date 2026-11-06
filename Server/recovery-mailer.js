'use strict';
function createRecoveryMailer(environment=process.env){
    const configured=environment.ENABLE_PASSWORD_RECOVERY==='true'&&!!environment.RECOVERY_SMTP_HOST&&!!environment.RECOVERY_SMTP_USER&&!!environment.RECOVERY_SMTP_PASS&&!!environment.RECOVERY_MAIL_FROM&&typeof environment.RECOVERY_SIGNING_SECRET==='string'&&environment.RECOVERY_SIGNING_SECRET.length>=32;
    const origin=environment.PUBLIC_SITE_URL||'https://globaleduai.vercel.app';
    let url;try{url=new URL(origin);}catch{}
    const ready=Boolean(configured&&url?.protocol==='https:'&&!url.username&&!url.password);
    return {configured:ready,signingSecret:ready?environment.RECOVERY_SIGNING_SECRET:null,origin:ready?url.origin:'https://globaleduai.vercel.app',async send(email,token){
        if(!ready)throw Error('Recovery mail is not configured.');
        const link=new URL('/#reset-password',url.origin);link.hash='reset-password?token='+encodeURIComponent(token);
        const transport=require('nodemailer').createTransport({host:environment.RECOVERY_SMTP_HOST,port:Number(environment.RECOVERY_SMTP_PORT||587),secure:environment.RECOVERY_SMTP_PORT==='465',requireTLS:true,auth:{user:environment.RECOVERY_SMTP_USER,pass:environment.RECOVERY_SMTP_PASS},connectionTimeout:3000,greetingTimeout:3000,socketTimeout:3000});
        let timer;
        try{await Promise.race([transport.sendMail({from:environment.RECOVERY_MAIL_FROM,to:email,subject:'GlobalEdu — პაროლის აღდგენა',text:'პაროლის შესაცვლელად გახსენი ბმული (მოქმედებს 20 წუთი):\n'+link.href+'\nთუ ეს შენ არ მოგითხოვია, წერილი უგულებელყავი.'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Recovery delivery timed out.')),3000);})]);}finally{clearTimeout(timer);transport.close();}
    }};
}
module.exports={createRecoveryMailer};
