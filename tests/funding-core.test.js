'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Funding = require('../funding-core');
const catalog = require('../Server/data/funding.json');
const programs = require('../Server/data/programs.json').programs;
const asOf = '2026-10-28';
const clone = value => JSON.parse(JSON.stringify(value));
const programme = id => clone(programs.find(program => program.id === id));
function institution(program, overrides = {}) {
    const host = new URL(program.institutionWebsite).hostname.replace(/^www\./, '');
    return { id: program.institutionId || `inst_${host}`, name: program.institutionName || host, countryCode: program.countryCode, website: program.institutionWebsite, domains: [host], ...overrides };
}
function sample(host, countryCode, overrides = {}) {
    return { id: 'program_fixture', institutionId: null, institutionName: host, institutionWebsite: `https://${host}/`, countryCode, title: 'Computer Science', degree: 'master', field: 'computer-science', language: 'en', mode: 'full-time', durationMonths: 24, tuition: { amount: 1000, currency: 'EUR', period: 'year', applicantScope: 'non-eu' }, funding: { fullFunding: null, scholarships: [] }, ...overrides };
}
function assess(id, program, applicant = null, options = {}) {
    return Funding.fundingForProgram(program, program ? institution(program) : null, catalog, applicant, { asOf, ...options }).find(result => result.id === id);
}

test('all 20 sourced schemes validate in CommonJS and browser UMD without network', () => {
    assert.deepEqual(Funding.validateFundingCatalog(catalog), { valid: true, issues: [], schemeCount: 20 });
    const context = { URL };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../funding-core.js'), 'utf8'), context);
    assert.equal(typeof context.FundingCore.fundingForProgram, 'function');
    assert.equal(context.FundingCore.validateFundingCatalog(catalog).valid, true);
    const sources = catalog.schemes.flatMap(scheme => scheme.sources);
    assert(sources.length >= 25);
    for (const source of sources) {
        const url = new URL(source.url);
        assert.equal(url.protocol, 'https:'); assert.equal(url.username, ''); assert.equal(url.password, '');
        assert.match(source.checkedAt,/^\d{4}-\d{2}-\d{2}$/); assert.ok(source.checkedAt<=catalog.metadata.checkedAt); assert(source.label.length > 0);
    }
});

test('validation rejects malformed arrays, unsafe sources, unsupported rules and fabricated award flags without throwing', () => {
    const mutate = [
        data => { data.schemes[0].scope.countryCodes = 'DE'; },
        data => { data.schemes[0].scope.degrees = null; },
        data => { data.schemes[1].scope.programBindings = [null]; },
        data => { data.schemes[0].conditions.checks = {}; },
        data => { data.schemes[0].conditions.unsupportedRule = true; },
        data => { data.schemes[0].sources[0].url = 'javascript:alert(1)'; },
        data => { data.schemes[0].sources[0].url = 'https://name:secret@example.com/'; },
        data => { data.schemes[0].sources[0].checkedAt = '2026-02-30'; },
        data => { data.schemes[0].sources[0].checkedAt = '2027-01-01'; },
        data => { data.schemes[1].scope.programBindings[0].sourceUrl = 'https://unreferenced.example/'; },
        data => { data.schemes[0].coverage.fullFunding = true; },
        data => { data.schemes[0].coverage.tuitionFull = undefined; },
        data => { data.schemes[0].coverage.amount = -1; },
        data => { data.schemes[0].call.deadline = '15 November'; },
        data => { data.schemes[0].call.opensAt = '2027-01-02'; data.schemes[0].call.deadline = '2027-01-01'; },
        data => { data.schemes[0].id = data.schemes[1].id; }
    ];
    for (const change of mutate) {
        const data = clone(catalog); change(data);
        const result = Funding.validateFundingCatalog(data);
        assert.equal(result.valid, false); assert(result.issues.length > 0);
        assert.throws(() => Funding.fundingForProgram(null, null, data), { code: 'INVALID_FUNDING_CATALOG' });
    }
    assert.equal(Funding.validateFundingCatalog(null).valid, false);
    assert.throws(() => assess('funding_daad-epos', sample('uni-goettingen.de', 'DE'), null, { asOf: '2026-02-30' }), { code: 'INVALID_FUNDING_DATE' });
});

test('country and degree alone never confirm national DAAD or Chevening funding', () => {
    const germanMaster = sample('uni-saarland.de', 'DE', { startsInWinterSemester: true });
    const publicUniversity = institution(germanMaster, { stateRecognized: true });
    const daad = Funding.fundingForProgram(germanMaster, publicUniversity, catalog, null, { asOf }).find(result => result.id === 'funding_daad-master-all-disciplines');
    assert.equal(daad.status, 'potential'); assert.equal(daad.associationStatus, 'potential');
    assert.equal(daad.coverage.tuitionFull, false); assert.equal(daad.awardGuaranteed, false);
    assert(daad.missing.length > 0);
    assert.equal(assess('funding_daad-master-all-disciplines', { ...germanMaster, degree: 'bachelor' }).status, 'ineligible');
    assert.equal(assess('funding_daad-master-all-disciplines', sample('example.fr', 'FR')).status, 'ineligible');
    const uk = sample('warwick.ac.uk', 'GB', { durationMonths: 12 });
    const chevening = assess('funding_chevening', uk, { citizenshipCode: 'GE', experienceYears: 5 });
    assert.equal(chevening.status, 'needs-verification'); assert.equal(chevening.associationStatus, 'potential');
    assert.equal(chevening.callStatus, 'closed'); assert(chevening.missing.some(message => message.includes('საათები')));
    assert.equal(assess('funding_chevening', { ...uk, durationMonths: 24 }).status, 'ineligible');
    assert.equal(assess('funding_chevening', { ...uk, mode: 'online' }).status, 'ineligible');
    assert.equal(assess('funding_chevening', uk, { postGraduationWorkHours: 2799 }).status, 'ineligible');
});

test('DAAD excludes exact art subjects and preserves humanities within the arts category', () => {
    const base = sample('uni-saarland.de', 'DE', { startsInWinterSemester: true, category: 'arts' });
    const university = institution(base, { stateRecognized: true });
    const result = program => Funding.fundingForProgram(program, university, catalog, null, { asOf }).find(item => item.id === 'funding_daad-master-all-disciplines');
    assert.equal(result({ ...base, field: 'history' }).status, 'potential');
    assert.equal(result({ ...base, field: 'humanities' }).status, 'potential');
    for (const field of ['design', 'architecture', 'film', 'music', 'fine-arts']) assert.equal(result({ ...base, field }).status, 'ineligible');
    assert.equal(result({ ...base, field: null }).status, 'needs-verification');
});

test('EPOS matches exact imported degree/acronym aliases and rejects other courses at the same university', () => {
    const gottingen = programs.find(program => program.title === 'Development Economics (MSc)' && program.institutionWebsite.includes('uni-goettingen.de'));
    const dresden = programs.find(program => program.title === 'Hydro Science and Engineering (HSE)' && program.institutionWebsite.includes('tu-dresden.de'));
    assert(gottingen && dresden, 'Officially imported programme fixtures must exist.');
    for (const program of [gottingen, dresden]) {
        const result = assess('funding_daad-epos', program);
        assert.equal(result.associationStatus, 'listed');
        assert.equal(result.status, 'needs-verification'); // Imported mode is unknown; it is not fabricated as full-time.
        assert(result.missing.length > 0); assert.equal(result.awardGuaranteed, false);
    }
    assert.equal(assess('funding_daad-epos', dresden).callStatus, 'closed');
    assert.equal(assess('funding_daad-epos', sample('uni-goettingen.de', 'DE')).status, 'ineligible');
    assert.equal(assess('funding_daad-epos', sample('uni-goettingen.de', 'DE', { title: 'Advanced Development Economics' })).status, 'ineligible');
    assert.equal(assess('funding_daad-epos', sample('different-university.de', 'DE', { title: 'Development Economics' })).status, 'ineligible');
    assert.equal(assess('funding_daad-epos', sample('uni-goettingen.de.attacker.example', 'DE', { title: 'Development Economics' })).status, 'ineligible');
    const mide = programs.find(program => /International and Development Economics \(MIDE\)/.test(program.title));
    assert(mide); const excluded = assess('funding_daad-epos', mide);
    assert.equal(excluded.status, 'ineligible'); assert(excluded.reasons.some(reason => reason.includes('MIDE')));
});

test('listed-program scheme does not attach to a known nonpartner institution when no programme is supplied', () => {
    const noProgram = (host, countryCode, schemeId) => Funding.fundingForInstitution({ id: `inst_${host}`, name: host, website: `https://${host}`, domains: [host], countryCode }, [], catalog, null, { asOf }).find(item => item.id === schemeId);
    assert.equal(noProgram('uni-saarland.de', 'DE', 'funding_daad-epos').status, 'ineligible');
    assert.equal(noProgram('taltech.ee', 'EE', 'funding_erasmus-mundus-cybersure').status, 'ineligible');
    const partner = noProgram('tu-dresden.de', 'DE', 'funding_daad-epos');
    assert.equal(partner.status, 'needs-verification'); assert.equal(partner.associationStatus, 'unknown');
    assert.deepEqual(partner.associatedProgramIds, []); assert.equal(partner.appliesToAllPrograms, false);
});

test('EMJM requires exact CYBERSURE title and consortium; its own scheme excludes Aalto general tuition waiver', () => {
    const program = sample('aalto.fi', 'FI', { title: 'Cybersecurity and Assurance', durationMonths: 24 });
    const upcoming = assess('funding_erasmus-mundus-cybersure', program);
    assert.equal(upcoming.associationStatus, 'listed'); assert.equal(upcoming.callStatus, 'not-yet-open'); assert.equal(upcoming.status, 'needs-verification');
    const during = assess('funding_erasmus-mundus-cybersure', program, null, { asOf: '2026-11-20' });
    assert.equal(during.status, 'listed'); assert.equal(during.coverage.tuitionFull, true); assert.equal(during.coverage.livingSupport, true); assert.equal(during.awardGuaranteed, false);
    assert.equal(assess('funding_erasmus-mundus-cybersure', sample('aalto.fi', 'FI')).status, 'ineligible');
    assert.equal(assess('funding_erasmus-mundus-cybersure', sample('taltech.ee', 'EE', { title: program.title })).status, 'ineligible');
    assert.equal(assess('funding_aalto-master-excellence', program).status, 'ineligible');
    assert.equal(assess('funding_aalto-master-excellence', { ...program, title: 'Communications and Data Science (CoDaS)' }).status, 'ineligible');
    assert.equal(assess('funding_erasmus-mundus-cybersure', program, { previousEmjmScholarship: true }, { asOf: '2026-11-20' }).status, 'ineligible');
});

test('DSU Toscana is restricted to explicitly supported universities, with closed calls kept closed', () => {
    const pisa = sample('unipi.it', 'IT');
    assert.equal(assess('funding_dsu-toscana', pisa).associationStatus, 'listed');
    assert.equal(assess('funding_dsu-toscana', pisa).callStatus, 'closed');
    assert.equal(assess('funding_dsu-toscana', programme('program_polimi-computer-science-engineering-msc')).status, 'ineligible');
    assert.equal(assess('funding_dsu-toscana', sample('unibo.it', 'IT')).status, 'ineligible');
    assert.equal(assess('funding_dsu-toscana', { ...pisa, degree: 'phd' }).status, 'ineligible');
});

test('Helsinki and Aalto fee waivers require fee liability and do not become full living-cost funding', () => {
    for (const [programId, schemeId, tuitionFull] of [
        ['program_helsinki-data-science-msc', 'funding_helsinki-master-waiver', null],
        ['program_aalto-computer-science-msc', 'funding_aalto-master-excellence', true]
    ]) {
        const program = programme(programId); const before = clone(program);
        const result = assess(schemeId, program);
        assert.equal(result.status, 'listed'); assert.equal(result.coverage.tuitionFull, tuitionFull); assert.equal(result.coverage.livingSupport, false);
        assert.equal(result.eligibilityStatus, 'needs-verification'); assert.equal(result.awardGuaranteed, false);
        assert.equal(assess(schemeId, program, { citizenshipCode: 'GE', tuitionFeeLiable: false }).status, 'ineligible');
        assert.equal(assess(schemeId, program, { citizenshipCode: 'FI', tuitionFeeLiable: true }).status, 'ineligible');
        assert.equal(assess(schemeId, program, { citizenshipCode: 'GE', citizenshipCodes: ['GE', 'DE'], tuitionFeeLiable: true }).status, 'ineligible');
        assert.equal(assess(schemeId, { ...program, degree: 'bachelor' }).status, 'ineligible');
        assert.deepEqual(program, before); assert.equal(program.funding.fullFunding, null);
    }
    assert.equal(assess('funding_aalto-master-excellence', programme('program_aalto-collaborative-industrial-design-ma')).status, 'listed');
});

test('TUM enrolled-semester conditions cannot be satisfied by a future new applicant', () => {
    const program = programme('program_tum-informatics-msc');
    assert.equal(assess('funding_tum-international-grant', program, { enrolled: false, semester: 1 }).status, 'ineligible');
    assert.equal(assess('funding_tum-international-grant', program, { enrolled: true, semester: 1 }).status, 'ineligible');
    const exception = assess('funding_tum-international-grant', program, { enrolled: true, semester: 1, priorTumBachelor: true });
    assert.notEqual(exception.status, 'ineligible'); assert.equal(exception.callStatus, 'closed');
    assert.equal(exception.coverage.tuitionFull, false);
    assert.equal(assess('funding_tum-international-grant', { ...program, degree: 'bachelor' }, { enrolled: true, semester: 2 }).status, 'ineligible');
});

test('ETH ESOP uses published 2027 call dates and rejects previous masters and MAS', () => {
    const program = sample('ethz.ch', 'CH');
    const before = assess('funding_eth-esop', program);
    assert.equal(before.callStatus, 'not-yet-open'); assert.equal(before.status, 'needs-verification');
    const open = assess('funding_eth-esop', program, null, { asOf: '2026-11-10' });
    assert.equal(open.callStatus, 'open'); assert.equal(open.status, 'listed'); assert.equal(open.coverage.amount, 13500); assert.equal(open.coverage.currency, 'CHF');
    assert.equal(assess('funding_eth-esop', program, null, { asOf: '2026-12-01' }).callStatus, 'closed');
    assert.equal(assess('funding_eth-esop', program, { alreadyHasMasterDegree: true }).status, 'ineligible');
    assert.equal(assess('funding_eth-esop', { ...program, qualificationType: 'mas' }).status, 'ineligible');
});

test('Oxford, Gates and Eiffel respect course-specific and nomination restrictions', () => {
    const oxford = programme('program_oxford-advanced-computer-science-msc');
    assert.equal(assess('funding_oxford-clarendon', oxford).status, 'listed');
    assert.equal(assess('funding_oxford-clarendon', { ...oxford, qualificationType: 'pgcert' }).status, 'ineligible');
    assert.equal(assess('funding_oxford-clarendon', oxford, { deferredOxfordOffer: true }).status, 'ineligible');
    const cambridge = programme('program_cambridge-computer-science-phd');
    assert.equal(assess('funding_gates-cambridge', cambridge).status, 'needs-verification');
    assert.equal(assess('funding_gates-cambridge', { ...cambridge, gatesCourseEligible: false }).status, 'ineligible');
    assert.equal(assess('funding_gates-cambridge', { ...cambridge, gatesCourseEligible: true }).status, 'listed');
    const sciencesPo = assess('funding_eiffel-paris-saclay', programme('program_sciencespo-public-policy-master'));
    assert.equal(sciencesPo.status, 'ineligible'); assert(sciencesPo.reasons.some(reason => reason.includes('Sciences Po')));
    const saclay = sample('universite-paris-saclay.fr', 'FR');
    assert.equal(assess('funding_eiffel-paris-saclay', saclay).status, 'needs-verification');
    assert.equal(assess('funding_eiffel-paris-saclay', { ...saclay, eiffelAccreditedDegreeEligible: true }, { institutionNomination: false }).status, 'ineligible');
    assert.equal(assess('funding_eiffel-paris-saclay', saclay, { citizenshipCode: 'FR' }).status, 'ineligible');
    assert.equal(assess('funding_eiffel-paris-saclay', saclay).call.deadline, '2026-11-26');
});

test('institution aggregation names only associated programme IDs and never implies all programmes are funded', () => {
    const master = programme('program_aalto-computer-science-msc'); const bachelor = programme('program_aalto-economics-bsc');
    const other = programme('program_helsinki-data-science-msc'); const university = institution(master);
    const result = Funding.fundingForInstitution(university, [master, bachelor, other], catalog, null, { asOf }).find(item => item.id === 'funding_aalto-master-excellence');
    assert.equal(result.status, 'listed'); assert.equal(result.aggregate, true); assert.equal(result.appliesToAllPrograms, false); assert.equal(result.programId, null);
    assert.deepEqual(result.associatedProgramIds, [master.id]);
    assert.equal(result.programAssessments.length, 2);
    assert.equal(result.programAssessments.find(item => item.programId === bachelor.id).status, 'ineligible');
    const noPrograms = Funding.fundingForInstitution(university, [], catalog, null, { asOf }).find(item => item.id === result.id);
    assert.equal(noPrograms.status, 'needs-verification'); assert.deepEqual(noPrograms.associatedProgramIds, []);
});

test('unknown facts, stale sources, mismatched context and output mutation remain conservative', () => {
    const program = sample('aalto.fi', 'FI');
    assert.equal(assess('funding_aalto-master-excellence', { ...program, mode: null }).status, 'needs-verification');
    const mismatched = Funding.fundingForProgram(program, institution(sample('helsinki.fi', 'FI')), catalog, null, { asOf });
    assert(mismatched.every(result => result.status === 'ineligible'));
    const stale = assess('funding_aalto-master-excellence', program, null, { asOf: '2028-11-01' });
    assert.equal(stale.status, 'needs-verification');
    const result = assess('funding_aalto-master-excellence', program);
    result.coverage.livingSupport = true; result.sources[0].url = 'https://example.com/forged';
    const again = assess('funding_aalto-master-excellence', program);
    assert.equal(again.coverage.livingSupport, false); assert(again.sources[0].url.includes('aalto.fi'));
    assert.throws(() => Funding.fundingForProgram([], null, catalog), { code: 'INVALID_FUNDING_CONTEXT' });
    assert.throws(() => Funding.fundingForInstitution(institution(program), [], catalog, []), { code: 'INVALID_FUNDING_CONTEXT' });
    assert.deepEqual([...Funding.STATUSES].sort(), ['ineligible', 'listed', 'needs-verification', 'potential']);
});
