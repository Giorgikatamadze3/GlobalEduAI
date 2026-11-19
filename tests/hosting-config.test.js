'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {publicOrigin,trustedProxy}=require('../Server/hosting-config');

test('Render canonical URLs follow its assigned hostname, with custom domain override',()=>{
    assert.equal(publicOrigin({RENDER_EXTERNAL_URL:'https://globaleduai-example.onrender.com'}),'https://globaleduai-example.onrender.com');
    assert.equal(publicOrigin({PUBLIC_SITE_URL:'https://study.example/',RENDER_EXTERNAL_URL:'https://example.onrender.com'}),'https://study.example');
    assert.equal(publicOrigin({}),'https://globaleduai.vercel.app');
    for(const PUBLIC_SITE_URL of ['http://study.example','https://user:password@study.example','https://study.example/path','https://study.example/?token=secret'])assert.throws(()=>publicOrigin({PUBLIC_SITE_URL}));
});

test('forwarded HTTPS is trusted only on configured hosting platforms',()=>{
    assert.equal(trustedProxy({RENDER:'true'}),1);
    assert.equal(trustedProxy({VERCEL:'1'}),1);
    assert.equal(trustedProxy({NODE_ENV:'production'}),false);
});

test('Render never stores accounts on ephemeral SQLite when database configuration is missing',async()=>{
    const {createConfiguredAccountStore}=require('../Server/account-store-config');
    for(const AUTH_DB_DRIVER of [undefined,'sqlite','postgres']){
        const store=createConfiguredAccountStore({RENDER:'true',AUTH_DB_DRIVER});
        assert.equal(store.info.provider,'postgres');
        assert.equal(store.info.configured,false);
        await assert.rejects(store.ready(),{code:'AUTH_DATABASE_UNAVAILABLE'});
        await store.close();
    }
});

test('Render content and billing fail closed instead of creating local SQLite tables',async()=>{
    const environment={RENDER:'true'};
    const content=require('../Server/content-store').createContentStore({environment});
    const billing=require('../Server/billing-store').createBillingStore({environment});
    await assert.rejects(content.ready(),{code:'CONTENT_SETUP_REQUIRED'});
    await assert.rejects(billing.ready(),{code:'BILLING_SETUP_REQUIRED'});
    await content.close();await billing.close();
});
