'use strict';
const nativeFS=require('node:fs');const path=require('node:path');
const {fetchOfficialCatalog}=require('./providers/official-catalogs');
const {mergeProgramCatalog,computeProgramCoverage}=require('../program-catalog-core');
const {validatePrograms}=require('./validate-programs');
const {applyInstitutionOverrides}=require('./institution-overrides');
const {applyInstitutionSupplements}=require('./institution-supplements');
const ROOT=path.resolve(__dirname,'..');
function argumentsFor(args){
 const options={source:'daad-international-programmes',write:false,cache:null};
 for(let i=0;i<args.length;i++){
  const key=args[i];
  if(key==='--write')options.write=true;
  else if(key==='--source'||key==='--from-cache'){
   const value=args[++i];
   if(typeof value!=='string'||!value.trim()||value.startsWith('--'))throw new Error(`${key} requires a value.`);
   options[key==='--source'?'source':'cache']=value;
  }else if(key==='--help')options.help=true;
  else throw new Error(`Unsupported option: ${key}`);
 }
 return options;
}
// Tests inject an in-memory filesystem and provider; CLI uses the real project.
async function syncPrograms(options={}, {fileSystem=nativeFS,fetchCatalog=fetchOfficialCatalog,supplementInstitutions=applyInstitutionSupplements}={}){
 const fs=fileSystem;
 const registry=JSON.parse(fs.readFileSync(path.join(ROOT,'Server/data/program-source-registry.json'),'utf8'));
 const source=registry.sources.find(item=>item.id===(options.source||'daad-international-programmes')&&item.enabled);if(!source)throw new Error('Choose an enabled official source from the registry.');
 if(options.cache!=null&&(typeof options.cache!=='string'||!options.cache.trim()))throw new Error('Snapshot cache requires a nonempty project-relative path.');
 if(options.write!==undefined&&typeof options.write!=='boolean')throw new Error('write must be an explicit boolean.');
 const cachePath=options.cache?path.resolve(ROOT,options.cache):null;
 if(cachePath){const relative=path.relative(ROOT,cachePath);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Snapshot cache must remain in the project.');}
 const snapshot=cachePath?JSON.parse(fs.readFileSync(cachePath,'utf8')):await fetchCatalog(source,{onProgress:options.onProgress});
 if(snapshot.coverage?.sourceId!==source.id||!snapshot.coverage.listingComplete||!Array.isArray(snapshot.records)||!snapshot.records.length)throw new Error('Source snapshot is incomplete or empty; previous catalog preserved.');
 const directory=supplementInstitutions(applyInstitutionOverrides(JSON.parse(fs.readFileSync(path.join(ROOT,'Server/data/institutions.json'),'utf8'))));
 const file=path.join(ROOT,'Server/data/programs.json');const existing=JSON.parse(fs.readFileSync(file,'utf8'));
 const checkedAt=snapshot.coverage.asOf;const merged=mergeProgramCatalog({existingPrograms:existing.programs,records:snapshot.records,source,directory,checkedAt});
 if(merged.report.accepted+merged.report.updated+merged.report.duplicates===0)throw new Error('No source records could be validated and linked; previous catalog preserved.');
 const coverage=computeProgramCoverage(directory.institutions,merged.programs,registry);
 const catalog={metadata:{...existing.metadata,updatedAt:checkedAt,programCount:merged.programs.length,coverageNote:'Official-source programme records from registered catalogues and individually checked university pages. Worldwide and national coverage remain partial; a source listing is not proof of an open admission cycle.',sourcePolicy:'University pages and explicitly registered authoritative programme directories. Source kind and dated provenance are retained; unpublished attributes remain null.',programCoverage:coverage,sourceSnapshots:{...existing.metadata.sourceSnapshots,[source.id]:{...snapshot.coverage,lookupFailures:snapshot.coverage.lookupFailures?.length||0}},fundingPolicy:'Funding schemes are linked separately with conditions and call dates. No scholarship award or full tuition-plus-living funding is inferred.'},programs:merged.programs};
 const errors=validatePrograms(catalog);if(errors.length)throw new Error(`Validation failed; previous catalog preserved: ${errors.slice(0,5).join('; ')}`);
 const report={sourceId:source.id,checkedAt,sourceCoverage:snapshot.coverage,import:merged.report,programCoverage:coverage};
 if(options.write){
  const temporary=file+'.next',reportFile=path.join(ROOT,'Server/data/program-import-report.json'),temporaryReport=reportFile+'.next';
  try{
   // Finish both writes before replacing the critical programme snapshot.
   fs.writeFileSync(temporary,JSON.stringify(catalog,null,2)+'\n');
   fs.writeFileSync(temporaryReport,JSON.stringify(report,null,2)+'\n');
   fs.renameSync(temporaryReport,reportFile);
   fs.renameSync(temporary,file);
  }finally{
   for(const candidate of [temporary,temporaryReport])if(fs.existsSync(candidate))fs.unlinkSync(candidate);
  }
 }
 return{write:Boolean(options.write),source:source.id,sourceRecords:snapshot.records.length,programCount:merged.programs.length,institutionsWithPrograms:coverage.institutionsWithPrograms,accepted:merged.report.accepted,updated:merged.report.updated,duplicates:merged.report.duplicates,unmatched:merged.report.unmatched,ambiguous:merged.report.ambiguous,invalid:merged.report.invalid,coverage:'partial'};
}
async function main(args=process.argv.slice(2)){const options=argumentsFor(args);if(options.help)return console.log('node scripts/sync-programs.js [--source daad-international-programmes] [--from-cache .program-cache/source.json] [--write]\nDefault is a dry run. Only complete nonempty source listings can be merged; failed imports preserve the previous catalog.');options.onProgress=progress=>{if(progress.phase==='listing'||progress.institutionsChecked%20===0)console.log(JSON.stringify(progress));};console.log(JSON.stringify(await syncPrograms(options),null,2));}
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={syncPrograms,argumentsFor};
