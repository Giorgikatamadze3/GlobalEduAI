'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../catalog-core');

const scheme='funding_daad-master-all-disciplines';
const institution={id:'inst_funding-example',name:'Example University',countryCode:'DE',website:'https://example.edu/',domains:['example.edu']};
function program(patch={}) {
    return {id:'program_funding-example',institutionId:institution.id,institutionName:institution.name,institutionWebsite:institution.website,countryCode:'DE',
        title:'Computer Science',degree:'master',language:'en',field:'computer-science',category:'tech',mode:'full-time',durationMonths:24,
        tuition:{amount:0,currency:'EUR',period:'year',applicantScope:'all'},requirements:{gpaMinPercent:null},deadline:{date:null},
        funding:{fullFunding:null,scholarships:[],opportunityIds:[scheme]},verificationStatus:'official-directory',sources:[{url:'https://directory.example.org/program/1',checkedAt:'2026-10-27'}],...patch};
}
const filters=(records,prefs={})=>Core.filterPrograms(records,[institution],prefs,{asOf:'2026-10-28'});

test('a selected funding scheme filters actual program opportunity IDs and activates institution program filtering',()=>{
    const selected=program();
    const unrelated=program({id:'program_unrelated',funding:{fullFunding:null,scholarships:[],opportunityIds:['funding_other']}});
    const unknown=program({id:'program_unknown',funding:{fullFunding:null,scholarships:[]}});
    const prefs=Core.normalizePreferences({fundingScheme:scheme});
    assert.equal(prefs.fundingScheme,scheme);assert.ok(Core.hasProgramFilters(prefs));
    assert.deepEqual(filters([selected,unrelated,unknown],prefs).map(item=>item.id),[selected.id]);
    assert.equal(Core.filterCatalogInstitutions([institution],[selected],prefs,{asOf:'2026-10-28'}).length,1);
    assert.deepEqual(Core.filterCatalogInstitutions([institution],[unrelated],prefs,{asOf:'2026-10-28'}),[]);
});

test('malformed funding scheme filters are rejected instead of silently broadening results',()=>{
    for(const fundingScheme of [42,{},['funding_daad-master-all-disciplines'],'DAAD','funding_../../admin','funding_'+ 'x'.repeat(110)]) {
        const prefs=Core.normalizePreferences({fundingScheme});assert.ok(prefs.filterIssues.length);
        assert.deepEqual(filters([program()],{fundingScheme}),[]);
    }
    assert.equal(Core.normalizePreferences({fundingScheme:null}).fundingScheme,'');
});

test('possible opportunities do not satisfy the confirmed scholarship checkbox or imply full funding',()=>{
    const record=program();
    assert.equal(filters([record],{hasScholarships:true}).length,0);
    assert.equal(filters([record],{fundingScheme:scheme}).length,1);
    const listed=program({funding:{fullFunding:null,scholarships:['funding_institution-confirmed'],opportunityIds:['funding_institution-confirmed',scheme]}});
    assert.equal(filters([listed],{hasScholarships:true}).length,1);
    assert.equal(filters([record],{hasScholarships:true,requiresFullFunding:true}).length,0);
    assert.equal(filters([listed],{hasScholarships:true,requiresFullFunding:true}).length,0);
    const assessment=Core.evaluateProgram(record,{fundingScheme:scheme},{asOf:'2026-10-28',institution});
    assert.equal(assessment.program.funding.fullFunding,null);
    assert.ok(assessment.reasons.some(reason=>reason.includes('მინიჭებას არ ნიშნავს')));
    const unknown=Core.evaluateProgram(program({funding:{fullFunding:null,scholarships:[]}}),{fundingScheme:scheme},{asOf:'2026-10-28',institution});
    assert.ok(unknown.missing.some(reason=>reason.includes('სქემებთან კავშირი')));
});

test('dated official-directory programs pass program-linked and freshness filters while unknown fields remain unknown',()=>{
    assert.equal(filters([program()],{sourceFreshOnly:true}).length,1);
    assert.equal(Core.filterCatalogInstitutions([institution],[program()],{hasPrograms:true},{asOf:'2026-10-28'}).length,1);
    const unknown=program({degree:null,language:null,languages:[],field:null,category:null,mode:null});
    for(const prefs of [{degree:'master'},{language:'en'},{field:'tech'},{mode:'full-time'}])assert.deepEqual(filters([unknown],prefs),[]);
    assert.equal(filters([unknown],{hasPrograms:true}).length,1);
    const assessment=Core.evaluateProgram(program(),{},{asOf:'2026-10-28',institution});
    assert.ok(!assessment.missing.includes('პროგრამის ოფიციალური წყარო დასაზუსტებელია.'));
});

test('future, outdated and unsupported directory source status do not satisfy freshness requirements',()=>{
    for(const record of [
        program({sources:[{url:'https://directory.example.org/program/1',checkedAt:'2027-01-01'}]}),
        program({sources:[{url:'https://directory.example.org/program/1',checkedAt:'2024-01-01'}]}),
        program({verificationStatus:'unverified'}),program({sources:[]})
    ])assert.deepEqual(filters([record],{sourceFreshOnly:true}),[]);
});

test('opportunity and other program criteria combine without relaxing either dimension',()=>{
    const record=program();
    assert.equal(filters([record],{fundingScheme:scheme,degree:'master',freeTuitionOnly:true}).length,1);
    assert.deepEqual(filters([record],{fundingScheme:scheme,degree:'bachelor'}),[]);
    assert.deepEqual(filters([record],{fundingScheme:'funding_unrelated',degree:'master'}),[]);
});
