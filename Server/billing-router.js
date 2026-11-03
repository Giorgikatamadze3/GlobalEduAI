'use strict';
const express=require('express'),{timingSafeEqual}=require('node:crypto'),{fail}=require('./billing-core');
const {adminAccess}=require('./admin-access');
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res,next);}catch(e){next(e);}};
function billingError(e,req,res,next){if(res.headersSent)return next(e);const known=Number.isInteger(e.status);if(!known)console.error('Billing request failed:',e.code||e.name);res.status(known?e.status:503).json({code:known?e.code:'BILLING_UNAVAILABLE',message:known?e.message:'პაკეტების სისტემა დროებით მიუწვდომელია. სცადე მოგვიანებით.'});}
function createBillingRouter({service,store,accountStore,adminPolicy=adminAccess}){
 const r=express.Router();r.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 r.get('/me',wrap(async(req,res)=>res.json(await service.snapshot(req.account))));
 r.post('/checkout',wrap(async(req,res)=>res.json(await service.checkout(req.account,req.body))));
 r.post('/cancel',wrap(async(req,res)=>res.json(await service.cancel(req.account))));
 r.post('/payments/:id/check',wrap(async(req,res)=>res.json(await service.reconcile(req.params.id,req.account.id))));
 r.post('/payments/:id/resume',wrap(async(req,res)=>res.json(await service.resume(req.account,req.params.id))));
 r.post('/activity',wrap(async(req,res)=>{await store.track(req.account,req.body.feature);res.json({recorded:true});}));
 r.post('/consultations',wrap(async(req,res)=>res.status(201).json(await service.consultation(req.account,req.body))));
 r.post('/consultations/:id/cancel',wrap(async(req,res)=>{await store.transaction(async q=>{const item=(await q('SELECT * FROM billing_consultations WHERE id=$1 AND user_id=$2',[req.params.id,req.account.id]))[0];if(!item)throw fail(404,'NOT_FOUND','მოთხოვნა ვერ მოიძებნა.');if(item.status!=='requested')throw fail(409,'CONSULTATION_CLOSED','დამუშავებულ მოთხოვნაზე ადმინისტრატორს დაუკავშირდი.');await q("UPDATE billing_consultations SET status='cancelled',updated_at=$1 WHERE id=$2",[store.now(),item.id]);await store.event(q,req.account.id,'consultation_cancelled',{id:item.id});});res.json({cancelled:true});}));
 r.use('/admin',(req,res,next)=>adminPolicy(req.account)?next():res.status(403).json({message:'ადმინისტრატორის წვდომაა საჭირო.'}));
 r.get('/admin/overview',wrap(async(req,res)=>{
  await store.ready();const day=store.now().slice(0,10),month=store.now().slice(0,7)+'-01';
  const scalar=async(sql,p=[])=>Number((await store.query(sql,p))[0].total);
  const [totalUsers,dau,mau,paid,paidCount,cancelled,pending,revenue,refunds,ai,aiMonth,consultations,upgrades]=await Promise.all([
   Promise.resolve(accountStore.listUsers({limit:1})).then(x=>x.total),scalar('SELECT COUNT(DISTINCT user_id) AS total FROM billing_activity WHERE day=$1',[day]),scalar('SELECT COUNT(DISTINCT user_id) AS total FROM billing_activity WHERE day >= $1',[month]),
   scalar("SELECT COUNT(*) AS total FROM billing_members WHERE plan_id<>'free' AND status IN ('active','cancelled') AND ends_at>$1",[store.now()]),scalar("SELECT COUNT(*) AS total FROM billing_payments WHERE applied_at IS NOT NULL"),
   scalar("SELECT COUNT(*) AS total FROM billing_events WHERE kind='subscription_cancelled'"),scalar("SELECT COUNT(*) AS total FROM billing_payments WHERE status='pending'"),scalar('SELECT COALESCE(SUM(amount),0) AS total FROM billing_payments WHERE applied_at IS NOT NULL'),scalar('SELECT COALESCE(SUM(refunded_amount),0) AS total FROM billing_payments'),
   scalar("SELECT COALESCE(SUM(amount),0) AS total FROM billing_usage WHERE feature='ai'"),scalar("SELECT COALESCE(SUM(amount),0) AS total FROM billing_usage WHERE feature='ai' AND day >= $1",[month]),scalar('SELECT COUNT(*) AS total FROM billing_consultations'),scalar("SELECT COUNT(*) AS total FROM billing_events WHERE kind='subscription_paid'")]);
  const features=await store.query('SELECT feature,SUM(amount) AS total FROM billing_usage GROUP BY feature');
  const activityByDay=await store.query('SELECT day,COUNT(DISTINCT user_id) AS users FROM billing_activity WHERE day >= $1 GROUP BY day ORDER BY day DESC',[new Date(Date.parse(store.now())-30*86400000).toISOString().slice(0,10)]);
  const activityByMonth=await store.query('SELECT SUBSTR(day,1,7) AS month,COUNT(DISTINCT user_id) AS users FROM billing_activity WHERE day >= $1 GROUP BY SUBSTR(day,1,7) ORDER BY month DESC',[new Date(Date.parse(store.now())-366*86400000).toISOString().slice(0,10)]);
  res.json({totalUsers,dau,mau,activePaidSubscriptions:paid,successfulPayments:paidCount,cancelledSubscriptions:cancelled,pendingPayments:pending,grossRevenue:revenue,refunded:refunds,netCollected:revenue-refunds,currency:'GEL',aiCreditsUsed:ai,aiCreditsThisMonth:aiMonth,consultationOrders:consultations,paidActivations:upgrades,features,activityByDay,activityByMonth,timezone:'UTC',asOf:store.now(),paymentsEnabled:service.paymentsEnabled});
 }));
 r.get('/admin/users',wrap(async(req,res)=>{const limit=Math.min(100,Math.max(1,parseInt(req.query.limit)||25)),offset=Math.max(0,parseInt(req.query.offset)||0),search=String(req.query.q||'').slice(0,100);res.json(await accountStore.listUsers({limit,offset,search}));}));
 r.get('/admin/users/:id/billing',wrap(async(req,res)=>{const user=await accountStore.findById(req.params.id);if(!user)throw fail(404,'NOT_FOUND','ანგარიში ვერ მოიძებნა.');res.json({user:{id:user.id,name:user.name,email:user.email,role:user.role,status:user.accountStatus},...await service.snapshot(user,{trackActivity:false})});}));
 r.post('/admin/users/:id/consultations',wrap(async(req,res)=>{const user=await accountStore.findById(req.params.id);if(!user)throw fail(404,'NOT_FOUND','ანგარიში ვერ მოიძებნა.');if(user.accountStatus!=='active')throw fail(409,'ACCOUNT_SUSPENDED','ანგარიში შეჩერებულია.');res.status(201).json(await service.consultation(user,req.body,{actorId:req.account.id}));}));
 r.post('/admin/users/:id/status',wrap(async(req,res)=>{if(!['active','suspended'].includes(req.body.status))throw fail(400,'INVALID_STATUS','სტატუსი არასწორია.');await store.ready();const user=await accountStore.findById(req.params.id);if(!user)throw fail(404,'NOT_FOUND','ანგარიში ვერ მოიძებნა.');if(user.id===req.account.id||adminPolicy(user))throw fail(403,'PROTECTED_ACCOUNT','ადმინისტრატორის ანგარიშის შეჩერება აქ დაუშვებელია.');await accountStore.setAccountStatus(user.id,req.body.status);if(req.body.status==='suspended')await accountStore.deleteUserSessions(user.id);await store.transaction(async q=>{if(req.body.status==='suspended')await q("UPDATE billing_members SET auto_renew=0,cancel_at_end=1,updated_at=$1 WHERE user_id=$2",[store.now(),user.id]);await store.event(q,user.id,'account_status_changed',{status:req.body.status,actor:req.account.id});});res.json({id:user.id,status:req.body.status});}));
 r.get('/admin/plans',wrap(async(req,res)=>{await store.ready();res.json({items:await store.plans()});}));
 r.put('/admin/plans/:id',wrap(async(req,res)=>res.json(await service.savePlan(req.params.id,req.body.plan,req.body.revision,req.account.id))));
 for(const [kind,sql]of Object.entries({payments:'SELECT id,user_id,plan_id,period,amount,currency,status,refunded_amount,created_at FROM billing_payments',consultations:'SELECT id,user_id,topic,preferred_at,status,created_at FROM billing_consultations',events:'SELECT id,user_id,kind,detail,created_at FROM billing_events',refunds:'SELECT id,payment_id,amount,status,reason,created_at FROM billing_refunds'}))r.get('/admin/'+kind,wrap(async(req,res)=>{await store.ready();const offset=Math.max(0,parseInt(req.query.offset)||0);res.json({items:await store.query(sql+' ORDER BY created_at DESC LIMIT 50 OFFSET $1',[offset]),offset});}));
 r.post('/admin/payments/:id/check',wrap(async(req,res)=>res.json(await service.reconcile(req.params.id))));
 r.post('/admin/payments/:id/refund',wrap(async(req,res)=>res.json(await service.refund(req.account.id,req.params.id,req.body))));
 r.post('/admin/refunds/:id/retry',wrap(async(req,res)=>{await store.ready();const row=(await store.query('SELECT * FROM billing_refunds WHERE id=$1',[req.params.id]))[0];if(!row)throw fail(404,'NOT_FOUND','მოთხოვნა ვერ მოიძებნა.');res.json(await service.refund(req.account.id,row.payment_id,{amount:Number(row.amount),reason:row.reason,requestKey:row.id}));}));
 r.post('/admin/consultations/:id/status',wrap(async(req,res)=>{if(!['requested','confirmed','completed','cancelled'].includes(req.body.status))throw fail(400,'INVALID_STATUS','სტატუსი არასწორია.');await store.transaction(async q=>{const item=(await q('SELECT id FROM billing_consultations WHERE id=$1',[req.params.id]))[0];if(!item)throw fail(404,'NOT_FOUND','მოთხოვნა ვერ მოიძებნა.');await q('UPDATE billing_consultations SET status=$1,updated_at=$2 WHERE id=$3',[req.body.status,store.now(),req.params.id]);await store.event(q,req.account.id,'consultation_status_changed',{id:req.params.id,status:req.body.status});});res.json({updated:true});}));
 r.use(billingError);return r;
}
function createBillingPublicRouter({store,service,provider,accountStore,environment=process.env}){
 const r=express.Router();r.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
 r.get('/plans',wrap(async(req,res)=>{await store.ready();res.json({items:(await store.plans()).filter(p=>p.active),paymentsEnabled:provider.configured,recurringEnabled:provider.recurringEnabled});}));
 r.post('/webhook/bog',express.raw({type:'application/json',limit:'64kb'}),wrap(async(req,res)=>{
  if(!provider.verify(req.body,req.get('Callback-Signature')))throw fail(401,'INVALID_SIGNATURE','Invalid callback signature.');
  let event;try{event=JSON.parse(req.body.toString('utf8'));}catch{throw fail(400,'INVALID_CALLBACK','Invalid callback.');}
  if(event.event!=='order_payment'||typeof event.body?.external_order_id!=='string')throw fail(400,'INVALID_CALLBACK','Invalid callback.');
  await service.reconcile(event.body.external_order_id);res.json({received:true});
 }));
 r.get('/cron',wrap(async(req,res)=>{const expected=environment.CRON_SECRET&&'Bearer '+environment.CRON_SECRET,supplied=req.get('Authorization')||'';if(!expected||Buffer.byteLength(expected)!==Buffer.byteLength(supplied)||!timingSafeEqual(Buffer.from(expected),Buffer.from(supplied)))throw fail(401,'UNAUTHORIZED','Unauthorized.');res.json(await service.maintenance(accountStore));}));
 r.use(billingError);return r;
}
module.exports={createBillingRouter,createBillingPublicRouter,billingError};
