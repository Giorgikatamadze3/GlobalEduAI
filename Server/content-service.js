'use strict';
const {createCatalog}=require('./catalog-service'),Core=require('../catalog-core'),Funding=require('../funding-core'),{validatePrograms}=require('../scripts/validate-programs'),{validateDirectory}=require('../scripts/sync-institutions');
const TYPES=['institutions','programs','funding','loans','faq','categories'];
const bad=message=>Object.assign(new Error(message),{code:'INVALID_CONTENT'});
const text=(s,max)=>typeof s==='string'&&s.trim()&&s.length<=max;
const safeURL=s=>{try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&u.hostname.includes('.');}catch{return false;}};
function localized(value,max){return value&&typeof value==='object'&&!Array.isArray(value)&&['ka','en','ru'].every(locale=>text(value[locale],max));}
function validateSimple(type,record){
    if(!record||typeof record!=='object'||Array.isArray(record)||!text(record.id,100))throw bad('ჩანაწერს უნიკალური ID სჭირდება.');
    if(type==='categories'&&(!/^faqcat_[a-z0-9-]+$/.test(record.id)||!localized(record.title,100)))throw bad('კატეგორიას ID და სამივე ენის სათაური სჭირდება.');
    if(type==='faq'&&(!/^faq_[a-z0-9-]+$/.test(record.id)||!text(record.categoryId,100)||!localized(record.question,250)||!localized(record.answer,4000)))throw bad('FAQ-ის კატეგორია, კითხვა და პასუხი სამივე ენაზე აუცილებელია.');
    if(type==='loans'){
        if(!/^loan_[a-z0-9-]+$/.test(record.id)||!text(record.title,200)||!text(record.provider,200)||!Array.isArray(record.countryCodes)||!record.countryCodes.length||!record.countryCodes.every(c=>Core.COUNTRIES[c])||!localized(record.eligibility,2000)||!localized(record.repayment,2000)||!localized(record.interest?.note,1500)||!['fixed','variable','varies'].includes(record.interest?.type)||!(record.interest.annualPercent===null||Number.isFinite(record.interest.annualPercent)&&record.interest.annualPercent>=0&&record.interest.annualPercent<=100)||!/^\d{4}-\d{2}-\d{2}$/.test(record.checkedAt)||!Array.isArray(record.sources)||!record.sources.length||!record.sources.every(s=>safeURL(s.url)&&text(s.label,250)))throw bad('სესხს ქვეყანა, პირობები, განაკვეთის ტიპი, გადახდა და ოფიციალური წყარო სჭირდება.');
    }
}
function createContentService({baseCatalog,store,loans=require('./data/loans.json'),faq=require('./data/faq.json')}={}){
    const baseline={institutions:baseCatalog.payload.institutions,programs:baseCatalog.payload.programs,funding:baseCatalog.payload.funding.schemes,loans:loans.records,faq:faq.records,categories:faq.categories};
    let rows=[],effective=baseCatalog,snapshot=structuredClone(baseline),stamp='',available=false,lastError=null,lastFailure=0;
    function project(changes){const data=structuredClone(baseline);for(const row of changes){if(!TYPES.includes(row.entity_type))continue;const list=data[row.entity_type],index=list.findIndex(r=>r.id===row.entity_id);if(row.deleted){if(index>=0)list.splice(index,1);}else if(index<0)list.push(row.record);else list[index]=row.record;}return data;}
    function check(data,catalogChanged=true){
        for(const type of ['loans','faq','categories'])for(const record of data[type])validateSimple(type,record);
        if(data.faq.some(r=>!data.categories.some(c=>c.id===r.categoryId)))throw bad('ჯერ კატეგორიაზე მიბმული კითხვები გადაიტანე ან წაშალე.');
        if(!catalogChanged)return effective;
        const index=Core.createInstitutionIndex(data.institutions),programIds=new Set(data.programs.map(p=>p.id));
        for(const program of data.programs){const institution=Core.resolveInstitution({...program,institutionId:null},index);if(!institution||program.institutionId&&program.institutionId!==institution.id||institution.countryCode!==program.countryCode)throw bad('Programme country, institution ID and official institution domain must agree.');}
        if(data.funding.some(s=>(s.scope?.programIds||[]).some(id=>!programIds.has(id))))throw bad('Move or remove funding links before deleting a referenced programme.');
        const metadata={...baseCatalog.payload.metadata,institutionCount:data.institutions.length,countryCount:new Set(data.institutions.map(i=>i.countryCode)).size};
        const funding={metadata:{...baseCatalog.payload.funding.metadata,schemeCount:data.funding.length,checkedAt:data.funding.flatMap(s=>s.sources.map(s=>s.checkedAt)).sort().at(-1)||baseCatalog.payload.funding.metadata.checkedAt},schemes:data.funding};
        const errors=[...validateDirectory({metadata,institutions:data.institutions}),...validatePrograms({metadata:{programCount:data.programs.length},programs:data.programs}),...Funding.validateFundingCatalog(funding).issues];if(errors.length)throw bad(errors.slice(0,3).join('; '));
        try{return createCatalog({applySourceCorrections:false,directory:{metadata,institutions:data.institutions},programCatalog:{metadata:{...baseCatalog.payload.metadata.programSources,programCount:data.programs.length},programs:data.programs},fundingCatalog:funding,admissionStatistics:{records:baseCatalog.payload.admissionStatistics},programSourceRegistry:require('./data/program-source-registry.json')});}catch(e){throw bad(e.message);}
    }
    async function refresh(force=false){if(!force&&Date.now()-lastFailure<30000)return;try{const next=await store.all(),version=next.map(r=>r.entity_type+':'+r.entity_id+':'+r.revision).join('|');if(version!==stamp){const projected=project(next);effective=check(projected,next.some(r=>['institutions','programs','funding'].includes(r.entity_type))||rows.some(r=>['institutions','programs','funding'].includes(r.entity_type)));snapshot=projected;stamp=version;}rows=next;available=true;lastError=null;}catch(e){available=false;lastError=e.code||'CONTENT_UNAVAILABLE';lastFailure=Date.now();if(force)throw e;}}
    function candidate(type,id,record,deleted,currentRows=rows){if(!TYPES.includes(type)||!record||record.id!==id)throw bad('ჩანაწერის ტიპი ან ID არასწორია.');if(!deleted&&type==='institutions'&&record.verificationStatus!=='official-institution-listed')throw bad('Edited university records require official institutional provenance.');const next=currentRows.filter(r=>r.entity_type!==type||r.entity_id!==id);next.push({entity_type:type,entity_id:id,record,deleted});const projected=project(next);check(projected,['institutions','programs','funding'].includes(type));return projected;}
    return {refresh,get canInstall(){return store.canInstall;},async install(){const result=await store.install();lastFailure=0;await refresh(true);return result;},get catalog(){return effective;},get baseline(){return baseline;},get snapshot(){return snapshot;},get available(){return available;},get error(){return lastError;},
        publicChanges(){return {available,error:lastError,changes:rows.filter(r=>['institutions','programs','funding'].includes(r.entity_type)).map(r=>({type:r.entity_type,id:r.entity_id,record:r.deleted?null:r.record,deleted:r.deleted,revision:r.revision})),loans:snapshot.loans,faq:snapshot.faq,categories:snapshot.categories};},
        async list(type,query){if(!TYPES.includes(type))throw bad('უცნობი ტიპი.');await refresh();const filtered=snapshot[type].filter(record=>!query?.q||JSON.stringify(record).toLocaleLowerCase().includes(String(query.q).slice(0,200).toLocaleLowerCase()));const offset=Math.max(0,Number(query?.offset)||0),limit=Math.min(100,Math.max(1,Number(query?.limit)||50));const items=(query?filtered.slice(offset,offset+limit):filtered).map(record=>({record,revision:rows.find(r=>r.entity_type===type&&r.entity_id===record.id)?.revision||0}));return query?{items,total:filtered.length,offset,limit}:items;},
        async validate(type,id,record,deleted=false){await refresh();candidate(type,id,record,deleted);return {valid:true};},
        async save(type,id,record,options){await refresh(true);if(!TYPES.includes(type)||!record||record.id!==id)throw bad('Invalid content type or ID.');const result=await store.put(type,id,record,{...options,validate:currentRows=>candidate(type,id,record,options.deleted,currentRows)});await refresh(true);return result;},
        async audit(){return store.audit();}
    };
}
module.exports={createContentService,validateSimple,TYPES};
