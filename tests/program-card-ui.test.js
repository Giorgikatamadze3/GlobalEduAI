'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const I18n=require('../i18n');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function scoringFixture(){
    const listeners={};
    const data={fitScore:75,conservativeScore:60,dataCoverage:80,requestedCriteriaCount:2,scope:'program',readiness:{status:'needs-verification',label:'მიღების პირობები დასაზუსტებელია',reasons:Array.from({length:12},(_,n)=>`Readiness ${n}`)},admissionChance:{baseline:null},breakdown:[{label:'Fees <script>',status:'not-matched',available:10,earned:0,requestedWeight:10,explanation:'Fee explanation <img src=x>'},{label:'Language',status:'unknown',available:0,earned:0,requestedWeight:10,explanation:'Language evidence is missing.'}]};
    const context={document:{addEventListener:(name,fn)=>listeners[name]=fn},AdmissionScoring:{DEFAULT_WEIGHTS:{},scoreProgram:()=>data},catalogData:{admissionStatistics:[]},entityMap:new Map(),escapeHTML:escape,todayISO:()=> '2026-10-30',safeLink:()=>null,openDynamicUniModal:()=>{throw Error('An inline toggle must not open a modal.');}};
    vm.runInNewContext(fs.readFileSync('discovery-ui.js','utf8')+'\nglobalThis.ui=StudentDiscovery;',context);
    return {ui:context.ui,listeners,data};
}
test('matching disclosures start closed, preserve all explanations and have unique relationships for duplicate cards',()=>{
    const {ui}=scoringFixture(),entity={id:'program_same',program:{},institutionId:'inst_same'};
    const first=ui.scoreBadge(entity,{},[{status:'matched',explanation:'Additional <img src=x>'}]),second=ui.scoreBadge(entity,{});
    assert.match(first,/aria-expanded="false"/);assert.match(first,/data-score-criteria hidden/);assert.match(first,/>75<small>%/);assert.match(first,/80%/);assert.match(first,/>60<small>\/100/);
    const panel=first.match(/aria-controls="([^"]+)"/)[1];assert.ok(first.includes(`id="${panel}"`));assert.notEqual(panel,second.match(/aria-controls="([^"]+)"/)[1]);
    for(let n=0;n<12;n++)assert.ok(first.includes(`Readiness ${n}`));
    assert.match(first,/data-status="not-matched"/);assert.match(first,/data-status="unknown"/);assert.match(first,/Language evidence is missing/);assert.match(first,/Additional &lt;img src=x&gt;/);assert.doesNotMatch(first,/<script>|<img src=x>/);
});
test('toggle changes only its own panel, ARIA state and label, then reverses without opening a modal',()=>{
    const {listeners}=scoringFixture(),panel={id:'own-panel',hidden:true},other={hidden:true},label={textContent:'დეტალები'},attributes={'aria-controls':'own-panel','aria-expanded':'false'};
    const button={dataset:{action:'toggle-score-details'},getAttribute:key=>attributes[key],setAttribute:(key,value)=>attributes[key]=value,querySelector:()=>label,closest:()=>({querySelector:()=>panel})};
    const click=()=>listeners.click({target:{closest:()=>button}});
    click();assert.equal(panel.hidden,false);assert.equal(attributes['aria-expanded'],'true');assert.equal(label.textContent,'დამალვა');assert.equal(other.hidden,true);
    click();assert.equal(panel.hidden,true);assert.equal(attributes['aria-expanded'],'false');assert.equal(label.textContent,'დეტალები');assert.equal(other.hidden,true);
    attributes['aria-controls']='another-panel';click();assert.equal(panel.hidden,true);
});
test('unknown scores stay unknown and never become an invented match percentage',()=>{
    const {ui,data}=scoringFixture();data.fitScore=null;
    const html=ui.scoreBadge({id:'program_unknown',program:{}},{});
    assert.match(html,/—<small>%/);assert.match(html,/ქულისთვის აირჩიე/);assert.match(html,/aria-expanded="false"/);
});
function cardsFixture(){
    const entity={id:'program_fixture',name:'University <script> & Partners',kind:'program',country:'Georgia',countryCode:'GE',program:{title:'Advanced <img src=x> Master with a very long programme title',mode:'part-time',degree:'master',language:'en',field:'computer-science',verificationStatus:'official-source',tuition:{amount:null},funding:{opportunityIds:[]}}};
    const calls=[];
    const context={escapeHTML:escape,favoritesList:[],compareList:[],FundingUI:{summary:()=>''},StudentDiscovery:{scoreBadge:(...args)=>{calls.push(args);return '<section class="score-disclosure">Score</section>';}},CatalogCore:{DEGREES:[{value:'master',label:'Master'}],LANGUAGES:[{value:'en',label:'English'}],FIELDS:[]},lastAdvisorPreferences:{},formatDate:value=>value};
    vm.runInNewContext(fs.readFileSync('catalog-ui.js','utf8')+'\nglobalThis.cards={programCard,advisorResultCard,entityMap};',context);context.cards.entityMap.set(entity.id,entity);
    return {...context.cards,entity,calls};
}
test('catalogue and advisor cards lead with the programme, then university and format with safely wrapped text',()=>{
    const app=cardsFixture();
    for(const html of [app.programCard(app.entity),app.advisorResultCard({program:{id:app.entity.id}})]){
        const heading=html.indexOf('<h3 class="program-heading">'),university=html.indexOf('class="program-university"'),mode=html.indexOf('class="program-study-mode"'),score=html.indexOf('class="score-disclosure"');
        assert.ok(heading>=0&&heading<university&&university<mode&&mode<score);assert.match(html,/Advanced &lt;img src=x&gt;/);assert.match(html,/University &lt;script&gt; &amp; Partners/);assert.match(html,/ნაწილობრივი დატვირთვა/);assert.doesNotMatch(html,/<script>|<img src=x>/);
    }
});
test('advisor criteria are passed in full to the hidden disclosure, including reasons beyond previous display limits',()=>{
    const app=cardsFixture(),reasons=Array.from({length:7},(_,n)=>({message:`Reason ${n}`})),missing=Array.from({length:9},(_,n)=>`Missing ${n}`),warnings=['Warning'];
    const html=app.advisorResultCard({program:{id:app.entity.id},reasons,missing,warnings});
    const criteria=app.calls[0][2];assert.equal(criteria.length,17);assert.equal(criteria[6].explanation,'Reason 6');assert.equal(criteria[15].explanation,'Missing 8');assert.equal(criteria[16].explanation,'Warning');assert.ok(!html.includes('<ul>'));
});
test('new card controls and criteria statuses translate in all supported languages',()=>{
    for(const source of ['სწავლის ფორმატი','დამალვა','დეტალები','შერჩევის დამატებითი პირობები','ემთხვევა','არ ემთხვევა'])for(const language of ['en','ru'])assert.ok(!/[ა-ჰ]/.test(I18n.t(source,language)),`${language}: ${source}`);
});
