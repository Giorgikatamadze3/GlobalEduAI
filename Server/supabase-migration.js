'use strict';
const {createHash}=require('node:crypto');
const {TABLES,PRIVATE_SCHEMA,qualifySQL,scopeClient}=require('./database-config');
const {applyAccountSchema,connectionOptions}=require('./postgres-account-store');
const KEYS={globaledu_schema_migrations:['version'],globaledu_users:['id'],globaledu_sessions:['id_hash'],globaledu_content:['entity_type','entity_id'],globaledu_content_audit:['id'],billing_plans:['id'],billing_members:['user_id'],billing_payments:['id'],billing_usage:['user_id','day','feature'],billing_activity:['user_id','day'],billing_events:['id'],billing_consultations:['id'],billing_refunds:['id']};
const failure=code=>Object.assign(new Error(code),{code});
const identifier=s=>{if(!/^[a-z_][a-z_0-9]*$/.test(s))throw failure('INVALID_IDENTIFIER');return '"'+s+'"';};
function migrationOptions(environment){
    const source=environment.SUPABASE_SOURCE_DATABASE_URL||environment.DATABASE_URL||environment.POSTGRES_URL;
    const target=environment.SUPABASE_DIRECT_DATABASE_URL;
    if(!source||!target)throw failure('MIGRATION_CONNECTIONS_REQUIRED');
    let a,b;try{a=new URL(source);b=new URL(target);}catch{throw failure('INVALID_DATABASE_CONFIG');}
    if(!['postgres:','postgresql:'].includes(a.protocol)||!['postgres:','postgresql:'].includes(b.protocol))throw failure('INVALID_DATABASE_CONFIG');
    const supabase=host=>host.endsWith('.supabase.co')||host.endsWith('.pooler.supabase.com');
    if(!supabase(b.hostname)||b.port==='6543')throw failure('SUPABASE_SESSION_CONNECTION_REQUIRED');
    if(supabase(a.hostname)||a.hostname===b.hostname)throw failure('SOURCE_AND_TARGET_MUST_DIFFER');
    return {source,target,ca:environment.SUPABASE_DB_CA_CERT?.replace(/\\n/g,'\n')};
}
function canonical(value){if(value instanceof Date)return JSON.stringify(value.toISOString());if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
async function columns(client,schema,table){return (await client.query('SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position',[schema,table])).rows;}
async function count(client,schema,table){return Number((await client.query(`SELECT COUNT(*) AS total FROM ${identifier(schema)}.${identifier(table)}`)).rows[0].total);}
async function readTable(client,schema,table,cols,onBatch){
    const hash=createHash('sha256'),limit=250;let offset=0,total=0;
    for(;;){const rows=(await client.query(`SELECT ${cols.map(c=>identifier(c.column_name)).join(',')} FROM ${identifier(schema)}.${identifier(table)} ORDER BY ${KEYS[table].map(identifier).join(',')} LIMIT $1 OFFSET $2`,[limit,offset])).rows;
        for(const row of rows){hash.update(canonical(row));hash.update('\n');}if(onBatch&&rows.length)await onBatch(rows);total+=rows.length;if(rows.length<limit)break;offset+=limit;
    }return {count:total,hash:hash.digest('hex')};
}
async function secureSchema(target){
    const roles=['anon','authenticated','service_role'];
    const found=(await target.query('SELECT rolname FROM pg_roles WHERE rolname IN ($1,$2,$3)',roles)).rows.map(r=>r.rolname);
    if(roles.some(role=>!found.includes(role)))throw failure('SUPABASE_ROLES_REQUIRED');
    await target.query(`REVOKE ALL ON SCHEMA ${PRIVATE_SCHEMA} FROM PUBLIC, anon, authenticated, service_role`);
    await target.query(`REVOKE ALL ON ALL TABLES IN SCHEMA ${PRIVATE_SCHEMA} FROM PUBLIC, anon, authenticated, service_role`);
    await target.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${PRIVATE_SCHEMA} FROM PUBLIC, anon, authenticated, service_role`);
    await target.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${PRIVATE_SCHEMA} REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role`);
    for(const table of TABLES)await target.query(`ALTER TABLE ${identifier(PRIVATE_SCHEMA)}.${identifier(table)} ENABLE ROW LEVEL SECURITY`);
}
async function checkSecurity(target){
    const rows=(await target.query('SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind=$2',[PRIVATE_SCHEMA,'r'])).rows;
    if(TABLES.some(table=>!rows.some(r=>r.relname===table&&r.relrowsecurity)))throw failure('SUPABASE_RLS_REQUIRED');
    for(const role of ['anon','authenticated','service_role']){const result=await target.query('SELECT has_schema_privilege($1,$2,$3) AS allowed',[role,PRIVATE_SCHEMA,'USAGE']);if(result.rows[0]?.allowed!==false)throw failure('SUPABASE_PRIVATE_SCHEMA_REQUIRED');}
    for(const role of ['anon','authenticated','service_role'])for(const table of TABLES){const r=await target.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,PRIVATE_SCHEMA+'.'+table,'SELECT,INSERT,UPDATE,DELETE']);if(r.rows[0]?.allowed!==false)throw failure('SUPABASE_TABLE_GRANT_UNSAFE');}
}
async function runMigration({source,target,mode='check',writesPaused=false}={}){
    if(!['check','copy','verify'].includes(mode))throw failure('INVALID_MIGRATION_MODE');
    if(mode==='copy'&&!writesPaused)throw failure('PAUSE_SOURCE_WRITES_FIRST');
    let sourceBegun=false,targetBegun=false;
    try{
        await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');sourceBegun=true;await source.query("SET LOCAL TIME ZONE 'UTC'");
        await target.query(mode==='copy'?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');targetBegun=true;await target.query("SET LOCAL TIME ZONE 'UTC'");
        if(mode==='copy'){
            await target.query('SELECT pg_advisory_xact_lock($1)',[1195721796]);
            const existing=(await target.query('SELECT table_name FROM information_schema.tables WHERE table_schema=$1 AND table_type=$2',[PRIVATE_SCHEMA,'BASE TABLE'])).rows;
            if(existing.some(row=>!TABLES.includes(row.table_name)))throw failure('TARGET_SCHEMA_NOT_DEDICATED');
        }
        const sourceColumns={},before={};
        for(const table of TABLES){sourceColumns[table]=await columns(source,'public',table);if(!sourceColumns[table].length)throw failure('SOURCE_SCHEMA_INCOMPLETE');const existing=await columns(target,PRIVATE_SCHEMA,table);before[table]=existing.length?await count(target,PRIVATE_SCHEMA,table):0;if(mode==='copy'&&before[table]&&(table!=='globaledu_schema_migrations'||before[table]!==1))throw failure('TARGET_NOT_EMPTY');}
        const version=await source.query('SELECT MAX(version) AS version FROM public.globaledu_schema_migrations');if(Number(version.rows[0].version)!==1)throw failure('UNSUPPORTED_SOURCE_SCHEMA');
        if(mode==='copy'){
            await target.query(`CREATE SCHEMA IF NOT EXISTS ${PRIVATE_SCHEMA}`);
            await applyAccountSchema(scopeClient(target,PRIVATE_SCHEMA));
            await target.query(qualifySQL(require('./content-store').SCHEMA,PRIVATE_SCHEMA));
            await target.query(qualifySQL(require('./billing-store').SCHEMA,PRIVATE_SCHEMA));
            await secureSchema(target);
            // Only the installer-owned version marker is replaced, preserving the
            // source timestamp. All user/content/billing tables must be empty.
            await target.query(`DELETE FROM ${PRIVATE_SCHEMA}.globaledu_schema_migrations`);
        }
        const tables=[];
        for(const table of TABLES){
            const cols=sourceColumns[table],dest=await columns(target,PRIVATE_SCHEMA,table);
            if(mode==='check'){tables.push({table,sourceCount:await count(source,'public',table),targetCount:before[table],targetExists:!!dest.length});continue;}
            if(cols.length!==dest.length||cols.some(c=>!dest.some(d=>d.column_name===c.column_name&&d.data_type===c.data_type)))throw failure('COLUMN_MISMATCH');
            const actual=await readTable(source,'public',table,cols,mode==='copy'?async rows=>{
                const values=[],groups=rows.map(row=>'('+cols.map(col=>{let value=row[col.column_name];if(col.data_type==='json'||col.data_type==='jsonb')value=JSON.stringify(value);values.push(value);return '$'+values.length;}).join(',')+')');
                await target.query(`INSERT INTO ${identifier(PRIVATE_SCHEMA)}.${identifier(table)} (${cols.map(c=>identifier(c.column_name)).join(',')}) VALUES ${groups.join(',')}`,values);
            }:null);
            const copied=await readTable(target,PRIVATE_SCHEMA,table,cols);if(actual.count!==copied.count||actual.hash!==copied.hash)throw failure('MIGRATION_VERIFICATION_FAILED');
            tables.push({table,count:copied.count,verified:true});
        }
        if(mode!=='check')await checkSecurity(target);
        await source.query('ROLLBACK');sourceBegun=false;await target.query(mode==='copy'?'COMMIT':'ROLLBACK');targetBegun=false;
        return {mode,verified:mode!=='check',copied:mode==='copy',schema:PRIVATE_SCHEMA,tables};
    }catch(e){if(targetBegun)await target.query('ROLLBACK').catch(()=>{});if(sourceBegun)await source.query('ROLLBACK').catch(()=>{});throw e;}
}
async function migrateSupabase(environment=process.env,mode='check'){
    const options=migrationOptions(environment),{Client,types}=require('pg');
    // Preserve timestamp microseconds rather than coercing through JavaScript Date.
    const parsers={getTypeParser:(oid,format)=>[1114,1184].includes(oid)?value=>value:types.getTypeParser(oid,format)};
    const source=new Client({...connectionOptions(options.source),types:parsers}),target=new Client({...connectionOptions(options.target,{ca:options.ca}),types:parsers});
    try{await source.connect();await target.connect();return await runMigration({source,target,mode,writesPaused:environment.DATA_MIGRATION_READ_ONLY==='true'});}finally{await source.end().catch(()=>{});await target.end().catch(()=>{});}
}
module.exports={KEYS,migrationOptions,canonical,runMigration,migrateSupabase,secureSchema,checkSecurity};
