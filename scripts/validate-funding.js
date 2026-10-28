'use strict';
const path=require('node:path');const fs=require('node:fs');
const {validateFundingCatalog}=require('../funding-core');
function main(){const data=JSON.parse(fs.readFileSync(path.join(__dirname,'../Server/data/funding.json'),'utf8'));const result=validateFundingCatalog(data);if(!result.valid){console.error(result.issues.join('\n'));process.exitCode=1;}else console.log(`Funding valid: ${result.schemeCount} official-source schemes; awards and personal eligibility remain conditional.`);}
if(require.main===module)main();
module.exports={validateFundingCatalog};
