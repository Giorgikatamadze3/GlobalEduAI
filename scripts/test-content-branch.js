'use strict';
// Run only against a user-designated disposable branch of production.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {SCHEMA}=require('../Server/content-store'),{connectionOptions}=require('../Server/postgres-account-store');
async function testBranch(environment=process.env){
    const url=environment.CONTENT_TEST_DATABASE_URL;
    if(!url)throw Error('Add the DIRECT test-branch URL as CONTENT_TEST_DATABASE_URL in Server/.env. Never use production here.');
    const host=new URL(url).hostname;if(host.includes('-pooler'))throw Error('Migration tests require a direct connection, not a pooler.');
    const production=environment.DATABASE_URL||environment.POSTGRES_URL;
    if(production&&new URL(production).hostname.replace('-pooler','')===host)throw Error('Test and production endpoints must differ.');
    const {Client}=require('pg'),client=new Client(connectionOptions(url));let begun=false;
    try{await client.connect();
        // A production clone must contain the existing application schema.
        await client.query('SELECT id FROM globaledu_users LIMIT 1');
        await client.query('BEGIN');begun=true;await client.query(SCHEMA);await client.query(SCHEMA);
        const id='faq_branch-'+randomUUID();
        await client.query('INSERT INTO globaledu_content (entity_type,entity_id,payload,revision,deleted,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',['faq',id,JSON.stringify({id}),1,0,'branch-test',new Date().toISOString()]);
        await client.query('UPDATE globaledu_content SET revision=2,deleted=1 WHERE entity_id=$1',[id]);
        const result=await client.query('SELECT revision,deleted FROM globaledu_content WHERE entity_id=$1',[id]);if(Number(result.rows[0]?.revision)!==2||!result.rows[0]?.deleted)throw Error('Branch CRUD check failed.');
        await client.query('INSERT INTO globaledu_content_audit (id,entity_type,entity_id,revision,action,actor_id,changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),'faq',id,2,'delete','branch-test',new Date().toISOString()]);
        await client.query('ROLLBACK');begun=false;
        return {passed:true,schemaHash:createHash('sha256').update(SCHEMA).digest('hex'),testedAt:new Date().toISOString(),method:'production-clone branch; additive DDL twice, CRUD and audit, transaction rolled back'};
    }finally{if(begun)await client.query('ROLLBACK').catch(()=>{});await client.end();}
}
if(require.main===module){require('dotenv').config({path:path.join(__dirname,'../Server/.env'),quiet:true});testBranch().then(result=>{fs.writeFileSync(path.join(__dirname,'../.qa-content-branch-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));}).catch(()=>{console.error('Branch test did not complete. Check the direct CONTENT_TEST_DATABASE_URL and branch connectivity. No production migration was run.');process.exitCode=1;});}
module.exports={testBranch};
