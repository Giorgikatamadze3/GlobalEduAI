'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {DEFAULT_PLANS,fail}=require('./billing-core');
const SCHEMA=fs.readFileSync(path.join(__dirname,'billing-schema.sql'),'utf8');
const SCHEMA_HASH=createHash('sha256').update(SCHEMA).digest('hex');
function createBillingStore({environment=process.env,pool:injectedPool,sqlite,clock=()=>Date.now()}={}){
 const postgres=!!injectedPool||environment.VERCEL==='1'||environment.AUTH_DB_DRIVER==='postgres';
 let pool=injectedPool,db=sqlite,readiness,queue=Promise.resolve();
 const now=()=>new Date(clock()).toISOString();
 function database(){if(!db){const {DatabaseSync}=require('node:sqlite');const file=environment.BILLING_DB_PATH||path.join(__dirname,'data/billing.sqlite');if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000');db.exec(SCHEMA);}return db;}
 function getPool(){if(!pool){const {Pool}=require('pg'),{connectionOptions}=require('./postgres-account-store');pool=new Pool(connectionOptions(environment.DATABASE_URL||environment.POSTGRES_URL));pool.on('error',()=>{});}return pool;}
 async function query(sql,params=[],client){if(postgres)return(await(client||getPool()).query(sql,params)).rows;return database().prepare(sql.replace(/\$\d+/g,'?')).all(...params);}
 async function ready(){if(!readiness)readiness=(async()=>{if(postgres)await query('SELECT id FROM billing_plans LIMIT 1');else database();for(const p of DEFAULT_PLANS)await query('INSERT INTO billing_plans(id,payload,revision) VALUES($1,$2,1) ON CONFLICT(id) DO NOTHING',[p.id,JSON.stringify(p)]);})();try{await readiness;}catch{readiness=null;throw fail(503,'BILLING_SETUP_REQUIRED','პაკეტების სისტემა ჯერ მზადდება. გადახდა არ შესრულებულა.');}}
 async function transaction(work){
  await ready();if(postgres){const client=await getPool().connect();try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[1195721795]);const result=await work((s,p=[])=>query(s,p,client));await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
  const previous=queue;let release;queue=new Promise(r=>{release=r;});await previous;const handle=database();handle.exec('BEGIN IMMEDIATE');try{const result=await work(query);handle.exec('COMMIT');return result;}catch(e){handle.exec('ROLLBACK');throw e;}finally{release();}
 }
 async function event(q,user,kind,detail={},id=randomUUID()){await q('INSERT INTO billing_events(id,user_id,kind,detail,created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',[id,user,kind,JSON.stringify(detail),now()]);}
 async function member(q,user){
  const timestamp=now();await q('INSERT INTO billing_members(user_id,name,email,registered_at,updated_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,email=excluded.email',[user.id,user.name,user.email,user.createdAt,timestamp]);
  await q('INSERT INTO billing_activity(user_id,day) VALUES($1,$2) ON CONFLICT(user_id,day) DO NOTHING',[user.id,timestamp.slice(0,10)]);
  let row=(await q('SELECT * FROM billing_members WHERE user_id=$1',[user.id]))[0];
  if(row.plan_id!=='free'&&row.ends_at&&row.ends_at<=timestamp&&row.status!=='expired'){
   await q("UPDATE billing_members SET status='expired',updated_at=$1 WHERE user_id=$2",[timestamp,user.id]);await event(q,user.id,'subscription_expired',{planId:row.plan_id});row={...row,status:'expired'};
  }return row;
 }
 async function plans(q=query){return(await q('SELECT id,payload,revision FROM billing_plans ORDER BY id')).map(r=>({...JSON.parse(r.payload),revision:Number(r.revision)})).sort((a,b)=>a.monthlyPrice-b.monthlyPrice);}
 async function entitlement(q,user){const row=await member(q,user),all=await plans(q),paid=row.plan_id!=='free'&&['active','cancelled'].includes(row.status)&&row.ends_at>now();return {member:row,plan:all.find(p=>p.id===(paid?row.plan_id:'free')),plans:all};}
 async function usage(q,userId,feature){const month=now().slice(0,7);return Number((await q('SELECT COALESCE(SUM(amount),0) AS total FROM billing_usage WHERE user_id=$1 AND feature=$2 AND day >= $3 AND day < $4',[userId,feature,month+'-01',addMonth(month)]))[0].total);}
 function addMonth(month){const d=new Date(month+'-01T00:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);}
 async function take(q,user,feature){const e=await entitlement(q,user),limit=e.plan.features[feature];if(limit===undefined||limit===false||limit===0)throw fail(403,'UPGRADE_REQUIRED','ამ ფუნქციისთვის პაკეტის განახლებაა საჭირო.');if(typeof limit==='number'&&await usage(q,user.id,feature)>=limit)throw fail(403,'UPGRADE_REQUIRED','ამ თვის ლიმიტი ამოიწურა. განაახლე პაკეტი ან დაელოდე შემდეგ თვეს.');await q('INSERT INTO billing_usage(user_id,day,feature,amount) VALUES($1,$2,$3,1) ON CONFLICT(user_id,day,feature) DO UPDATE SET amount=billing_usage.amount+1',[user.id,now().slice(0,10),feature]);return {feature,day:now().slice(0,10),userId:user.id};}
 return {ready,query,transaction,event,member,plans,entitlement,usage,take,now,
  get schemaHash(){return SCHEMA_HASH;},
  async snapshot(user){return transaction(async q=>{const e=await entitlement(q,user),used={};for(const feature of ['ai','consultation','pdf'])used[feature]=await usage(q,user.id,feature);return {plan:e.plan,subscription:e.member,usage:used,usagePeriod:now().slice(0,7),usageTimezone:'UTC',registeredAt:user.createdAt,payments:await q('SELECT id,plan_id,period,amount,currency,status,refunded_amount,created_at FROM billing_payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[user.id]),consultations:await q('SELECT id,topic,preferred_at,status,created_at FROM billing_consultations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[user.id])};});},
  async touch(user,kind='session'){return transaction(async q=>{await member(q,user);if(kind==='login'||kind==='registration')await event(q,user.id,kind);});},
  async consume(user,feature){return transaction(async q=>{const ticket=await take(q,user,feature);await event(q,user.id,feature+'_requested');return ticket;});},
  async release(ticket){if(!ticket)return;await transaction(q=>q('UPDATE billing_usage SET amount=CASE WHEN amount>0 THEN amount-1 ELSE 0 END WHERE user_id=$1 AND day=$2 AND feature=$3',[ticket.userId,ticket.day,ticket.feature]));},
  async track(user,feature){if(!['discovery','matching','planner','favorites'].includes(feature))throw fail(400,'INVALID_EVENT','აქტივობა არასწორია.');return transaction(async q=>{await member(q,user);await q('INSERT INTO billing_usage(user_id,day,feature,amount) VALUES($1,$2,$3,1) ON CONFLICT(user_id,day,feature) DO UPDATE SET amount=billing_usage.amount+1',[user.id,now().slice(0,10),feature]);});},
  async close(){if(pool)await pool.end();if(db)db.close();}
 };
}
module.exports={createBillingStore,SCHEMA,SCHEMA_HASH};
