# Sprint 3 — discovery and funding navigation

Implemented from `sprint_backlog_3_day.docx` (2026-11-06).

| Item | Result |
| --- | --- |
| SP-01 / PB-01 | Scholarships and loans share `#funding`. Country and funding-type filters intersect, with reset, empty state and refresh. Legacy `#scholarships` and `#loans` still open the combined page. |
| SP-02 / PB-02 | Global programme total and geographical coverage now appear on Home, after quick search. The total uses the actual loaded programme array; country shortcuts open the filtered programme directory. |
| SP-03 / PB-03 | Filter order: search type, region, country, then the existing filters. Selecting a multiselect option preserves selections and closes its menu, returning keyboard focus to the summary. |
| SP-04 / PB-04 | Mobile filters collapse into an accessible native disclosure. University rows retain their name, country, favourite control, comparison checkbox and detail dialog. Full programme/funding information remains in the detail dialog; desktop cards retain their existing information. |
| SP-05 / PB-05 | Packages removed from the public navigation. Profile package controls remain; guest direct navigation to `#billing` opens authentication. |

The combined directory contains the existing 22 funding schemes and 3 loans. For presentation, the TUM international grant appears under grants; Helsinki, Aalto, KU Leuven AI and Lund tuition support appear under other funding. Remaining schemes appear under scholarships. These groups do not change eligibility, award guarantees, dates, official sources or programme associations. Loans retain interest, eligibility and repayment disclosures. A failed loan refresh is reported without hiding the available scholarship records.

## Verification

- `npm run check`: source syntax and institution/programme/funding validation passed.
- `npm test`: 352 passed, 0 failed. API tests explicitly use isolated in-memory account, billing and content stores even when the developer `.env` selects Supabase.
- Headless Chrome: four fully visible university rows at 320×740 and 375×667; five at 390×844; six at 430×932, with no horizontal overflow.
- Browser interaction checks: native search type, country multiselect persistence and automatic closure, actual filtered results, detail dialog, Home totals and country shortcuts, both legacy funding routes, all four funding types, country/type intersection, empty results and reset.
- A temporary account in the local in-memory server verified access from the profile to all four package cards. No production accounts were created for this sprint.
- Georgian, English and Russian funding views checked in light and dark themes at mobile widths. Desktop checked at 1440×1000.

Hosting remains on Vercel; the Supabase database configuration and authentication implementation are unchanged. The programme catalogue remains a partial, source-backed catalogue, not a complete worldwide programme register.
