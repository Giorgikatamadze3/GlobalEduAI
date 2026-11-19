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
