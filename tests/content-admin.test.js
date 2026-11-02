'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createContentStore,SCHEMA}=require('../Server/content-store'),{adminAccess}=require('../Server/admin-access');
test('administrator access rejects public role claims, inactive users and newly registered bootstrap emails',()=>{
    const env={ADMIN_BOOTSTRAP:JSON.stringify({email:'owner@example.com',createdBefore:'2026-11-02T18:00:00Z'})},user={id:'existing',email:'owner@example.com',accountStatus:'active',createdAt:'2026-10-01T00:00:00Z'};
    assert.equal(adminAccess(user,env),true);assert.equal(adminAccess({...user,createdAt:'2026-11-02T19:00:00Z'},env),false);assert.equal(adminAccess({...user,email:'other@example.com',role:'admin'},env),false);assert.equal(adminAccess({...user,accountStatus:'disabled'},env),false);assert.equal(adminAccess(null,env),false);
});
test('content updates persist revisions, soft deletion and audit and reject stale concurrent edits',async()=>{
    const store=createContentStore({environment:{CMS_DB_PATH:':memory:'}});
    try{await store.put('faq','faq_a',{id:'faq_a'},{expectedRevision:0,actorId:'owner'});await assert.rejects(store.put('faq','faq_a',{id:'faq_a',answer:'stale'},{expectedRevision:0,actorId:'owner'}),e=>e.code==='CONTENT_CONFLICT');assert.equal((await store.all())[0].revision,1);await store.put('faq','faq_a',{id:'faq_a'},{expectedRevision:1,actorId:'owner',deleted:true});assert.equal((await store.all())[0].deleted,true);assert.equal((await store.audit()).length,2);}finally{await store.close();}
});
test('additive PostgreSQL schema and content writes work with a separate database fixture',async()=>{
    const {newDb}=require('pg-mem'),db=newDb();db.public.none(SCHEMA);const {Pool}=db.adapters.createPg(),pool=new Pool(),connect=pool.connect.bind(pool);pool.connect=async()=>{const c=await connect(),query=c.query.bind(c);c.query=(sql,...args)=>/^LOCK TABLE/.test(sql)?Promise.resolve({rows:[]}):query(sql,...args);return c;};
    const store=createContentStore({pool});try{await store.put('faq','faq_fixture',{id:'faq_fixture'},{expectedRevision:0,actorId:'owner'});assert.equal((await store.all()).length,1);assert.equal((await store.audit())[0].actor_id,'owner');}finally{await store.close();}
});
test('cloud content storage never creates a production schema during an HTTP read',async()=>{
    const calls=[],pool={query:async sql=>{calls.push(sql);throw Error('missing relation');},connect(){throw Error('Unexpected migration');},end:async()=>{}};const store=createContentStore({pool});await assert.rejects(store.ready(),e=>e.code==='CONTENT_SETUP_REQUIRED');assert.ok(calls.every(sql=>sql.startsWith('SELECT')));await store.close();
});

test('production schema installation is disabled until the exact branch-tested hash is configured',async()=>{
    let touched=false;const store=createContentStore({pool:{query:async()=>{touched=true;},end:async()=>{}},environment:{}});
    assert.equal(store.canInstall,false);await assert.rejects(store.install(),e=>e.code==='CONTENT_SETUP_REQUIRED');assert.equal(touched,false);await store.close();
});

test('CMS publishes validated changes, pages records and protects cross-record references',async()=>{
    const {loadCatalog}=require('../Server/catalog-service'),{createContentService}=require('../Server/content-service');
    const store=createContentStore({environment:{CMS_DB_PATH:':memory:'}}),baseCatalog=loadCatalog(),content=createContentService({baseCatalog,store});
    const options={expectedRevision:0,actorId:'owner'},localized={ka:'ტესტი',en:'Test',ru:'Тест'};
    try{
        await content.refresh(true);assert.equal(content.available,true);
        const page=await content.list('programs',{limit:10,q:'Computing'});assert.equal(page.items.length,10);assert.ok(page.total>10);
        const category={id:'faqcat_test',title:localized},question={id:'faq_test',categoryId:category.id,question:localized,answer:localized};
        await content.save('categories',category.id,category,options);await content.save('faq',question.id,question,options);
        assert.ok(content.publicChanges().faq.some(r=>r.id===question.id));assert.ok(!JSON.stringify(content.publicChanges()).includes('updated_by'));
        await assert.rejects(content.save('categories',category.id,category,{...options,expectedRevision:1,deleted:true}),e=>e.code==='INVALID_CONTENT');
        await assert.rejects(content.save('faq',question.id,question,options),e=>e.code==='CONTENT_CONFLICT');
        await content.save('faq',question.id,question,{...options,expectedRevision:1,deleted:true});await content.save('categories',category.id,category,{...options,expectedRevision:1,deleted:true});
        assert.ok(!content.publicChanges().faq.some(r=>r.id===question.id));
        const loan=structuredClone(require('../Server/data/loans.json').records[0]);loan.id='loan_test';loan.sources[0].url='javascript:alert(1)';
        await assert.rejects(content.save('loans',loan.id,loan,options),e=>e.code==='INVALID_CONTENT');
        const institution=baseCatalog.payload.institutions.find(i=>!i.programCount&&i.verificationStatus==='directory-listed');
        if(institution)await assert.rejects(content.save('institutions',institution.id,{...institution,name:'Unverified change'},options),e=>e.code==='INVALID_CONTENT');
    }finally{await store.close();}
});

test('admin HTTP endpoints require a real session, server permission and same-origin writes',async()=>{
    const express=require('express'),{once}=require('node:events'),{createAccountStore}=require('../Server/account-store'),{createAuthRouter}=require('../Server/auth'),{createAdminRouter}=require('../Server/admin-router');
    const store=createAccountStore({filename:':memory:'}),content={available:true,error:null,refresh:async()=>{},list:async()=>({items:[],total:0}),save:async()=>({revision:1})};
    const app=express();app.use(express.json());app.use('/api',createAuthRouter({store,cookieSecure:false,adminPolicy:u=>u.email==='owner@example.com',adminRouter:createAdminRouter({content})}));
    const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
    const request=(route,options={})=>fetch(base+'/api'+route,options);
    const register=async email=>{const response=await request('/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Test Student',email,phone:'+995555123456',password:'TestPass12345',passwordConfirm:'TestPass12345',role:'student',termsAccepted:true})});assert.equal(response.status,201);return {cookie:response.headers.getSetCookie().find(s=>s.startsWith('globaledu_session=')).split(';')[0],data:await response.json()};};
    try{
        assert.equal((await request('/admin/status')).status,401);
        const student=await register('student@example.com'),owner=await register('owner@example.com');assert.equal(student.data.user.permissions.admin,false);assert.equal(owner.data.user.permissions.admin,true);
        assert.equal((await request('/admin/status',{headers:{Cookie:student.cookie}})).status,403);
        assert.equal((await request('/admin/status',{headers:{Cookie:owner.cookie}})).status,200);
        assert.equal((await request('/admin/records/faq/faq_test',{method:'PUT',headers:{Cookie:owner.cookie,Origin:'https://untrusted.example','Content-Type':'application/json'},body:'{}'})).status,403);
        assert.equal((await request('/admin/records/faq/faq_test',{method:'PUT',headers:{Cookie:owner.cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({record:{id:'faq_test'},expectedRevision:0})})).status,200);
    }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await store.close();}
});
