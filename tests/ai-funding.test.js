'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const {loadCatalog}=require('../Server/catalog-service');
const {createAdvisorAgent}=require('../Server/ai-agent');

const catalog=loadCatalog();
const NOW=Date.parse('2026-10-28T12:00:00Z');
const KEY='sk-test-only-funding-fixture';
const programId='program_tum-informatics-msc';
const messages=[{role:'user',content:'ამ პროგრამის DAAD დაფინანსების შესაძლებლობები ამიხსენი.'}];
async function turn(tool,args,{service=catalog,profile=null,reply='პირადი პირობები და კონკურსის ვადა ცალკე გადაამოწმე.'}={}) {
    const requests=[];
    const agent=createAdvisorAgent({catalog:service,apiKey:KEY,clock:()=>NOW,timeoutMs:2000,fetchImpl:async(url,options)=>{
        const body=JSON.parse(options.body);requests.push(body);
        const output=requests.length===1
            ? [{type:'function_call',id:'fc_funding',call_id:'call_funding',name:tool,arguments:JSON.stringify(args)}]
            : [{type:'message',id:'msg_funding',role:'assistant',content:[{type:'output_text',text:reply}]}];
        return new Response(JSON.stringify({status:'completed',output}),{status:200,headers:{'Content-Type':'application/json'}});
    }});
    const result=await agent.respond({messages,profile});
    const output=requests[1].input.find(item=>item.type==='function_call_output');
    return {result,toolData:JSON.parse(output.output),requests};
}

test('program tools distinguish a conditional DAAD possibility from a listed but closed institutional grant',async()=>{
    const {toolData,result,requests}=await turn('get_program_details',{programId});
    const funding=toolData.program.funding;
    assert.equal(funding.assessmentAvailable,true);assert.equal(funding.fullFunding,null);
    const daad=funding.opportunities.find(item=>item.id==='funding_daad-master-all-disciplines');
    const grant=funding.opportunities.find(item=>item.id==='funding_tum-international-grant');
    assert.ok(daad);assert.equal(daad.associationStatus,'potential');assert.notEqual(daad.status,'listed');assert.ok(daad.missing.length);
    assert.equal(daad.awardGuaranteed,false);assert.equal(daad.call.deadline,null);
    assert.ok(grant);assert.equal(grant.associationStatus,'listed');assert.equal(grant.callStatus,'closed');assert.equal(grant.status,'needs-verification');
    assert.equal(grant.call.deadline,'2026-10-15');assert.equal(grant.awardGuaranteed,false);
    const canonical=new Set(catalog.payload.funding.schemes.flatMap(item=>item.sources.map(source=>source.url)));
    assert.ok(result.sources.some(source=>source.kind==='funding'));
    assert.ok(result.sources.filter(source=>source.kind==='funding').every(source=>canonical.has(source.url)));
    assert.match(requests[0].instructions,/callStatus=closed/);assert.match(requests[0].instructions,/awardGuaranteed/);
    assert.equal(requests[0].tools.length,4,'Funding does not add new model tools');
});

test('institution funding summaries retain their aggregate scope and never claim eligibility for every programme',async()=>{
    const {toolData}=await turn('search_universities',{query:'Oxford',countryCode:'GB'});
    const oxford=toolData.items.find(item=>item.name==='University of Oxford');
    assert.ok(oxford);assert.equal(oxford.funding.assessmentAvailable,true);
    const clarendon=oxford.funding.opportunities.find(item=>item.id==='funding_oxford-clarendon');
    const chevening=oxford.funding.opportunities.find(item=>item.id==='funding_chevening');
    assert.ok(clarendon);assert.equal(clarendon.associationStatus,'listed');
    assert.equal(clarendon.aggregate,true);assert.equal(clarendon.appliesToAllPrograms,false);assert.equal(clarendon.awardGuaranteed,false);
    assert.ok(chevening);assert.equal(chevening.callStatus,'closed');assert.equal(chevening.call.deadline,null);
});

test('funding provider facts and trusted links come from the canonical dataset, never an injected assessment or assistant URL',async()=>{
    const canonical=catalog.payload.funding.schemes.find(item=>item.id==='funding_daad-master-all-disciplines');
    const fabricated='https://invented-award.example/guaranteed-full-scholarship';
    const service={...catalog,fundingForProgram:()=>[
        {...canonical,title:'Guaranteed Award',provider:'Invented Provider',coverage:{amount:999999,currency:'USD'},sources:[{url:fabricated,label:'Invented Award'}],
            status:'potential',associationStatus:'potential',eligibilityStatus:'needs-verification',callStatus:'unknown',reasons:[],missing:['Applicant conditions remain unknown.'],awardGuaranteed:true},
        {id:'funding_nonexistent',title:'No such scheme',sources:[{url: fabricated}],status:'listed'}
    ]};
    const {toolData,result}=await turn('get_program_details',{programId},{service,reply:`Guaranteed award: ${fabricated}`});
    const funding=toolData.program.funding;
    assert.equal(funding.opportunities.length,1);assert.equal(funding.opportunities[0].title,canonical.title);
    assert.equal(funding.opportunities[0].provider,canonical.provider);assert.equal(funding.opportunities[0].coverage.amount,canonical.coverage.amount);
    assert.equal(funding.opportunities[0].awardGuaranteed,false);
    assert.ok(!JSON.stringify(toolData).includes(fabricated));assert.ok(!JSON.stringify(result.sources).includes(fabricated));
    assert.ok(!result.reply.includes(fabricated));assert.match(result.reply,/წყაროთი არ არის გადამოწმებული/);
});

test('unavailable funding assessment is explicit and does not block independently known programme facts',async()=>{
    for(const fundingForProgram of [undefined,()=>{throw new Error('Funding unavailable');}]) {
        const {toolData}=await turn('get_program_details',{programId},{service:{...catalog,fundingForProgram}});
        assert.equal(toolData.program.id,programId);assert.equal(toolData.program.funding.assessmentAvailable,false);
        assert.deepEqual(toolData.program.funding.opportunities,[]);assert.equal(toolData.program.funding.fullFunding,null);
        assert.equal(toolData.program.tuition.amount,null);
    }
});

test('funding assessments receive only matching criteria the student explicitly shared',async()=>{
    const received=[];
    const service={...catalog,fundingForProgram:(id,applicant,options)=>{received.push({id,applicant,options});return catalog.fundingForProgram(id,applicant,options);}};
    await turn('get_program_details',{programId},{service});
    assert.equal(received[0].applicant,null);
    await turn('get_program_details',{programId},{service,profile:{fundingScheme:'funding_daad-master-all-disciplines',citizenshipCode:'GE',name:'Private Name',email:'private@example.com',password:'NeverForward123'}});
    assert.deepEqual(received[1].applicant,{fundingScheme:'funding_daad-master-all-disciplines',citizenshipCode:'GE'});
    assert.deepEqual(received[1].options,{asOf:'2026-10-28'});
    assert.equal(JSON.stringify(received).includes('private@example.com'),false);
    await assert.rejects(turn('get_program_details',{programId},{service,profile:{fundingScheme:'invalid-scheme'}}),error=>error.code==='INVALID_REQUEST');
});

test('personal programme assessment retains the shared funding scheme as a matching constraint',async()=>{
    const accepted=await turn('assess_program',{programId},{profile:{fundingScheme:'funding_daad-master-all-disciplines'}});
    assert.ok(accepted.toolData.assessment.reasons.some(reason=>reason.includes('მინიჭებას არ ნიშნავს')));
    assert.equal(accepted.toolData.scoring.admissionChance.probability,null);
    const unrelated=await turn('assess_program',{programId},{profile:{fundingScheme:'funding_oxford-clarendon'}});
    assert.equal(unrelated.toolData.assessment.status,'excluded');
    assert.ok(unrelated.toolData.assessment.exclusionReasons.some(reason=>reason.includes('დაფინანსების სქემასთან')));
    assert.equal(unrelated.toolData.scoring.admissionChance.probability,null);
});

test('official-directory details retain null degree, taxonomy, language, fee context and mode',async()=>{
    const base=catalog.payload.programs.find(program=>program.id===programId);
    const program={...base,id:'program_directory-fixture',verificationStatus:'official-directory',degree:null,field:null,category:null,language:null,languages:['en'],mode:null,durationMonths:null,
        tuition:{amount:null,currency:null,period:null,applicantScope:null},funding:{fullFunding:null,scholarships:[],opportunityIds:[]}};
    const service={...catalog,payload:{...catalog.payload,programs:[program]},fundingForProgram:()=>[]};
    const {toolData}=await turn('get_program_details',{programId:program.id},{service});
    for(const key of ['degree','field','category','language','mode','durationMonths'])assert.equal(toolData.program[key],null,key);
    assert.deepEqual(toolData.program.languages,['en']);
    assert.deepEqual(toolData.program.tuition,{amount:null,currency:null,period:null,applicantScope:null,note:''});
    assert.equal(toolData.program.verificationStatus,'official-directory');assert.equal(toolData.program.funding.fullFunding,null);
});
