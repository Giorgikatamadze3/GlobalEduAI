'use strict';

const Core = require('../../catalog-core');
const SOURCE_ID = 'daad-international-programmes';
const SOURCE_URL = 'https://www2.daad.de/deutschland/studienangebote/international-programmes/';
const SEARCH_URL = new URL('api/solr/en/search.json', SOURCE_URL).href;
const DEGREE_BY_TYPE = Object.freeze({1:'bachelor', 2:'master', 3:'phd'});
const SUBFIELDS_BY_ID = new Map(Core.SUBFIELDS.map(field => [field.value, field]));
const SUBJECT_FIELDS = Object.freeze({
    'computer science':'computer-science', informatics:'computer-science',
    'artificial intelligence':'artificial-intelligence', 'data science':'data-science',
    cybersecurity:'cybersecurity', 'it security':'cybersecurity', 'software engineering':'software-engineering',
    engineering:'engineering', 'mechanical engineering':'engineering', 'electrical engineering':'engineering',
    'civil engineering':'engineering', 'chemical engineering':'engineering',
    business:'business', 'business administration':'business', 'business studies':'business',
    management:'management', finance:'finance', marketing:'marketing', economics:'economics',
    'social sciences':'social-sciences', 'public policy':'public-policy', law:'law',
    design:'design', architecture:'architecture', humanities:'humanities',
    medicine:'medicine', healthcare:'healthcare', 'public health':'healthcare',
    'natural sciences':'natural-sciences', biology:'biology', physics:'physics', mathematics:'mathematics',
    hospitality:'hospitality', tourism:'hospitality'
});
const LANGUAGE_CODES = Object.freeze({
    english:'en', german:'de', french:'fr', spanish:'es', italian:'it', portuguese:'pt',
    dutch:'nl', swedish:'sv', finnish:'fi', polish:'pl', czech:'cs', turkish:'tr',
    japanese:'ja', korean:'ko', chinese:'zh', georgian:'ka'
});
const ENTITIES = Object.freeze({
    amp:'&', quot:'"', apos:"'", nbsp:' ', lt:'<', gt:'>', ndash:'–', mdash:'—',
    lsquo:'‘', rsquo:'’', ldquo:'“', rdquo:'”', auml:'ä', ouml:'ö', uuml:'ü',
    Auml:'Ä', Ouml:'Ö', Uuml:'Ü', szlig:'ß', eacute:'é', Eacute:'É'
});

function text(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, entity) => {
        if (entity.startsWith('#')) {
            const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
            return Number.isSafeInteger(number) && number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : whole;
        }
        return ENTITIES[entity] ?? whole;
    }).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function safeExternalURL(value) {
    try {
        const url = new URL(text(value));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
            !/^[a-z\d][a-z\d.-]*\.[a-z]{2,}$/i.test(url.hostname) ||
            /(?:^|\.)(?:daad\.de|gate-germany\.de|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com)$/.test(url.hostname)) return null;
        url.hash = '';
        return url.href;
    } catch { return null; }
}

function courseURL(row) {
    const id = String(row.id ?? '');
    if (!/^\d+$/.test(id)) throw new Error('DAAD returned a course without a valid numeric identity.');
    const url = new URL(String(row.link || ''), SOURCE_URL);
    const expected = new URL(`en/detail/${id}/`, SOURCE_URL);
    if (url.href !== expected.href) throw new Error(`DAAD returned an unexpected course-detail URL for ${id}.`);
    return url.href;
}

function readInstitutionLinks(html, institutionName) {
    const anchors = [...html.matchAll(/<a\b([^>]{0,12000})>([\s\S]*?)<\/a>/gi)].map(match => {
        const href = match[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
        return {attributes:match[1], label:text(match[2]), url:href ? safeExternalURL(href[1] ?? href[2]) : null};
    });
    const name = text(institutionName).toLocaleLowerCase('en');
    const institution = anchors.find(anchor => anchor.url &&
        /\bc-contact__link\b/.test(anchor.attributes) && anchor.label.toLocaleLowerCase('en') === name);
    const course = anchors.find(anchor => anchor.url && anchor.label.toLocaleLowerCase('en') === 'course website');
    return {institutionWebsite:institution?.url || null, universityProgramUrl:course?.url || null};
}

function boundedInteger(value, fallback, maximum, name) {
    const result = value === undefined ? fallback : Number(value);
    if (!Number.isInteger(result) || result < 1 || result > maximum) throw new Error(`${name} must be an integer from 1 to ${maximum}.`);
    return result;
}

async function pause(milliseconds, signal) {
    signal?.throwIfAborted();
    if (milliseconds <= 0) return;
    await new Promise((resolve, reject) => {
        const timer = setTimeout(done, milliseconds);
        function done() { signal?.removeEventListener('abort', aborted); resolve(); }
        function aborted() { clearTimeout(timer); signal?.removeEventListener('abort', aborted); reject(signal.reason); }
        signal?.addEventListener('abort', aborted, {once:true});
    });
}

function createRequester({fetchImpl, signal, requestIntervalMs}) {
    let nextRequestAt = 0;
    return async function request(url, format) {
        for (let attempt = 0; attempt < 3; attempt++) {
            signal?.throwIfAborted();
            const scheduled = Math.max(Date.now(), nextRequestAt);
            nextRequestAt = scheduled + requestIntervalMs;
            await pause(scheduled - Date.now(), signal);
            let response;
            try {
                const timeout = AbortSignal.timeout(20000);
                response = await fetchImpl(url, {
                    headers:{Accept:format === 'json' ? 'application/json' : 'text/html', 'User-Agent':'GlobalEduAI-Catalog/1.0 (+https://www2.daad.de/)'},
                    signal:signal ? AbortSignal.any([signal, timeout]) : timeout
                });
            } catch (error) {
                signal?.throwIfAborted();
                if (attempt === 2) throw error;
                await pause(500 * (attempt + 1), signal);
                continue;
            }
            if (!response.ok) {
                if ([429, 502, 503, 504].includes(response.status) && attempt < 2) {
                    const retryHeader = response.headers?.get('retry-after');
                    const seconds = retryHeader === null || retryHeader === undefined ? NaN : Number(retryHeader);
                    const dateDelay = Date.parse(retryHeader || '') - Date.now();
                    const wait = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(dateDelay) ? dateDelay : 500 * (attempt + 1);
                    await pause(Math.min(60000, Math.max(0, wait)), signal);
                    continue;
                }
                throw new Error(`DAAD request failed with HTTP ${response.status}: ${url}`);
            }
            if (response.url && !['www2.daad.de', 'ip.daad.de'].includes(new URL(response.url).hostname)) {
                throw new Error('DAAD request redirected outside the official catalog hosts.');
            }
            return format === 'json' ? response.json() : response.text();
        }
        throw new Error('DAAD request exhausted its retries.');
    };
}

async function fetchOfficialCatalog(source, options = {}) {
    const sourceId = typeof source === 'string' ? source : source?.id;
    if (sourceId !== SOURCE_ID) throw new Error(`Unsupported official catalog source: ${sourceId || '(missing)'}`);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
    const signal = options.signal;
    const maxPages = boundedInteger(options.maxPages, 50, 100, 'maxPages');
    const pageSize = boundedInteger(options.pageSize, 250, 500, 'pageSize');
    const concurrency = boundedInteger(options.institutionConcurrency, 3, 4, 'institutionConcurrency');
    const requestIntervalMs = options.requestIntervalMs === undefined ? 250 : Number(options.requestIntervalMs);
    if (!Number.isFinite(requestIntervalMs) || requestIntervalMs < 0 || requestIntervalMs > 60000) throw new Error('requestIntervalMs must be from 0 to 60000.');
    const asOf = new Date().toISOString().slice(0, 10);
    const request = createRequester({fetchImpl, signal, requestIntervalMs});
    const rows = new Map();
    const totals = new Set();
    const excludedCourseTypes = {};
    let totalReported = null, rawRecordsFetched = 0, pagesFetched = 0, duplicateRecords = 0, listingComplete = false;

    for (let page = 0; page < maxPages; page++) {
        const url = new URL(SEARCH_URL);
        for (const type of ['1', '2', '3']) url.searchParams.append('degree[]', type);
        url.searchParams.set('sort', '4');
        url.searchParams.set('display', 'list');
        url.searchParams.set('limit', String(pageSize));
        url.searchParams.set('offset', String(rawRecordsFetched));
        const listingSourceUrl = url.href;
        const data = await request(listingSourceUrl, 'json');
        if (!Array.isArray(data?.courses) || !Number.isSafeInteger(data.numResults) || data.numResults < 0 || data.numResults > 100000) {
            throw new Error('DAAD returned an unexpected catalog response shape.');
        }
        if (data.numResults === 0) throw new Error('DAAD reported an empty catalog; refusing to replace an existing snapshot.');
        totals.add(data.numResults);
        totalReported = data.numResults;
        pagesFetched++;
        if (!data.courses.length && rawRecordsFetched < totalReported) throw new Error('DAAD pagination ended before its reported total.');
        for (const row of data.courses) {
            if (!Object.hasOwn(DEGREE_BY_TYPE, row.courseType)) {
                const key = String(row.courseType ?? 'unknown');
                excludedCourseTypes[key] = (excludedCourseTypes[key] || 0) + 1;
                continue;
            }
            const detailUrl = courseURL(row);
            if (!text(row.courseName) || !text(row.academy)) throw new Error('DAAD returned a degree without its title or institution.');
            const key = String(row.id);
            if (rows.has(key)) duplicateRecords++;
            else rows.set(key, {...row, programUrl:detailUrl, listingSourceUrl});
        }
        rawRecordsFetched += data.courses.length;
        options.onProgress?.({phase:'listing', pagesFetched, rawRecordsFetched, totalReported});
        if (rawRecordsFetched >= totalReported) { listingComplete = true; break; }
    }

    const institutions = new Map();
    for (const row of rows.values()) {
        const key = text(row.academy);
        if (!institutions.has(key)) institutions.set(key, []);
        institutions.get(key).push(row);
    }
    const entries = [...institutions.entries()];
    const identity = new Map();
    const detailsByCourse = new Map();
    const lookupFailures = [];
    let cursor = 0, institutionsChecked = 0;
    async function worker() {
        while (cursor < entries.length) {
            const [name, candidates] = entries[cursor++];
            signal?.throwIfAborted();
            let found = null, reason = 'No exact institution contact link was published.';
            // A second course is a bounded fallback when an institution's first
            // course detail is temporarily unavailable or has no contact link.
            for (const candidate of candidates.slice(0, 2)) {
                try {
                    const html = await request(candidate.programUrl, 'html');
                    const links = readInstitutionLinks(html, name);
                    detailsByCourse.set(String(candidate.id), links);
                    if (links.institutionWebsite) {
                        found = {...links, evidenceUrl:candidate.programUrl};
                        break;
                    }
                } catch (error) {
                    signal?.throwIfAborted();
                    reason = error.message;
                }
            }
            identity.set(name, found);
            if (!found) lookupFailures.push({institutionName:name, reason});
            institutionsChecked++;
            options.onProgress?.({phase:'institutions', institutionsChecked, totalInstitutions:entries.length});
        }
    }
    await Promise.all(Array.from({length:Math.min(concurrency, entries.length)}, () => worker()));

    const records = [...rows.values()].map(row => {
        const institutionName = text(row.academy);
        const institution = identity.get(institutionName);
        const sourceLanguages = [...new Set((Array.isArray(row.languages) ? row.languages : []).map(text).filter(Boolean))];
        const languages = [...new Set(sourceLanguages.map(language => LANGUAGE_CODES[language.toLocaleLowerCase('en')]).filter(Boolean))];
        const subject = text(row.subject) || null;
        // Only exact published discipline labels are mapped. Programme titles,
        // keyword fragments and catalog-wide filter counts are never evidence.
        const discipline = subject ? SUBFIELDS_BY_ID.get(SUBJECT_FIELDS[subject.toLocaleLowerCase('en')]) : null;
        const record = {
            sourceId:SOURCE_ID, sourceRecordId:String(row.id), institutionName,
            institutionWebsite:institution?.institutionWebsite || null,
            institutionEvidenceUrl:institution?.evidenceUrl || null,
            countryCode:'DE', title:text(row.courseName), degree:DEGREE_BY_TYPE[row.courseType],
            language:sourceLanguages.length === 1 && languages.length === 1 ? languages[0] : null,
            languages, sourceLanguages,
            languageNote:sourceLanguages.length > 1 ? 'DAAD lists multiple teaching languages; this does not establish an English-only route.' : null,
            programUrl:row.programUrl, sourceUrl:row.programUrl, listingSourceUrl:row.listingSourceUrl,
            checkedAt:asOf, field:discipline?.value || null, category:discipline?.category || null, mode:null,
            subject, city:text(row.city) || null
        };
        const exactDetail = detailsByCourse.get(String(row.id));
        if (exactDetail?.universityProgramUrl) record.universityProgramUrl = exactDetail.universityProgramUrl;
        return record;
    });
    const unresolvedRecords = records.filter(record => !record.institutionWebsite).length;
    return {
        records,
        coverage:{
            sourceId:SOURCE_ID,
            complete:listingComplete && totals.size === 1 && duplicateRecords === 0 && unresolvedRecords === 0,
            listingComplete, totalReported, recordsFetched:records.length, rawRecordsFetched,
            pagesFetched, maxPages, pageSize, excludedCourseTypes, duplicateRecords,
            institutionsChecked, unresolvedRecords, lookupFailures, asOf,
            scope:'DAAD International Programmes listings with courseType 1/2/3. This is a curated subset of German programmes, not complete German or worldwide coverage.'
        }
    };
}

module.exports = {fetchOfficialCatalog};
