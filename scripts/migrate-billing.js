'use strict';
const {SCHEMA,SCHEMA_HASH}=require('../Server/billing-store');
async function migrate(environment=process.env){
 if(environment.BILLING_MIGRATION_TESTED_SHA!==SCHEMA_HASH)return {skipped:true};
 const {migrationConnection,qualifySQL}=require('../Server/database-config'),config=migrationConnection(environment);
 const {Client}=require('pg'),{connectionOptions}=require('../Server/postgres-account-store'),raw=new Client(connectionOptions(config.connectionString,{ca:config.ca}));
 const client={connect:()=>raw.connect(),end:()=>raw.end(),query:(sql,...args)=>raw.query(qualifySQL(sql,config.schema),...args)};
 try{await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[1195721795]);await client.query(SCHEMA);for(const p of require('../Server/billing-core').DEFAULT_PLANS)await client.query('INSERT INTO billing_plans(id,payload,revision) VALUES($1,$2,1) ON CONFLICT(id) DO NOTHING',[p.id,JSON.stringify(p)]);await client.query('COMMIT');return {installed:true,schemaHash:SCHEMA_HASH};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw Error('Billing migration did not complete; transaction rolled back.');}finally{await client.end();}
}
if(require.main===module)migrate().then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={migrate};
