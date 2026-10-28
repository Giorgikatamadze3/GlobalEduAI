'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {fetchOfficialCatalog} = require('../scripts/providers/official-catalogs');
const registry = require('../Server/data/program-source-registry.json');
const source = registry.sources.find(item => item.id === 'daad-international-programmes');
const base = 'https://www2.daad.de/deutschland/studienangebote/international-programmes/';

function course(id, values = {}) {
    return {
        id, academy:'Example University', courseName:`Programme ${id}`, courseType:2,
        languages:['English'], subject:'Computer Science', city:'Example City',
        link:`/deutschland/studienangebote/international-programmes/en/detail/${id}/`,
        tuitionFees:'No tuition fees', isElearning:false,
        ...values
    };
}

function detail(name = 'Example University', website = 'https://example-university.de/') {
    return `<div class="c-contact"><a class="c-contact__link" href="${website}">${name.replace(/&/g, '&amp;')}</a></div><a href="https://example-university.de/programme">Course website</a>`;
}

function mockedProvider(rows, {details, overrides} = {}) {
    const calls = [];
    const fetchImpl = async address => {
        calls.push(address);
        const url = new URL(address);
        if (overrides) {
            const response = overrides(url, calls);
            if (response) return response;
        }
        if (url.pathname.endsWith('search.json')) {
            const offset = Number(url.searchParams.get('offset'));
            const limit = Number(url.searchParams.get('limit'));
            return new Response(JSON.stringify({courses:rows.slice(offset, offset + limit), numResults:rows.length}), {headers:{'Content-Type':'application/json'}});
        }
        const id = url.pathname.match(/\/detail\/(\d+)\//)?.[1];
        const row = rows.find(item => String(item.id) === id);
        const html = details ? details(row) : detail(row.academy);
        return html instanceof Response ? html : new Response(html, {headers:{'Content-Type':'text/html'}});
    };
    return {fetchImpl, calls};
}

const fast = {requestIntervalMs:0};

test('DAAD pagination imports actual degree rows, caches institution proof and retains unknown facts', async () => {
    const rows = [course(1), course(2, {courseType:1}), course(3, {courseType:3}), course(4, {courseType:4}), course(5)];
    const provider = mockedProvider(rows);
    const result = await fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl, pageSize:2});
    assert.equal(result.records.length, 4);
    assert.deepEqual(result.records.map(record => record.degree), ['master', 'bachelor', 'phd', 'master']);
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.listingComplete, true);
    assert.equal(result.coverage.totalReported, 5);
    assert.equal(result.coverage.rawRecordsFetched, 5);
    assert.deepEqual(result.coverage.excludedCourseTypes, {'4':1});
    assert.equal(result.coverage.institutionsChecked, 1);
    assert.equal(provider.calls.filter(address => address.includes('/detail/')).length, 1);
    assert.deepEqual(provider.calls.filter(address => address.includes('search.json')).map(address => new URL(address).searchParams.get('offset')), ['0','2','4']);
    assert.deepEqual(new URL(provider.calls[0]).searchParams.getAll('degree[]'), ['1','2','3']);
    for (const record of result.records) {
        assert.equal(record.institutionWebsite, 'https://example-university.de/');
        assert.equal(record.countryCode, 'DE');
        assert.equal(record.field, 'computer-science');
        assert.equal(record.category, 'tech');
        assert.equal(record.mode, null);
        assert.equal(record.tuition, undefined);
        assert.equal(record.scholarships, undefined);
        assert.equal(record.subject, 'Computer Science');
        assert.equal(record.language, 'en');
        assert.ok(record.programUrl.startsWith(base));
        assert.equal(record.sourceUrl, record.programUrl);
        assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(record.sourceId, source.id);
        assert.ok(new URL(record.listingSourceUrl).searchParams.has('offset'));
    }
    assert.equal(result.records[0].universityProgramUrl, 'https://example-university.de/programme');
    assert.equal(result.records[1].universityProgramUrl, undefined, 'A university programme URL is not reused for a different course.');
});

test('mixed or unsupported languages never become an English-only claim', async () => {
    const rows = [course(1, {languages:['English','German']}), course(2, {languages:['English','Russian']}), course(3, {languages:null})];
    const provider = mockedProvider(rows);
    const {records} = await fetchOfficialCatalog(source.id, {...fast, fetchImpl:provider.fetchImpl});
    assert.deepEqual(records[0].languages, ['en','de']);
    assert.equal(records[0].language, null);
    assert.match(records[0].languageNote, /multiple teaching languages/);
    assert.equal(records[1].language, null);
    assert.deepEqual(records[1].sourceLanguages, ['English','Russian']);
    assert.deepEqual(records[2].languages, []);
    assert.equal(records[2].language, null);
});

test('only exact published disciplines map to the controlled taxonomy', async () => {
    const rows = [
        course(1, {subject:'Physics'}), course(2, {subject:'Economics'}), course(3, {subject:'Law'}),
        course(4, {subject:'Mathematics'}), course(5, {subject:'Physics and Economics'}),
        course(6, {subject:null, courseName:'Computer Science MSc'})
    ];
    const provider = mockedProvider(rows);
    const {records} = await fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl});
    assert.deepEqual(records.map(record => [record.field, record.category]), [
        ['physics','science'], ['economics','business'], ['law','social'], ['mathematics','science'],
        [null,null], [null,null]
    ]);
    assert.equal(records[4].subject, 'Physics and Economics');
});

test('a page limit yields explicit partial source coverage', async () => {
    const provider = mockedProvider([course(1),course(2),course(3)]);
    const result = await fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl, pageSize:2, maxPages:1});
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.listingComplete, false);
    assert.equal(result.coverage.totalReported, 3);
    assert.equal(result.coverage.recordsFetched, 2);
    assert.equal(result.coverage.pagesFetched, 1);
});

test('failed institution lookups keep exact listings unresolved for quarantine', async () => {
    const provider = mockedProvider([course(1),course(2)], {details:() => new Response('Not found', {status:404})});
    const result = await fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl});
    assert.equal(result.records.length, 2);
    assert.ok(result.records.every(record => record.institutionWebsite === null));
    assert.equal(result.coverage.complete, false);
    assert.equal(result.coverage.listingComplete, true);
    assert.equal(result.coverage.unresolvedRecords, 2);
    assert.equal(result.coverage.lookupFailures.length, 1);
    assert.equal(provider.calls.filter(address => address.includes('/detail/')).length, 2);
});

test('institution domain evidence needs an exact contact name and cannot use unrelated links', async () => {
    const provider = mockedProvider([course(1, {academy:'A & B University'})], {
        details:() => `${detail('Different University', 'https://wrong-school.de/')}<a class="c-contact__link" href="https://a-and-b.de/">A &amp; B University</a>`
    });
    const result = await fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl});
    assert.equal(result.records[0].institutionWebsite, 'https://a-and-b.de/');
    assert.ok(result.records[0].institutionEvidenceUrl.endsWith('/detail/1/'));
});

test('temporary rate limiting is retried within a bounded request count', async () => {
    let limited = false;
    const provider = mockedProvider([course(1)], {overrides:url => {
        if (url.pathname.endsWith('search.json') && !limited) {
            limited = true;
            return new Response('Wait', {status:429, headers:{'Retry-After':'0'}});
        }
    }});
    const result = await fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl});
    assert.equal(result.records.length, 1);
    assert.equal(provider.calls.filter(address => address.includes('search.json')).length, 2);
});

test('listing failure rejects rather than presenting an empty successful snapshot', async () => {
    const unavailable = mockedProvider([], {overrides:() => new Response('Unavailable', {status:403})});
    await assert.rejects(fetchOfficialCatalog(source, {...fast, fetchImpl:unavailable.fetchImpl}), /HTTP 403/);
    assert.equal(unavailable.calls.length, 1);
    const empty = mockedProvider([]);
    await assert.rejects(fetchOfficialCatalog(source, {...fast, fetchImpl:empty.fetchImpl}), /empty catalog/);
});

test('malformed or off-domain course identities are rejected before fetching external pages', async () => {
    const provider = mockedProvider([course(1, {link:'https://unrelated.example/detail/1/'})]);
    await assert.rejects(fetchOfficialCatalog(source, {...fast, fetchImpl:provider.fetchImpl}), /unexpected course-detail URL/);
    assert.equal(provider.calls.length, 1);
});

test('unsupported sources and invalid pagination bounds fail before network access', async () => {
    const fetchImpl = () => {throw new Error('No network call expected.');};
    await assert.rejects(fetchOfficialCatalog('unknown', {fetchImpl}), /Unsupported official catalog source/);
    await assert.rejects(fetchOfficialCatalog(source, {fetchImpl, maxPages:0}), /maxPages/);
    await assert.rejects(fetchOfficialCatalog(source, {fetchImpl, institutionConcurrency:5}), /institutionConcurrency/);
});

test('registry separates the enabled limited-scope source from unimplemented candidates', () => {
    assert.equal(source.kind, 'official-directory');
    assert.equal(source.enabled, true);
    assert.deepEqual(source.countryCodes, ['DE']);
    assert.match(source.coverageNote, /not all programmes/);
    assert.equal(source.license.status, 'copyright-stated-no-open-data-licence-confirmed');
    assert.ok(registry.sources.filter(item => !item.enabled).every(item => item.adapter === null));
});
