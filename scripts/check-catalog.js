'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateDirectory } = require('./sync-institutions');
const file = path.resolve(__dirname, '../Server/data/institutions.json');
try {
    const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
    const errors = validateDirectory(catalog);
    if (errors.length) {
        console.error(errors.slice(0, 30).join('\n'));
        console.error(`${errors.length} directory validation error(s).`);
        process.exitCode = 1;
    } else {
        console.log(`Directory valid: ${catalog.metadata.institutionCount.toLocaleString('en-US')} institutions across ${catalog.metadata.countryCount} countries/territories. Source: ${catalog.metadata.sourceName}; retrieved ${catalog.metadata.retrievedAt}.`);
    }
} catch (error) { console.error(`Directory validation failed: ${error.message}`); process.exitCode = 1; }
