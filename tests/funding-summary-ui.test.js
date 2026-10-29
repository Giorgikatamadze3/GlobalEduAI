'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Funding=require('../funding-core');
const Core=require('../catalog-core');
const funding=require('../Server/data/funding.json');
const programs=require('../Server/data/programs.json').programs;
const institutions=require('../Server/data/institutions.json').institutions;
const source=fs.readFileSync(path.join(__dirname,'../funding-ui.js'),'utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const clone=value=>JSON.parse(JSON.stringify(value));

function setup({catalog=clone(funding),contextPrograms=programs,contextInstitutions=institutions}={}){
    const entityMap=new Map(contextInstitutions.map(i=>[i.id,{...i,kind:'institution'}]));
    const programByInstitution=new Map();
    for(const program of contextPrograms){
        entityMap.set(program.id,{id:program.id,kind:'program',program,institutionId:program.institutionId});
        const list=programByInstitution.get(program.institutionId)||[];list.push(program);programByInstitution.set(program.institutionId,list);
    }
    const document={addEventListener(){},querySelector(){return null;}};
    const context={console,URL,document,FundingCore:Funding,CatalogCore:Core,catalogData:{funding:catalog},entityMap,programByInstitution,
        todayISO:()=> '2026-10-28',escapeHTML:escape,optionLabel:(options,value)=>options.find(o=>(o.value??o.code??o.id)===value)?.label||value||'დასაზუსტებელია',formatDate:value=>value,sourceLinks:sources=>sources.map(s=>`<a href="${escape(s.url)}">${escape(s.label)}</a>`).join('')};
    vm.runInNewContext(source+'\nglobalThis.TestFundingUI=FundingUI;',context,{filename:'funding-ui.js'});
    return {ui:context.TestFundingUI,entityMap,programByInstitution,context};
}
function byTitle(pattern){const program=programs.find(p=>pattern.test(p.title));assert.ok(program,`Published fixture ${pattern}`);return program;}

test('Saarland university card labels national DAAD as potential, not a confirmed programme award',()=>{
    const app=setup();const program=programs.find(p=>p.id==='program_saarland-computer-science-msc');assert.ok(program);
    const html=app.ui.summary(app.entityMap.get(program.institutionId));
    assert.match(html,/funding-provider-badge potential/);assert.match(html,/>DAAD<\/span>/);
    assert.match(html,/შესაძლო დაფინანსება/);assert.doesNotMatch(html,/funding-provider-badge confirmed/);
    assert.match(html,/პროგრამის შესაბამისობა გადასამოწმებელია/);
});

test('Göttingen EPOS binding is confirmed on the university and the exact programme card',()=>{
    const app=setup();const program=byTitle(/^Development Economics \(MSc\)$/);
    for(const entity of [app.entityMap.get(program.id),app.entityMap.get(program.institutionId)]){
        const html=app.ui.summary(entity);
        assert.match(html,/funding-provider-badge confirmed/);assert.match(html,/>DAAD EPOS<\/span>/);
        assert.match(html,/დადასტურებული კავშირი/);
        assert.doesNotMatch(html,/დაფინანსება გარანტირებულია|მიღება გარანტირებულია/);
    }
    const details=app.ui.section(app.entityMap.get(program.id));
    assert.match(details,/კავშირი არ ნიშნავს პირად შესაბამისობას ან დაფინანსების გარანტიას/);
});

test('Oxford card separates Clarendon association from the closed Chevening call',()=>{
    const app=setup();const institution=institutions.find(i=>i.countryCode==='GB'&&/University of Oxford/.test(i.name));assert.ok(institution);
    const html=app.ui.summary(app.entityMap.get(institution.id));
    assert.match(html,/>Clarendon<\/span>/);assert.match(html,/funding-provider-badge confirmed/);
    assert.match(html,/>Chevening<\/span>/);assert.match(html,/შესაძლო დაფინანსება · მიღება დახურულია/);
    assert.match(html,/data-id="inst_[a-f\d]+"/);
});

test('an unrelated directory institution has an honest unknown-funding marker',()=>{
    const app=setup();const institution=institutions.find(i=>i.countryCode==='GE');assert.ok(institution);
    const html=app.ui.summary(app.entityMap.get(institution.id));
    assert.match(html,/funding-summary-empty/);assert.match(html,/დაფინანსების წყარო ჯერ არ არის აღწერილი/);
    assert.doesNotMatch(html,/funding-provider-badge|დაფინანსება არ არსებობს/);
});

test('provider names and scheme titles cannot inject markup into badge labels or tooltip attributes',()=>{
    const catalog=clone(funding);const scheme=clone(catalog.schemes.find(s=>s.id==='funding_daad-master-all-disciplines'));
    scheme.id='funding_test-provider';scheme.title='Scholarship "><img src=x>';scheme.provider='Donor "><svg>';
    catalog.schemes=[scheme];catalog.metadata.schemeCount=1;
    const app=setup({catalog});const program=byTitle(/^Development Economics \(MSc\)$/);
    const html=app.ui.summary(app.entityMap.get(program.id));
    assert.doesNotMatch(html,/<img|<svg/);assert.match(html,/&quot;&gt;&lt;img src=x&gt;/);
    assert.match(html,/Donor &quot;&gt;&lt;svg&gt;/);
    const title=html.match(/ title="([^"]*)"/)?.[1];assert.ok(title?.includes('&quot;&gt;&lt;img'));
});

test('missing catalogue or invalid entity cannot fabricate a funding badge',()=>{
    const app=setup();
    for(const entity of [null,undefined,{},'unknown'])assert.equal(app.ui.summary(entity),'');
    app.context.catalogData=null;
    assert.equal(app.ui.summary({id:'inst_unknown'}),'');
});
