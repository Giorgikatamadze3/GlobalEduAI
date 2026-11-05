'use strict';
// Every persistent store must select the same database. A selected Supabase
// deployment must never silently fall back to an old POSTGRES_URL integration.
const TABLES=Object.freeze(['globaledu_schema_migrations','globaledu_users','globaledu_sessions','globaledu_content','globaledu_content_audit','billing_plans','billing_members','billing_payments','billing_usage','billing_activity','billing_events','billing_consultations','billing_refunds']);
const PRIVATE_SCHEMA='globaledu_private';
function databaseConfig(environment=process.env){
    const provider=(environment.DATABASE_PROVIDER||'postgres').trim().toLowerCase();
    if(!['postgres','neon','supabase'].includes(provider))throw Object.assign(Error('Unsupported database provider.'),{code:'INVALID_DATABASE_CONFIG'});
    const connectionString=provider==='supabase'?environment.SUPABASE_DATABASE_URL:(environment.DATABASE_URL||environment.POSTGRES_URL);
    return {provider,connectionString:connectionString?.trim()||'',schema:provider==='supabase'?PRIVATE_SCHEMA:null,ca:provider==='supabase'?environment.SUPABASE_DB_CA_CERT?.replace(/\\n/g,'\n'):undefined};
}
function qualifySQL(sql,schema){
    if(!schema)return sql;if(schema!==PRIVATE_SCHEMA)throw Error('Unrecognized application schema.');
    const names=new Set(TABLES);
    // Preserve quoted strings, comments and explicitly qualified names. Only
    // known application table identifiers are routed to the private schema.
    const tokens=/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|[A-Za-z_][A-Za-z_0-9]*/g;
    return sql.replace(tokens,(token,index)=>names.has(token)&&sql.slice(0,index).trimEnd().slice(-1)!=='.'?`"${schema}"."${token}"`:token);
}
function scopeClient(client,schema){
    if(!schema)return client;
    return {query(sql,...args){if(typeof sql!=='string')throw Error('Application queries must use SQL text.');return client.query(qualifySQL(sql,schema),...args);},release:()=>client.release?.()};
}
function scopePool(pool,schema){
    if(!schema)return pool;
    return {query(sql,...args){if(typeof sql!=='string')throw Error('Application queries must use SQL text.');return pool.query(qualifySQL(sql,schema),...args);},async connect(){return scopeClient(await pool.connect(),schema);},end:()=>pool.end(),on:(...args)=>pool.on(...args)};
}
function createDatabasePool(environment=process.env){
    const config=databaseConfig(environment),{Pool}=require('pg'),{connectionOptions}=require('./postgres-account-store');
    const pool=new Pool(connectionOptions(config.connectionString,{ca:config.ca}));pool.on('error',()=>{});return scopePool(pool,config.schema);
}
function migrationConnection(environment=process.env){
    const config=databaseConfig(environment);
    if(config.provider==='supabase'){
        const url=environment.SUPABASE_DIRECT_DATABASE_URL;
        if(!url)throw Object.assign(Error('Supabase direct or session-pooler migration URL is required.'),{code:'DATABASE_NOT_CONFIGURED'});
        const parsed=new URL(url);if(parsed.port==='6543')throw Error('Use the direct connection or session pooler on port 5432 for migrations.');return {...config,connectionString:url};
    }
    const parsed=new URL(environment.CONTENT_MIGRATION_DATABASE_URL||environment.DATABASE_URL_UNPOOLED||config.connectionString);
    if(parsed.hostname.endsWith('.neon.tech'))parsed.hostname=parsed.hostname.replace('-pooler','');else if(parsed.hostname.includes('-pooler'))throw Error('A direct migration connection is required.');
    return {...config,connectionString:parsed.href};
}
function migrationMaintenance(environment=process.env){return (req,res,next)=>{
    const publicRead=['GET','HEAD','OPTIONS'].includes(req.method)&&/^\/(?:catalog(?:\/|$)|content$|institutions(?:\/|$)|programs(?:\/|$)|funding$|universities$|agencies$|advisor-agent\/status$)/.test(req.path);
    if(environment.DATA_MIGRATION_READ_ONLY==='true'&&!publicRead)return res.status(503).set('Retry-After','120').json({code:'DATA_MIGRATION_READ_ONLY',message:'მიმდინარეობს მონაცემების გადატანა. ანგარიშის ფუნქციები მალე აღდგება.'});next();
};}
module.exports={TABLES,PRIVATE_SCHEMA,databaseConfig,qualifySQL,scopeClient,scopePool,createDatabasePool,migrationConnection,migrationMaintenance};
