'use strict';
const {randomUUID}=require('node:crypto');
const {fail,addPeriod,validatePlan}=require('./billing-core');
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const cents=value=>{if(!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(String(value)))return NaN;return Math.round(Number(value)*100);};
function createBillingService({store,provider,origin}){
 if(!origin||new URL(origin).origin!==origin)throw Error('BILLING_PUBLIC_ORIGIN must be an origin without a path.');
 async function checkout(user,input,{renewal=false,parent=null}={}){
  if(!provider.configured)throw fail(503,'PAYMENTS_NOT_CONFIGURED','ონლაინ გადახდა ჯერ არ არის ჩართული. თანხა არ ჩამოგეჭრება.');
  const {planId,period,idempotencyKey}=input||{};
  if(!uuid(idempotencyKey)||!['monthly','yearly'].includes(period))throw fail(400,'INVALID_CHECKOUT','შეამოწმე პაკეტი, პერიოდი და მოთხოვნის კოდი.');
  if(input.autoRenew!==undefined&&typeof input.autoRenew!=='boolean')throw fail(400,'INVALID_CONSENT','განახლების თანხმობა არასწორია.');
  if(input.autoRenew&&!provider.recurringEnabled)throw fail(400,'RECURRING_DISABLED','ავტომატური ჩამოჭრა ჯერ არ არის ჩართული.');
  const payment=await store.transaction(async q=>{
   const e=await store.entitlement(q,user),plan=e.plans.find(p=>p.id===planId&&p.active&&p.id!=='free');if(!plan)throw fail(400,'INVALID_PLAN','აირჩიე ხელმისაწვდომი ფასიანი პაკეტი.');
   if(renewal&&(!e.member.auto_renew||e.member.cancel_at_end||e.member.parent_order_id!==parent))throw fail(409,'CHECKOUT_CLOSED','გამოწერის ავტომატური განახლება გაუქმებულია.');
   const existing=(await q('SELECT * FROM billing_payments WHERE user_id=$1 AND idempotency_key=$2',[user.id,idempotencyKey]))[0];
   if(existing){if(existing.plan_id!==planId||existing.period!==period||!!existing.consent!==!!input.autoRenew)throw fail(409,'CHECKOUT_CONFLICT','ამ მოთხოვნის კოდით სხვა შეკვეთაა შექმნილი.');return existing;}
   if((await q("SELECT id FROM billing_payments WHERE user_id=$1 AND status='pending' AND created_at>$2",[user.id,new Date(Date.parse(store.now())-86400000).toISOString()])).length)throw fail(409,'CHECKOUT_PENDING','არსებული გადახდა ჯერ დამუშავების მოლოდინშია. შეამოწმე მისი სტატუსი ისტორიაში.');
   const p={id:randomUUID(),user_id:user.id,plan_id:planId,period,amount:period==='yearly'?plan.yearlyPrice:plan.monthlyPrice,consent:input.autoRenew?1:0};
   await q('INSERT INTO billing_payments(id,user_id,plan_id,period,amount,idempotency_key,consent,renewal,base_ends_at,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[p.id,user.id,planId,period,p.amount,idempotencyKey,p.consent,renewal?1:0,e.member.ends_at,store.now(),store.now()]);
   await store.event(q,user.id,'checkout_started',{paymentId:p.id,planId,period,amount:p.amount});return {...p,status:'pending'};
  });
  if(payment.provider_order_id)return {paymentId:payment.id,status:payment.status,redirectUrl:payment.redirect_url};
  if(payment.status!=='pending')throw fail(409,'CHECKOUT_CLOSED','ეს შეკვეთა დასრულებულია. ახალი მოთხოვნა შექმენი.');
  // The same payment UUID is also the bank's idempotency key. Network ambiguity
  // leaves a pending order for retry/reconciliation, never a fabricated failure.
  const result=renewal?await provider.renew(parent,payment,origin):await provider.create(payment,origin);
  await store.transaction(q=>q('UPDATE billing_payments SET provider_order_id=$1,redirect_url=$2,updated_at=$3 WHERE id=$4 AND provider_order_id IS NULL',[result.id,result.redirectUrl||null,store.now(),payment.id]));
  return {paymentId:payment.id,status:'pending',redirectUrl:result.redirectUrl||null};
 }
 async function reconcile(paymentId,userId){
  await store.ready();const p=(await store.query('SELECT * FROM billing_payments WHERE id=$1',[paymentId]))[0];if(!p||userId&&p.user_id!==userId)throw fail(404,'PAYMENT_NOT_FOUND','გადახდა ვერ მოიძებნა.');
  if(!p.provider_order_id)throw fail(409,'PAYMENT_PENDING','ბანკის შეკვეთის შექმნა ჯერ არ დადასტურებულა. იგივე მოთხოვნით სცადე ხელახლა.');
  const d=await provider.details(p.provider_order_id),units=d.purchase_units||{},status=d.order_status?.key;
  if(d.order_id!==p.provider_order_id||d.external_order_id!==p.id||units.currency_code!=='GEL'||cents(units.request_amount)!==Number(p.amount))throw fail(409,'PAYMENT_MISMATCH','გადახდის მონაცემები არ ემთხვევა შეკვეთას.');
  if(['completed','refunded','refunded_partially','refund_requested'].includes(status)&&cents(units.transfer_amount)!==Number(p.amount))throw fail(409,'PAYMENT_MISMATCH','ბანკის დამუშავებული თანხა არ ემთხვევა შეკვეთას.');
  return store.transaction(async q=>{
   const current=(await q('SELECT * FROM billing_payments WHERE id=$1',[p.id]))[0];
   if(['completed','refunded_partially','refund_requested'].includes(status)&&!current.applied_at){
    // A stale completion cannot resurrect a refunded payment.
    if(current.status==='refunded'||Number(current.refunded_amount)>0)return {paymentId:p.id,status:current.status};
    const member=(await q('SELECT * FROM billing_members WHERE user_id=$1',[p.user_id]))[0];
    const previous=member.last_payment_id?(await q('SELECT created_at FROM billing_payments WHERE id=$1',[member.last_payment_id]))[0]:null;
    const start=member.plan_id===p.plan_id&&member.ends_at>store.now()?member.ends_at:store.now(),end=addPeriod(start,p.period);
    const cancelled=Number(p.renewal)&&Number(member.cancel_at_end),renew=Number(p.renewal)?Number(member.auto_renew)&&!cancelled:Number(p.consent),parent=renew?(Number(p.renewal)?member.parent_order_id:p.provider_order_id):null;
    if(!previous||previous.created_at<=p.created_at)await q('UPDATE billing_members SET plan_id=$1,status=$2,period=$3,starts_at=$4,ends_at=$5,cancel_at_end=$6,auto_renew=$7,parent_order_id=$8,last_payment_id=$9,updated_at=$10 WHERE user_id=$11',[p.plan_id,cancelled?'cancelled':'active',p.period,store.now(),end,cancelled?1:0,renew?1:0,parent,p.id,store.now(),p.user_id]);
    else await store.event(q,p.user_id,'late_payment_review_required',{paymentId:p.id,currentPaymentId:member.last_payment_id});
    await q("UPDATE billing_payments SET status='completed',applied_at=$1,updated_at=$2 WHERE id=$3",[store.now(),store.now(),p.id]);
    await store.event(q,p.user_id,p.renewal?'subscription_renewed':'subscription_paid',{paymentId:p.id,planId:p.plan_id,previousPlanId:member.plan_id,amount:p.amount},'paid:'+p.id);
   }
   if(['refunded','refunded_partially'].includes(status)){
    const refunded=cents(units.refund_amount);if(!Number.isSafeInteger(refunded)||refunded<Number(current.refunded_amount)||refunded>Number(p.amount)||(status==='refunded'&&refunded!==Number(p.amount)))throw fail(409,'REFUND_MISMATCH','დაბრუნებული თანხა არასწორია.');
    await q('UPDATE billing_payments SET status=$1,refunded_amount=$2,applied_at=COALESCE(applied_at,$3),updated_at=$4 WHERE id=$5',[status,refunded,store.now(),store.now(),p.id]);
    if(status==='refunded'){
     const member=(await q('SELECT last_payment_id FROM billing_members WHERE user_id=$1',[p.user_id]))[0];
     if(member?.last_payment_id===p.id)await q("UPDATE billing_members SET status='expired',ends_at=$1,auto_renew=0,cancel_at_end=1,updated_at=$2 WHERE user_id=$3",[store.now(),store.now(),p.user_id]);
    }
    await store.event(q,p.user_id,'refund_confirmed',{paymentId:p.id,amount:refunded},'refund:'+p.id+':'+refunded);
   }else if(status==='rejected'&&!current.applied_at){await q("UPDATE billing_payments SET status='failed',updated_at=$1 WHERE id=$2",[store.now(),p.id]);await store.event(q,p.user_id,'payment_failed',{paymentId:p.id},'failed:'+p.id);}
   else if(status==='refund_requested'&&current.applied_at)await q("UPDATE billing_payments SET status='refund_pending',updated_at=$1 WHERE id=$2",[store.now(),p.id]);
   for(const action of Array.isArray(d.actions)?d.actions:[]){if(!['refund','partial_refund'].includes(action.action)||!['completed','rejected'].includes(action.status))continue;await q("UPDATE billing_refunds SET status=$1,updated_at=$2 WHERE payment_id=$3 AND provider_action_id=$4 AND status='pending'",[action.status==='completed'?'confirmed':'failed',store.now(),p.id,action.action_id]);}
   if(status==='completed'&&current.status==='refund_pending'&&!(await q("SELECT id FROM billing_refunds WHERE payment_id=$1 AND status='pending'",[p.id])).length)await q('UPDATE billing_payments SET status=$1 WHERE id=$2',[Number(current.refunded_amount)>0?'refunded_partially':'completed',p.id]);
   await q('UPDATE billing_payments SET updated_at=$1 WHERE id=$2',[store.now(),p.id]);
   const result=(await q('SELECT status FROM billing_payments WHERE id=$1',[p.id]))[0];return {paymentId:p.id,status:result.status};
  });
 }
 return {checkout,reconcile,
  get paymentsEnabled(){return provider.configured;},
  async resume(user,id){await store.ready();const p=(await store.query('SELECT * FROM billing_payments WHERE id=$1 AND user_id=$2',[id,user.id]))[0];if(!p||p.status!=='pending'||p.renewal)throw fail(409,'CHECKOUT_CLOSED','გადახდის გაგრძელება მიუწვდომელია.');return checkout(user,{planId:p.plan_id,period:p.period,idempotencyKey:p.idempotency_key,autoRenew:!!p.consent});},
  async snapshot(user){return {...await store.snapshot(user),paymentsEnabled:provider.configured,recurringEnabled:provider.recurringEnabled};},
  async cancel(user){return store.transaction(async q=>{const e=await store.entitlement(q,user);if(e.member.plan_id==='free'||e.member.cancel_at_end)return {cancelled:true};await q("UPDATE billing_members SET status='cancelled',cancel_at_end=1,auto_renew=0,updated_at=$1 WHERE user_id=$2",[store.now(),user.id]);await store.event(q,user.id,'subscription_cancelled',{planId:e.member.plan_id,endsAt:e.member.ends_at});return {cancelled:true,endsAt:e.member.ends_at};});},
  async savePlan(id,input,revision,actor){const plan=validatePlan(input,id);return store.transaction(async q=>{const current=(await store.plans(q)).find(p=>p.id===id);if(!Number.isInteger(revision)||revision!==current.revision)throw fail(409,'PLAN_CONFLICT','პაკეტი შეიცვალა. განაახლე გვერდი.');await q('UPDATE billing_plans SET payload=$1,revision=revision+1 WHERE id=$2',[JSON.stringify(plan),id]);await store.event(q,actor,'plan_changed',{planId:id,revision:revision+1});return {...plan,revision:revision+1};});},
  async consultation(user,input){
   if(!uuid(input?.requestKey)||typeof input.topic!=='string'||input.topic.trim().length<5||input.topic.length>1000)throw fail(400,'INVALID_CONSULTATION','თემა უნდა შეიცავდეს 5–1000 სიმბოლოს.');
   let date=null;if(input.preferredAt){date=new Date(input.preferredAt);if(!Number.isFinite(+date)||+date<=Date.parse(store.now())||+date>Date.parse(store.now())+366*86400000)throw fail(400,'INVALID_DATE','აირჩიე მომავალი თარიღი ერთი წლის ფარგლებში.');date=date.toISOString();}
   return store.transaction(async q=>{await store.member(q,user);const existing=(await q('SELECT * FROM billing_consultations WHERE user_id=$1 AND request_key=$2',[user.id,input.requestKey]))[0];if(existing)return existing;await store.take(q,user,'consultation');const id=randomUUID();await q('INSERT INTO billing_consultations(id,user_id,topic,preferred_at,created_at,updated_at,request_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,user.id,input.topic.trim(),date,store.now(),store.now(),input.requestKey]);await store.event(q,user.id,'consultation_requested',{consultationId:id});return {id,status:'requested'};});
  },
  async refund(actor,paymentId,{amount,reason,requestKey}){
   if(!uuid(requestKey)||!Number.isSafeInteger(amount)||amount<=0||typeof reason!=='string'||reason.trim().length<5||reason.length>500)throw fail(400,'INVALID_REFUND','შეამოწმე თანხა თეთრებში, მიზეზი და მოთხოვნის კოდი.');
   const refund=await store.transaction(async q=>{const existing=(await q('SELECT * FROM billing_refunds WHERE id=$1',[requestKey]))[0];if(existing){if(existing.payment_id!==paymentId||Number(existing.amount)!==amount)throw fail(409,'REFUND_CONFLICT','მოთხოვნის კოდი უკვე გამოყენებულია.');return existing;}const p=(await q('SELECT * FROM billing_payments WHERE id=$1',[paymentId]))[0];if(!p||!p.applied_at||!p.provider_order_id||amount>Number(p.amount)-Number(p.refunded_amount)||['refunded','failed'].includes(p.status))throw fail(400,'INVALID_REFUND','გადახდა დაბრუნებისთვის მიუწვდომელია.');if((await q("SELECT id FROM billing_refunds WHERE payment_id=$1 AND status='pending'",[paymentId])).length)throw fail(409,'REFUND_PENDING','თანხის დაბრუნება უკვე მუშავდება.');await q('INSERT INTO billing_refunds(id,payment_id,amount,reason,actor_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[requestKey,paymentId,amount,reason.trim(),actor,store.now(),store.now()]);await q("UPDATE billing_payments SET status='refund_pending',updated_at=$1 WHERE id=$2",[store.now(),paymentId]);await store.event(q,p.user_id,'refund_requested',{paymentId,amount,actor});return {id:requestKey,payment_id:paymentId,amount,status:'pending'};});
   if(refund.status!=='pending')return {id:refund.id,status:refund.status};
   const p=(await store.query('SELECT provider_order_id FROM billing_payments WHERE id=$1',[paymentId]))[0];const result=await provider.refund(p.provider_order_id,amount,requestKey);await store.transaction(q=>q('UPDATE billing_refunds SET provider_action_id=$1,updated_at=$2 WHERE id=$3',[result.action_id||null,store.now(),refund.id]));return {id:refund.id,status:'pending'};
  },
  async renewDue(accountStore){
   await store.ready();const due=await store.query("SELECT user_id,plan_id,period,parent_order_id,ends_at FROM billing_members WHERE auto_renew=1 AND cancel_at_end=0 AND ends_at<=$1 ORDER BY ends_at LIMIT 25",[store.now()]);let processed=0;
   for(const m of due){if(!provider.recurringEnabled)break;const user=await accountStore.findById(m.user_id);if(!user||user.accountStatus!=='active')continue;const plan=(await store.plans()).find(p=>p.id===m.plan_id);const old=(await store.query('SELECT amount,period FROM billing_payments WHERE provider_order_id=$1',[m.parent_order_id]))[0];if(!plan?.active||!old||Number(old.amount)!==(m.period==='yearly'?plan.yearlyPrice:plan.monthlyPrice)||old.period!==m.period)continue;
    // Stable period key prevents duplicate automatic charges on cron retries.
    const {createHash}=require('node:crypto'),hex=createHash('sha256').update(m.user_id+':'+m.ends_at).digest('hex');const key=hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+'-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
    try{await checkout(user,{planId:m.plan_id,period:m.period,idempotencyKey:key,autoRenew:true},{renewal:true,parent:m.parent_order_id});processed++;}catch(e){if(!['CHECKOUT_PENDING','CHECKOUT_CLOSED'].includes(e.code))await store.transaction(q=>store.event(q,user.id,'renewal_error',{code:e.code||'PROVIDER_ERROR'}));}
   }return {processed};
  },
  async maintenance(accountStore){
   await store.ready();let reconciled=0;
   if(provider.configured){const pending=await store.query("SELECT id FROM billing_payments WHERE provider_order_id IS NOT NULL AND status IN ('pending','refund_pending') ORDER BY updated_at LIMIT 25");for(const p of pending)try{await reconcile(p.id);reconciled++;}catch{/* Keep ambiguous bank results pending for a later retry. */}}
   await store.transaction(q=>q("UPDATE billing_members SET status='expired',updated_at=$1 WHERE plan_id<>'free' AND ends_at<=$2 AND status IN ('active','cancelled')",[store.now(),store.now()]));
   return {reconciled,...await this.renewDue(accountStore)};
  }
 };
}
module.exports={createBillingService,cents};
