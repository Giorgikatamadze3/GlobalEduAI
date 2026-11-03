'use strict';
const {verify}=require('node:crypto');
const {fail}=require('./billing-core');
// Official Payment Manager callback key, checked 2026-11-03.
const CALLBACK_KEY=`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAu4RUyAw3+CdkS3ZNILQh
zHI9Hemo+vKB9U2BSabppkKjzjjkf+0Sm76hSMiu/HFtYhqWOESryoCDJoqffY0Q
1VNt25aTxbj068QNUtnxQ7KQVLA+pG0smf+EBWlS1vBEAFbIas9d8c9b9sSEkTrr
TYQ90WIM8bGB6S/KLVoT1a7SnzabjoLc5Qf/SLDG5fu8dH8zckyeYKdRKSBJKvhx
tcBuHV4f7qsynQT+f2UYbESX/TLHwT5qFWZDHZ0YUOUIvb8n7JujVSGZO9/+ll/g
4ZIWhC1MlJgPObDwRkRd8NFOopgxMcMsDIZIoLbWKhHVq67hdbwpAq9K9WMmEhPn
PwIDAQAB
-----END PUBLIC KEY-----`;
const SANDBOX_KEY=`-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqczfAuhtxw2iF68kS0Hy
bGSv0ZlDAjsXh6VC8avDl3Vxa9qCn6Pzl37Tl2Z21WodiISLeXdhCtOMTeLNUBeb
CYD31y2/MwnhLYqlCk2bOh29fyPc1iT5Eu/k/1IaNRrK9/UVZaTkhOMeEm+aL4y8
5XsE4UjqftEmwrAdbO2G4cCpuoMC9ZXG9gAdr2BFN6i2Vt9eCen5Poj7E1ik7s8T
GyzploVV0NflhwBGeWnvQANUQGr87gsP5k2JG1z5EwnMybJQ7i3XT726rJMaV6QW
sY5hP72Mtv1I1zL2d9FXm9FWOzbpcXCyxuEBXvqqOHzogri8C7KRRYKyk97Ri7D6
8wIDAQAB
-----END PUBLIC KEY-----`;
function createBogProvider({environment=process.env,fetchImpl=fetch,publicKey}={}){
 const live=environment.BOG_ENVIRONMENT==='live',mode=live?'live':'sandbox';
 const configured=environment.BOG_PAYMENTS_ENABLED==='true'&&!!environment.BOG_CLIENT_ID&&!!environment.BOG_CLIENT_SECRET&&(live?environment.BOG_LIVE_VERIFIED==='true':environment.VERCEL_ENV!=='production');
 const callbackKey=publicKey||(live?CALLBACK_KEY:SANDBOX_KEY),host=live?'api.bog.ge':'api-sandbox.bog.ge',oauthHost=live?'oauth2.bog.ge':'oauth2-sandbox.bog.ge',redirectHost=live?'payment.bog.ge':'payment-sandbox.bog.ge';
 let token,expires=0;
 const enabled=()=>{if(!configured)throw fail(503,'PAYMENTS_NOT_CONFIGURED','ონლაინ გადახდა ჯერ არ არის ჩართული. თანხა არ ჩამოგეჭრება.');};
 async function request(url,options){let res;try{res=await fetchImpl(url,{...options,signal:AbortSignal.timeout(12000)});}catch{throw fail(502,'PAYMENT_PROVIDER_UNAVAILABLE','ბანკთან კავშირი ვერ დადასტურდა. სტატუსი ხელახლა შეამოწმე.');}if(!res.ok)throw fail(502,'PAYMENT_PROVIDER_ERROR','ბანკმა ოპერაცია ვერ დაადასტურა. სტატუსი ხელახლა შეამოწმე.');if(res.status===202||res.status===204)return {};return res.json();}
 async function auth(){enabled();if(token&&Date.now()<expires)return token;const r=await request('https://'+oauthHost+'/auth/realms/bog/protocol/openid-connect/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(environment.BOG_CLIENT_ID+':'+environment.BOG_CLIENT_SECRET).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:'grant_type=client_credentials'});if(typeof r.access_token!=='string')throw fail(502,'PAYMENT_PROVIDER_ERROR','ბანკის ავტორიზაცია ვერ დადასტურდა.');token=r.access_token;expires=Date.now()+Math.min(300,Math.max(0,Number(r.expires_in)-30))*1000;return token;}
 async function api(path,{method='GET',body,key}={}){return request('https://'+host+'/payments/v1/'+path,{method,headers:{Authorization:'Bearer '+await auth(),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});}
 const orderId=id=>{if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw fail(400,'INVALID_ORDER','გადახდის იდენტიფიკატორი არასწორია.');return encodeURIComponent(id);};
 return {configured,mode,recurringEnabled:configured&&environment.BOG_RECURRING_ENABLED==='true',
  verify(raw,signature){try{return Buffer.isBuffer(raw)&&typeof signature==='string'&&signature.length<2048&&verify('RSA-SHA256',raw,callbackKey,Buffer.from(signature,'base64'));}catch{return false;}},
  async create(payment,origin){enabled();const amount=payment.amount/100;const r=await api('ecommerce/orders',{method:'POST',key:payment.id,body:{callback_url:origin+'/api/billing/webhook/bog',external_order_id:payment.id,purchase_units:{currency:'GEL',total_amount:amount,basket:[{quantity:1,unit_price:amount,product_id:payment.plan_id,description:'GlobalEduAI '+payment.plan_id+' '+payment.period}]},redirect_urls:{success:origin+'/?payment='+payment.id+'#billing',fail:origin+'/?payment='+payment.id+'#billing'}}});if(payment.consent)await api('orders/'+orderId(r.id)+'/subscriptions',{method:'PUT',key:payment.id});const url=new URL(r._links?.redirect?.href);if(url.protocol!=='https:'||url.hostname!==redirectHost||url.username||url.password)throw fail(502,'PAYMENT_PROVIDER_ERROR','ბანკის გადამისამართება არასწორია.');return {id:r.id,redirectUrl:url.href};},
  details:id=>api('receipt/'+orderId(id)),
  refund:(id,amount,key)=>api('payment/refund/'+orderId(id),{method:'POST',key,body:{amount:amount/100}}),
  renew:(id,payment,origin)=>api('ecommerce/orders/'+orderId(id)+'/subscribe',{method:'POST',key:payment.id,body:{external_order_id:payment.id,callback_url:origin+'/api/billing/webhook/bog'}}),
  deleteCard:(id,key)=>api('charges/card/'+orderId(id),{method:'DELETE',key})
 };
}
module.exports={createBogProvider,CALLBACK_KEY};
