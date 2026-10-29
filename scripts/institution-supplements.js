'use strict';
const registry=require('../Server/data/additional-institutions.json');
const {validateDirectory}=require('./sync-institutions');
function applyInstitutionSupplements(directory,supplements=registry){
    if(!directory?.metadata||!Array.isArray(directory.institutions)||!Array.isArray(supplements?.institutions))throw Error('Institution supplements require explicit directory metadata and verified records.');
    const institutions=[...directory.institutions],ids=new Set(institutions.map(i=>i.id));
    for(const row of supplements.institutions){
        if(ids.has(row.id))continue;
        const owner=new URL(row.website).hostname.replace(/^www\./,'');
        const evidenceHost=new URL(row.source.url).hostname.replace(/^www\./,'');
        if(!row.source?.retrievedAt||!row.source?.url||!row.domains.includes(owner)||!(evidenceHost===owner||evidenceHost.endsWith('.'+owner)))throw Error('Supplement requires institution-owned source evidence.');
        if(institutions.some(i=>i.countryCode===row.countryCode&&i.domains.some(h=>row.domains.includes(h))))throw Error('A supplement must not duplicate an existing institution domain.');
        institutions.push(structuredClone(row));ids.add(row.id);
    }
    const result={metadata:{...directory.metadata,institutionCount:institutions.length,countryCount:new Set(institutions.map(i=>i.countryCode)).size,supplementalInstitutionCount:institutions.filter(i=>i.verificationStatus==='official-institution-listed').length,licenseScope:'The upstream MIT licence applies to the Hipo directory. Supplemental institution facts retain their individually cited official sources.'},institutions};
    const errors=validateDirectory(result);if(errors.length)throw Error('Invalid institution supplements: '+errors.slice(0,3).join('; '));
    return result;
}
module.exports={applyInstitutionSupplements};
