# Worldwide programme expansion — 2026-11-03

The previous directory had 1,945 programme records. Germany dominated because DAAD was the only large national import; most other countries had a small curated snapshot. This update adds 2433 master programme records through 19 official institutional indexes.

Current totals: **4378 programme records**, **59 countries**, **6 continents**, **207 institutions with programme records**. The larger institution directory remains separate (10,270 institutions); it is not proof that every institution’s programmes are imported. Totals include the existing bachelor/master/doctoral records; this batch adds master-level programmes.

| Region | Programme records |
| --- | ---: |
| europe | 2917 |
| north-america | 945 |
| south-america | 134 |
| asia | 166 |
| africa | 122 |
| oceania | 94 |

| Country | Programme records |
| --- | ---: |
| Canada | 212 |
| Chile | 134 |
| Germany | 1659 |
| Spain | 114 |
| France | 74 |
| United Kingdom | 224 |
| Hong Kong SAR China | 156 |
| Ireland | 136 |
| Italy | 144 |
| Netherlands | 297 |
| New Zealand | 94 |
| United States | 733 |
| South Africa | 122 |

## Source and matching rules

- Short factual titles, official programme links, directly published structural metadata and dated provenance; no images or copied programme descriptions. No open-data licence is asserted.
- Exact country and verified institution-owned domain matching; no invented institutions or distribution of one country’s programmes across unrelated universities.
- Master-level markers and bounded published pagination. Exclude standalone certificates, minors, bachelor routes and PhD-only entries. Some records describe published master pathways, rather than a separate independently admitting degree.
- Unknown fees, GPA thresholds, teaching language, deadlines, admission route and funding remain null. An English website does not establish English instruction, and an available degree title does not establish an open intake.
- Cape Town’s official faculty table publishes distinct qualification/specialisation codes on one page. Stable published-code identities preserve those records separately without inventing individual programme URLs.
- A failed source preserves its earlier validated snapshot; cyclic/unbounded pagination and truncated HKU JSON responses fail closed. Cached HTML must have matching source URL, current UTC check date and SHA-256 proof before reuse.
- The Strasbourg candidate explicitly disallows automated collection and is excluded from the release. Permitted Sorbonne and Lyon institutional indexes supply French records instead. Sources returning access challenges were not bypassed.
- Institution affiliation determines country counts; international joint degrees and campus location require separate verification. The existing 51-system Europe scope includes transcontinental systems; the world continent partition does not duplicate those countries.

## Refresh

```powershell
npm run world:sync                 # fetch and validate; dry run
npm run world:sync -- --write       # persist the validated result
npm run world:sync -- --from-cache  # verify dated/hash-checked snapshots without network
```

Configured sources: `Server/data/world-programme-sources.json`. Registered, dated provenance: `Server/data/program-source-registry.json`. Import report: `Server/data/world-programme-import-report.json`. The raw response cache stays ignored in `.program-cache/`. There is no automatic scheduled crawler. Review provider access and reuse policies before subsequent collection.

## UI and verification

The catalogue now shows a global coverage panel with continent and country counts. Buttons apply the actual region/country filter; the existing Europe detail remains available. Counts are programme coverage, not rankings. Coverage remains partial across every country.

Validation: 306 automated tests passed; production asset build passed. Chrome checks covered global-country filters, North America filtering, 1440/390/320px layouts and dark-mode readability, with no JavaScript exception. New development-only Cheerio parser dependencies had no npm audit advisory at the time of the check.

The separate CMS production activation remains an owner-authenticated operation, documented in `SPRINT-1-STATUS.md`. Public programme discovery works independently of that migration.

## Official sources

- [Boston University — official master programme index](https://www.bu.edu/academics/degree-programs/)
- [University of Illinois Urbana-Champaign — official master programme index](https://catalog.illinois.edu/graduate/)
- [University of Wisconsin - Madison — official master programme index](https://guide.wisc.edu/graduate/)
- [George Washington University — official master programme index](https://bulletin.gwu.edu/find-your-program/)
- [University of British Columbia — official master programme index](https://www.grad.ubc.ca/prospective-students/graduate-degree-programs)
- [University of Edinburgh — official master programme index](https://study.ed.ac.uk/programmes/postgraduate-taught-a-z)
- [University of Auckland — official master programme index](https://www.auckland.ac.nz/en/study/study-options/find-a-study-option.html)
- [Universidad de Chile — official master programme index](https://uchile.cl/postgrados)
- [University of Twente — official master programme index](https://www.utwente.nl/en/education/master/programmes/)
- [University of Cape Town — official master programme index](https://humanities.uct.ac.za/hum/postgraduate/studies/findprogramme)
- [University of Dublin, Trinity College — official master programme index](https://www.tcd.ie/courses/postgraduate/a-z-of-pg-courses/)
- [Lund University — official master programme index](https://www.lunduniversity.lu.se/study/courses-programmes)
- [Pontificia Universidad Católica de Chile — official master programme index](https://admision.uc.cl/postgrado/magister/)
- [Universiteit Leiden — official master programme index](https://www.universiteitleiden.nl/en/education/study-programmes?type=master&pageNumber=1)
- [University of Bologna — official second-cycle catalogue](https://www.unibo.it/en/study/second-cycle-degree)
- [University of Hong Kong — public taught programme search](https://portal.hku.hk/tpg-admissions/programme-listing)
- [Universidad de Valencia — official master catalogue](https://www.uv.es/uvweb/information-service-sedi/en/postgraduate-courses/official-master-s-degrees/official-master-s-degrees-offered/master-s-degrees-alphabetical-order-1286013102594.html)
- [Sorbonne Université - Faculté des Sciences (Paris VI) — official master catalogue](https://sciences.sorbonne-universite.fr/formation-sciences/offre-de-formation/masters)
- [Université Claude Bernard (Lyon I) — official master catalogue](https://offre-de-formations.univ-lyon1.fr/mentions-diplome-m.html)
