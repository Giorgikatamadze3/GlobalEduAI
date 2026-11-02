'use strict';
const express=require('express');
function createAdminRouter({content}){
    const router=express.Router(),wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
    router.get('/status',wrap(async(req,res)=>{await content.refresh();res.json({available:content.available,error:content.error,canInstall:content.canInstall,accountId:req.account.id});}));
    router.post('/install',wrap(async(req,res)=>res.json(await content.install())));
    router.get('/records/:type',wrap(async(req,res)=>res.json(await content.list(req.params.type,req.query))));
    router.get('/audit',wrap(async(req,res)=>res.json({items:await content.audit()})));
    router.post('/validate/:type/:id',wrap(async(req,res)=>res.json(await content.validate(req.params.type,req.params.id,req.body.record,req.body.deleted===true))));
    router.put('/records/:type/:id',wrap(async(req,res)=>res.json(await content.save(req.params.type,req.params.id,req.body.record,{expectedRevision:req.body.expectedRevision,actorId:req.account.id,deleted:false}))));
    router.post('/delete/:type/:id',wrap(async(req,res)=>{const list=await content.list(req.params.type),current=list.find(r=>r.record.id===req.params.id);if(!current)return res.status(404).json({message:'ჩანაწერი ვერ მოიძებნა.'});res.json(await content.save(req.params.type,req.params.id,current.record,{expectedRevision:req.body.expectedRevision,actorId:req.account.id,deleted:true}));}));
    router.use((e,req,res,next)=>{const code=e.code||'CONTENT_UNAVAILABLE';res.status(code==='INVALID_CONTENT'?400:code==='CONTENT_CONFLICT'?409:503).json({code,message:code==='CONTENT_SETUP_REQUIRED'?'კონტენტის საცავს პირველადი მიგრაცია სჭირდება.':code==='CONTENT_CONFLICT'?'ჩანაწერი შეიცვალა. განაახლე ვერსია და სცადე ხელახლა.':code==='INVALID_CONTENT'?e.message:'კონტენტის შენახვა ვერ მოხერხდა. ცვლილება არ გამოქვეყნებულა.'});});
    return router;
}
module.exports={createAdminRouter};
