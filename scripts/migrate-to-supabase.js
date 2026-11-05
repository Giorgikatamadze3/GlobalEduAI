'use strict';
const path=require('node:path');
const {migrateSupabase}=require('../Server/supabase-migration');
async function main(args=process.argv.slice(2),environment=process.env){
    if(args.length===1&&args[0]==='--build'){
        const mode=environment.SUPABASE_MIGRATION_ACTION;if(!mode)return {skipped:true};
        if(!['check','copy','verify','rehearse'].includes(mode))throw Object.assign(Error('Invalid build migration mode.'),{code:'INVALID_MIGRATION_MODE'});
        return migrateSupabase(environment,mode);
    }
    if(args.length>1||args.length===1&&!['--check','--copy','--verify','--rehearse'].includes(args[0]))throw Object.assign(Error('Use --check, --copy, --verify or --rehearse.'),{code:'INVALID_ARGUMENT'});
    return migrateSupabase(environment,args[0]?.slice(2)||'check');
}
if(require.main===module){if(!process.argv.includes('--build'))require('dotenv').config({path:path.join(__dirname,'../Server/.env'),quiet:true});main().then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error('Supabase migration did not complete:',/^[A-Z_]{3,70}$/.test(e.code||'')?e.code:'DATABASE_OPERATION_FAILED');console.error('No database URL, credentials or account rows were logged. Runtime provider was not changed.');process.exitCode=1;});}
module.exports={main};
