'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {checkSourcePolicy}=require('./source-policy');
const ROOT=path.resolve(__dirname,'..'),DATA=path.join(ROOT,'Server/data');
const files=['institutions.json','programs.json','program-source-registry.json','program-import-report.json','world-programme-import-report.json'];
async function refresh({write=false,worldSourceIds=null,root=ROOT}={},injected={}){
 const dataDir=path.join(root,'Server/data');
 const start=Date.now(),reportFile=path.join(dataDir,'catalog-refresh-status.json'),previous=fs.existsSync(reportFile)?JSON.parse(fs.readFileSync(reportFile,'utf8')):{};
 const backup=new Map(files.map(f=>[f,fs.existsSync(path.join(dataDir,f))?fs.readFileSync(path.join(dataDir,f)):null]));
 const report={attemptedAt:new Date(start).toISOString(),intervalHours:6,status:'running',lastSuccessfulAt:previous.lastSuccessfulAt||null,sources:[]};
 const run=(id,script,args=[],timeout=180000)=>{if(Date.now()-start>18*60000)throw Error('Run budget exhausted.');if(injected.runCommand)return injected.runCommand(id,script,args);const r=spawnSync(process.execPath,[script,...args],{cwd:root,timeout,encoding:'utf8',maxBuffer:4*1024*1024,env:{...process.env,DATABASE_PROVIDER:'postgres',AUTH_DB_DRIVER:'sqlite',AUTH_DB_PATH:':memory:',CMS_DB_PATH:':memory:',BILLING_DB_PATH:':memory:'}});if(r.status!==0)throw Error((r.stderr||r.error?.message||r.stdout||'Source failed').slice(-500));return r.stdout;};
 const attempt=async(id,work)=>{try{await work();report.sources.push({id,status:'checked',checkedAt:new Date().toISOString()});}catch(error){report.sources.push({id,status:'failed',previousSnapshotPreserved:true,reason:error.message.slice(0,600)});}console.log(JSON.stringify(report.sources.at(-1)));};
 try{
  await attempt('hipo-universities',async()=>run('hipo','scripts/sync-institutions.js',[],120000));
  const registry=JSON.parse(fs.readFileSync(path.join(dataDir,'program-source-registry.json'),'utf8'));
  for(const source of registry.sources.filter(s=>s.enabled&&['daad-international-programmes','oslo-masters','vienna-masters','uppsala-masters','copenhagen-masters'].includes(s.adapter)))await attempt(source.id,async()=>{await checkSourcePolicy(source);run(source.id,'scripts/sync-programs.js',['--source',source.id,'--write'],source.id==='daad-international-programmes'?480000:90000);});
  const world=JSON.parse(fs.readFileSync(path.join(dataDir,'world-programme-sources.json'),'utf8'));
  for(const source of world.sources.filter(s=>s.enabled!==false&&(!worldSourceIds||worldSourceIds.includes(s.id))))await attempt(source.id,async()=>{await checkSourcePolicy(source);const result=await require('./sync-world').syncWorld({write:true,sourceId:source.id});if(!result.successfulSources)throw Error('No source snapshot was accepted.');});
  if(!report.sources.some(s=>s.status==='checked'))throw Error('No source succeeded.');
  run('validation','scripts/check-catalog.js');run('validation','scripts/validate-programs.js');run('validation','scripts/validate-funding.js');
  report.status=report.sources.some(s=>s.status==='failed')?'partial':'success';report.lastSuccessfulAt=new Date().toISOString();
 }catch(error){report.status='failed';report.reason=error.message.slice(0,600);for(const[f,bytes]of backup){const file=path.join(dataDir,f);if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}}
 finally{
  if(!write)for(const[f,bytes]of backup){const file=path.join(dataDir,f);if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}
  report.completedAt=new Date().toISOString();report.successfulSources=report.sources.filter(s=>s.status==='checked').length;report.failedSources=report.sources.filter(s=>s.status==='failed').length;
  if(write){fs.writeFileSync(reportFile+'.next',JSON.stringify(report,null,2)+'\n');fs.renameSync(reportFile+'.next',reportFile);}
 }
 return report;
}
if(require.main===module){const args=process.argv.slice(2);if(args.some(a=>!['--write'].includes(a)))throw Error('Usage: node scripts/refresh-catalog.js [--write]');refresh({write:args.includes('--write')}).then(r=>{console.log(JSON.stringify({status:r.status,successfulSources:r.successfulSources,failedSources:r.failedSources}));if(r.status==='failed')process.exitCode=1;}).catch(e=>{console.error(e.message);process.exitCode=1;});}
module.exports={refresh};
