'use strict';

const path = require('node:path');

function unavailableStore(provider) {
    const fail = async() => { throw Object.assign(new Error('Configure a persistent cloud account database.'),{code:'AUTH_DATABASE_UNAVAILABLE'}); };
    return {
        info:{provider,persistent:true,schemaVersion:1,configured:false},ready:fail,close:async()=>{},
        ...Object.fromEntries(['createUser','findByEmail','findById','updateUser','createSession','findSession','deleteSession','deleteUserSessions','pruneSessions'].map(name=>[name,fail]))
    };
}

function createConfiguredAccountStore(environment = process.env) {
    const cloud = environment.VERCEL === '1';
    const driver = (environment.AUTH_DB_DRIVER || (cloud?'postgres':'sqlite')).trim().toLowerCase();
    if(driver==='postgres') {
        const connectionString = environment.DATABASE_URL || environment.POSTGRES_URL;
        if(!connectionString?.trim())return unavailableStore('postgres');
        return require('./postgres-account-store').createPostgresAccountStore({connectionString:connectionString.trim()});
    }
    if(driver!=='sqlite')throw new Error('AUTH_DB_DRIVER must be sqlite or postgres.');
    // A serverless function's disk cannot provide durable shared accounts.
    if(cloud)return unavailableStore('postgres');
    const configured = (environment.AUTH_DB_PATH || 'data/accounts.sqlite').trim();
    const filename = configured === ':memory:' || path.isAbsolute(configured) ? configured : path.resolve(__dirname,configured);
    return require('./account-store').createAccountStore({filename});
}

module.exports = {createConfiguredAccountStore};
