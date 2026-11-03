'use strict';
const {SCHEMA,SCHEMA_HASH}=require('../Server/billing-store');
async function migrate(environment=process.env){
 if(environment.BILLING_MIGRATION_TESTED_SHA!==SCHEMA_HASH)return {skipped:true};
 const raw=environment.DATABASE_URL_UNPOOLED||environment.DATABASE_URL||environment.POSTGRES_URL;
 if(!raw)throw Error('A direct migration connection is required.');const url=new URL(raw);if(url.hostname.endsWith('.neon.tech'))url.hostname=url.hostname.replace('-pooler','');else if(url.hostname.includes('-pooler'))throw Error('A direct migration connection is required.');
 const {Client}=require('pg'),{connectionOptions}=require('../Server/postgres-account-store'),client=new Client(connectionOptions(url.href));
 try{await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[1195721795]);await client.query(SCHEMA);for(const p of require('../Server/billing-core').DEFAULT_PLANS)await client.query('INSERT INTO billing_plans(id,payload,revision) VALUES($1,$2,1) ON CONFLICT(id) DO NOTHING',[p.id,JSON.stringify(p)]);await client.query('COMMIT');return {installed:true,schemaHash:SCHEMA_HASH};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw Error('Billing migration did not complete; transaction rolled back.');}finally{await client.end();}
}
if(require.main===module)migrate().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={migrate};
