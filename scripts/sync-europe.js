'use strict';
const fs=require('node:fs'),path=require('node:path');
const Core=require('../catalog-core');
const {mergeProgramCatalog,computeProgramCoverage}=require('../program-catalog-core');
const {validatePrograms}=require('./validate-programs');
const {applyInstitutionOverrides}=require('./institution-overrides');
const {applyInstitutionSupplements}=require('./institution-supplements');
const ROOT=path.resolve(__dirname,'..');
function syncEurope({write=false}={}){
    const seed=JSON.parse(fs.readFileSync(path.join(ROOT,'Server/data/europe-programme-seeds.json'),'utf8'));
    const directory=applyInstitutionSupplements(applyInstitutionOverrides(JSON.parse(fs.readFileSync(path.join(ROOT,'Server/data/institutions.json'),'utf8'))));
    const registryFile=path.join(ROOT,'Server/data/program-source-registry.json'),registry=JSON.parse(fs.readFileSync(registryFile,'utf8'));
    const file=path.join(ROOT,'Server/data/programs.json'),existing=JSON.parse(fs.readFileSync(file,'utf8'));
    const groups=new Map();
    for(const row of seed.records){
        const host=new URL(row.institutionWebsite).hostname.replace(/^www\./,'');
        const candidates=directory.institutions.filter(i=>i.countryCode===row.countryCode&&i.domains.includes(host));
        if(candidates.length!==1)throw Error(`Official institution link must be unique: ${row.countryCode} ${host}`);
        const field=row.field?Core.SUBFIELDS.find(f=>f.value===row.field):null;if(row.field&&!field)throw Error('Unknown verified discipline '+row.field);
        const sourceId=row.sourceId||'europe-'+host.replace(/\./g,'-');
        const records=groups.get(sourceId)||[];records.push({...row,sourceId,sourceRecordId:row.sourceRecordId||row.programUrl,institutionName:candidates[0].name,category:field?.category||null});groups.set(sourceId,records);
    }
    let programs=existing.programs;const reports=[];
    for(const [id,records] of groups){
        const host=new URL(records[0].institutionWebsite).hostname.replace(/^www\./,'');
        const source={id,name:records[0].sourceName||`${records[0].institutionName} — verified official programme sources`,kind:records[0].sourceKind||'institution',url:records[0].registryUrl||'https://'+host+'/',countryCodes:[...new Set(records.map(r=>r.countryCode))],institutionDomains:[...new Set(records.map(r=>new URL(r.institutionWebsite).hostname.replace(/^www\./,'')))],checkedAt:seed.metadata.checkedAt,enabled:false,status:'curated-official-snapshot',scope:'Individually verified programme entries, not all programmes of a university or country. Unpublished attributes remain unknown.'};
        const result=mergeProgramCatalog({existingPrograms:programs,records,source,directory,checkedAt:seed.metadata.checkedAt});
        if(result.report.invalid||result.report.ambiguous||result.report.unmatched)throw Error(`European seed import rejected ${id}: ${JSON.stringify(result.report.issues.slice(0,2))}`);
        programs=result.programs;reports.push({sourceId:id,...result.report,issues:undefined});
        const position=registry.sources.findIndex(s=>s.id===id);if(position<0)registry.sources.push(source);else registry.sources[position]=source;
    }
    const coverage=computeProgramCoverage(directory.institutions,programs,registry);
    const catalog={metadata:{...existing.metadata,programCount:programs.length,updatedAt:seed.metadata.checkedAt,programCoverage:coverage,europeSeedCount:seed.records.length},programs};
    const errors=validatePrograms(catalog,{sources:registry.sources});if(errors.length)throw Error('European programmes failed validation: '+errors.slice(0,4).join('; '));
    if(write){
        try{
            fs.writeFileSync(file+'.next',JSON.stringify(catalog,null,2)+'\n');
            fs.writeFileSync(registryFile+'.next',JSON.stringify({...registry,metadata:{...registry.metadata,updatedAt:seed.metadata.checkedAt}},null,2)+'\n');
            fs.renameSync(registryFile+'.next',registryFile);fs.renameSync(file+'.next',file);
        }finally{for(const temporary of [file+'.next',registryFile+'.next'])if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
    }
    return {write,programCount:programs.length,institutionsWithPrograms:coverage.institutionsWithPrograms,europeanSeedRecords:seed.records.length,reports};
}
if(require.main===module){const args=process.argv.slice(2);if(args.some(a=>a!=='--write'))throw Error('Usage: node scripts/sync-europe.js [--write]');try{console.log(JSON.stringify(syncEurope({write:args.includes('--write')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={syncEurope};
