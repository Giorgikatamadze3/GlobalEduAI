'use strict';

const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {syncPrograms,argumentsFor}=require('../scripts/sync-programs');
const {normalizeProgramRecord}=require('../program-catalog-core');
const registry=require('../Server/data/program-source-registry.json');

const ROOT=path.resolve(__dirname,'..');
const source=registry.sources.find(item=>item.id==='daad-international-programmes');
const dataPath=name=>path.join(ROOT,'Server/data',name);
const programFile=dataPath('programs.json');
const reportFile=dataPath('program-import-report.json');
const clone=value=>JSON.parse(JSON.stringify(value));
function raw(patch={}){
    return {sourceId:source.id,sourceRecordId:'fixture-new',institutionName:'Fixture University',institutionWebsite:'https://fixture-university.edu/',countryCode:'DE',
        title:'Fixture Computer Science',degree:'master',language:null,languages:['en'],sourceLanguages:['English','Russian'],
        programUrl:source.url+'en/detail/fixture-new/',sourceUrl:source.url+'en/detail/fixture-new/',listingSourceUrl:source.apiUrl,checkedAt:'2026-10-28',...patch};
}
function fixture({snapshot,fetchError,failWrite,failRename,existingPatch}={}){
    const existingProgram=normalizeProgramRecord(raw({sourceRecordId:'fixture-old',title:'Previous Valid Programme',programUrl:source.url+'en/detail/fixture-old/',sourceUrl:source.url+'en/detail/fixture-old/'}),source);
    const existing={metadata:{programCount:1,updatedAt:'2026-10-27',sourceSnapshots:{}},programs:[{...existingProgram,...existingPatch}]};
    const before=JSON.stringify(existing,null,2)+'\n';
    const defaultSnapshot={records:[raw()],coverage:{sourceId:source.id,listingComplete:true,complete:true,asOf:'2026-10-28',lookupFailures:[],recordsFetched:1}};
    const value=snapshot===undefined?defaultSnapshot:snapshot;
    const files=new Map([
        [dataPath('program-source-registry.json'),JSON.stringify(registry)],
        [dataPath('institutions.json'),JSON.stringify({institutions:[{id:'inst_aaaaaaaaaaaaaaaaaaaaaaaa',name:'Fixture University',countryCode:'DE',website:'https://fixture-university.edu/',domains:['fixture-university.edu']}]})],
        [programFile,before],[reportFile,'{"previous":true}\n'],[path.join(ROOT,'.program-cache','fixture.json'),JSON.stringify(value)]
    ]);
    const events=[],fetches=[];
    const fileSystem={
        readFileSync(filename){const key=path.resolve(filename);assert.ok(files.has(key),`Unexpected fixture read: ${key}`);return files.get(key);},
        writeFileSync(filename,content){const key=path.resolve(filename);events.push({type:'write',path:key});if(failWrite?.(key))throw new Error('Fixture disk write failed');files.set(key,String(content));},
        renameSync(from,to){const input=path.resolve(from),output=path.resolve(to);events.push({type:'rename',from:input,path:output});if(failRename?.(output))throw new Error('Fixture rename failed');assert.ok(files.has(input));files.set(output,files.get(input));files.delete(input);},
        existsSync(filename){return files.has(path.resolve(filename));},
        unlinkSync(filename){files.delete(path.resolve(filename));}
    };
    const fetchCatalog=async fetchedSource=>{fetches.push(fetchedSource.id);if(fetchError)throw fetchError;return clone(value);};
    return {files,events,fetches,before,dependencies:{fileSystem,fetchCatalog,supplementInstitutions:directory=>directory}};
}

test('program sync defaults to a fully validated dry run without changing the catalog or report',async()=>{
    const app=fixture();
    const result=await syncPrograms({},app.dependencies);
    assert.equal(result.write,false);assert.equal(result.source,source.id);assert.equal(result.accepted,1);assert.equal(result.programCount,2);assert.equal(result.coverage,'partial');
    assert.equal(app.files.get(programFile),app.before);assert.deepEqual(app.events,[]);assert.deepEqual(app.fetches,[source.id]);
});

test('a successful explicit write publishes validated JSON and a report, and reimporting it is idempotent',async()=>{
    const app=fixture();
    const result=await syncPrograms({write:true},app.dependencies);
    assert.equal(result.write,true);assert.equal(result.accepted,1);
    const catalog=JSON.parse(app.files.get(programFile)),report=JSON.parse(app.files.get(reportFile));
    assert.equal(catalog.programs.length,2);assert.equal(catalog.metadata.programCount,2);assert.equal(report.import.accepted,1);
    assert.equal(report.programCoverage.completeness,'partial');assert.equal(catalog.programs.find(program=>program.provenance.sourceRecordId==='fixture-new').language,null);
    assert.ok(![...app.files.keys()].some(filename=>filename.endsWith('.next')));
    const again=await syncPrograms({},app.dependencies);
    assert.equal(again.accepted,0);assert.equal(again.updated,0);assert.equal(again.duplicates,1);
});

test('cached snapshots do not invoke the live provider and cache paths remain in the project',async()=>{
    const app=fixture();
    await syncPrograms({cache:'.program-cache/fixture.json'},app.dependencies);
    assert.deepEqual(app.fetches,[]);assert.deepEqual(app.events,[]);
    await assert.rejects(syncPrograms({cache:'../outside.json'},app.dependencies),/remain in the project/);
    await assert.rejects(syncPrograms({cache:''},app.dependencies),/nonempty/);
    assert.deepEqual(app.fetches,[]);
});

test('missing CLI values cannot turn a requested cache-only operation into a live fetch',()=>{
    assert.equal(argumentsFor([]).write,false);
    assert.deepEqual(argumentsFor(['--from-cache','.program-cache/fixture.json','--write']),{source:source.id,cache:'.program-cache/fixture.json',write:true});
    for(const args of [['--from-cache'],['--from-cache','--write'],['--source'],['--source',''],['--unrecognised']])assert.throws(()=>argumentsFor(args));
});

test('provider failure, incomplete or empty listings preserve the previous successful catalog',async()=>{
    const failed=fixture({fetchError:new Error('Fixture provider unavailable')});
    await assert.rejects(syncPrograms({write:true},failed.dependencies),/Fixture provider unavailable/);
    assert.equal(failed.files.get(programFile),failed.before);assert.deepEqual(failed.events,[]);
    for(const snapshot of [
        {records:[],coverage:{sourceId:source.id,listingComplete:true,asOf:'2026-10-28'}},
        {records:[raw()],coverage:{sourceId:source.id,listingComplete:false,asOf:'2026-10-28'}},
        {records:[raw()],coverage:{sourceId:'unregistered-source',listingComplete:true,asOf:'2026-10-28'}}
    ]){
        const app=fixture({snapshot});await assert.rejects(syncPrograms({write:true},app.dependencies),/incomplete or empty/);
        assert.equal(app.files.get(programFile),app.before);assert.deepEqual(app.events,[]);
    }
});

test('entirely invalid or unlinked records and validation failures cannot replace a valid snapshot',async()=>{
    for(const patch of [{countryCode:'XX'},{institutionWebsite:'https://unlisted-fixture.edu/'}]){
        const snapshot={records:[raw(patch)],coverage:{sourceId:source.id,listingComplete:true,asOf:'2026-10-28'}};
        const app=fixture({snapshot});await assert.rejects(syncPrograms({write:true},app.dependencies),/validated and linked/);
        assert.equal(app.files.get(programFile),app.before);assert.deepEqual(app.events,[]);
    }
    const invalidExisting=fixture({existingPatch:{mode:'invalid-mode'}});
    await assert.rejects(syncPrograms({write:true},invalidExisting.dependencies),/Validation failed/);
    assert.equal(invalidExisting.files.get(programFile),invalidExisting.before);assert.deepEqual(invalidExisting.events,[]);
});

test('report staging failure or catalogue rename failure leaves the previous catalogue intact and cleans staging files',async()=>{
    for(const options of [{failWrite:filename=>filename===reportFile+'.next'},{failRename:filename=>filename===programFile}]){
        const app=fixture(options);await assert.rejects(syncPrograms({write:true},app.dependencies),/Fixture/);
        assert.equal(app.files.get(programFile),app.before);
        assert.ok(![...app.files.keys()].some(filename=>filename.endsWith('.next')));
    }
});

test('disabled source adapters cannot be selected and string write flags cannot accidentally publish',async()=>{
    const app=fixture();
    await assert.rejects(syncPrograms({source:'finland-studyinfo',write:true},app.dependencies),/enabled official source/);
    await assert.rejects(syncPrograms({write:'false'},app.dependencies),/explicit boolean/);
    assert.deepEqual(app.fetches,[]);assert.deepEqual(app.events,[]);assert.equal(app.files.get(programFile),app.before);
});
