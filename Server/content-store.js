'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const SCHEMA=fs.readFileSync(path.join(__dirname,'content-schema.sql'),'utf8');
const SCHEMA_HASH=createHash('sha256').update(SCHEMA).digest('hex');
const error=(code,message)=>Object.assign(new Error(message),{code});
function createContentStore({environment=process.env,pool:injectedPool,sqlite:injectedSqlite}={}){
    const postgres=!!injectedPool||environment.VERCEL==='1'||environment.AUTH_DB_DRIVER==='postgres';
    let db=injectedSqlite,pool=injectedPool,readiness,writeQueue=Promise.resolve();
    const unpack=row=>({...row,record:JSON.parse(row.payload),revision:Number(row.revision),deleted:!!row.deleted});
    function database(){if(!db){const {DatabaseSync}=require('node:sqlite');const file=environment.CMS_DB_PATH||path.join(__dirname,'data/content.sqlite');if(file!==':memory:')fs.mkdirSync(path.dirname(file),{recursive:true});db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=5000;');db.exec(SCHEMA);}return db;}
    function getPool(){if(!pool){const {Pool}=require('pg'),{connectionOptions}=require('./postgres-account-store');pool=new Pool(connectionOptions(environment.DATABASE_URL||environment.POSTGRES_URL));pool.on('error',()=>{});}return pool;}
    async function query(sql,params=[],client){if(postgres)return (await(client||getPool()).query(sql,params)).rows;return database().prepare(sql.replace(/\$\d+/g,'?')).all(...params);}
    async function ready(){if(!readiness)readiness=(async()=>{if(postgres)await query('SELECT entity_id FROM globaledu_content LIMIT 1');else database();})();try{await readiness;}catch{readiness=null;throw error('CONTENT_SETUP_REQUIRED','Content storage is not initialized.');}}
    async function transaction(work){
        if(postgres){const client=await getPool().connect();try{await client.query('BEGIN');await client.query('LOCK TABLE globaledu_content IN SHARE ROW EXCLUSIVE MODE');const value=await work(client);await client.query('COMMIT');return value;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
        const previous=writeQueue;let release;writeQueue=new Promise(resolve=>{release=resolve;});await previous;
        const handle=database();try{handle.exec('BEGIN IMMEDIATE');try{const result=await work();handle.exec('COMMIT');return result;}catch(e){handle.exec('ROLLBACK');throw e;}}finally{release();}
    }
    return {
        ready,
        get canInstall(){return environment.CONTENT_MIGRATION_TESTED_SHA===SCHEMA_HASH;},
        async install(){
            if(environment.CONTENT_MIGRATION_TESTED_SHA!==SCHEMA_HASH)throw error('CONTENT_SETUP_REQUIRED','A successful production-clone branch test is required first.');
            if(!postgres){database();return {schemaHash:SCHEMA_HASH};}
            const source=environment.CONTENT_MIGRATION_DATABASE_URL||environment.DATABASE_URL||environment.POSTGRES_URL;
            const url=new URL(source);
            // Neon direct and pooled endpoints share credentials. Keep credentials
            // in the server process and use a direct endpoint for this migration.
            if(url.hostname.endsWith('.neon.tech'))url.hostname=url.hostname.replace('-pooler','');
            else if(url.hostname.includes('-pooler'))throw error('CONTENT_SETUP_REQUIRED','A direct migration endpoint is required.');
            const {Client}=require('pg'),{connectionOptions}=require('./postgres-account-store'),client=new Client(connectionOptions(url.href));
            try{await client.connect();await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock($1)',[1195721794]);await client.query(SCHEMA);await client.query('COMMIT');readiness=null;return {schemaHash:SCHEMA_HASH};}catch(e){await client.query('ROLLBACK').catch(()=>{});throw error('CONTENT_SETUP_REQUIRED','Content migration did not complete.');}finally{await client.end();}
        },
        async all(){await ready();if(!postgres)await writeQueue;return (await query('SELECT * FROM globaledu_content ORDER BY entity_type, entity_id')).map(unpack);},
        async audit(){await ready();if(!postgres)await writeQueue;return query('SELECT * FROM globaledu_content_audit ORDER BY changed_at DESC LIMIT 50');},
        async put(type,id,record,{expectedRevision,actorId,deleted=false,validate}={}){
            await ready();const payload=JSON.stringify(record);if(Buffer.byteLength(payload)>16384)throw error('CONTENT_TOO_LARGE','Record exceeds 16KB.');
            return transaction(async client=>{
                const current=(await query('SELECT * FROM globaledu_content WHERE entity_type=$1 AND entity_id=$2',[type,id],client))[0];
                if(!Number.isInteger(expectedRevision)||expectedRevision!==(current?Number(current.revision):0))throw error('CONTENT_CONFLICT','This record changed. Reload it before saving.');
                const rows=await query('SELECT * FROM globaledu_content',[],client);if(rows.reduce((n,r)=>n+Buffer.byteLength(r.payload),0)-(current?Buffer.byteLength(current.payload):0)+Buffer.byteLength(payload)>3000000)throw error('CONTENT_TOO_LARGE','Public changes exceed the serverless response budget.');
                if(validate)await validate(rows.map(unpack));
                const revision=(current?Number(current.revision):0)+1,stamp=new Date().toISOString();
                await query('INSERT INTO globaledu_content (entity_type,entity_id,payload,revision,deleted,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (entity_type,entity_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,deleted=excluded.deleted,updated_by=excluded.updated_by,updated_at=excluded.updated_at',[type,id,payload,revision,deleted?1:0,actorId,stamp],client);
                await query('INSERT INTO globaledu_content_audit (id,entity_type,entity_id,revision,action,actor_id,changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),type,id,revision,deleted?'delete':'save',actorId,stamp],client);
                return {revision,updatedAt:stamp};
            });
        },
        async close(){if(db)db.close();if(pool)await pool.end();}
    };
}
module.exports={createContentStore,SCHEMA,SCHEMA_HASH};
