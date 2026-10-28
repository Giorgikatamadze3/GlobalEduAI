'use strict';

const path = require('node:path');
const { createConfiguredAccountStore } = require('../Server/account-store-config');
require('dotenv').config({path:path.resolve(__dirname,'../Server/.env'),quiet:true});

async function main(args=process.argv.slice(2)) {
    if(args.length===1&&args[0]==='--help') {
        console.log('node scripts/init-auth-db.js\nInitializes the configured account store. Local: AUTH_DB_DRIVER=sqlite and AUTH_DB_PATH. Cloud: AUTH_DB_DRIVER=postgres and DATABASE_URL. Node.js 24 is required.');
        return;
    }
    if(args.length)throw Object.assign(new Error('Unknown initialization option.'),{code:'INVALID_ARGUMENT'});
    const store = createConfiguredAccountStore();
    try { if(typeof store.ready==='function')await store.ready();console.log(JSON.stringify({provider:store.info.provider,ready:true,persistent:store.info.persistent,schemaVersion:store.info.schemaVersion},null,2)); }
    finally { await store.close(); }
}

if(require.main===module)main().catch(error=>{console.error(`Account database initialization failed: ${error.code||error.name}`);process.exitCode=1;});
module.exports={main};
