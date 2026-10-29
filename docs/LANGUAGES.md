# Site languages

The interface supports Georgian (`ka`, default), English (`en`) and Russian (`ru`). The selector is available in the main navigation, authentication area and dashboard. `i18n.js` stores the preference under `globalEduLanguage`; unavailable local storage does not prevent switching languages.

Translations run locally, including new catalog results, filters, assessment explanations, form placeholders and accessibility labels. The document language and each language selector stay synchronized. The API continues returning canonical catalog data; changing the interface language does not alter filter values, admissions requirements, user input, saved names or chat history. Original university/program names and source titles remain in their published language. Dates use the chosen language while preserving published date-only deadlines.

The AI chat sends the selected interface locale separately from the student's preferred study language. The server accepts only `ka`, `en` and `ru`, and asks the advisor to answer in that language. Site translation itself does not use an external translation service or API credits.

Add curated phrase pairs and templates in `i18n.js` when introducing new interface copy. User-authored content and original source labels must use `data-i18n-ignore` where they appear in the DOM. The language tests check translation, reversibility, dynamic text, accessibility attributes, persistence and preservation of user values.
