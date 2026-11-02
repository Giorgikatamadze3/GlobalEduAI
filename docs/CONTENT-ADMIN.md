# Content administration

Administrator access is a server permission on an existing student/advisor account. Public registration cannot select the permission. Configure `ADMIN_ACCOUNT_IDS` with immutable account UUIDs. A temporary `ADMIN_BOOTSTRAP` grant may identify the owner's existing email plus a fixed `createdBefore` timestamp; accounts created after that timestamp cannot claim it. Email is immutable through the profile API.

The owner can open **Administration** from the profile sidebar, or `/#admin`. Six sections support create, read, edit and soft delete: institutions, programmes, funding, loans, FAQ and FAQ categories. The editor exposes the complete record as JSON, with a type-specific new-record template. Validate checks source/field constraints without publishing. Publish applies a versioned change; stale edits return 409. Referenced categories and universities cannot be deleted until dependent records are moved/deleted. Audit entries retain action/record/revision/actor metadata, without storing student profile content.

For loans, FAQ and category records complete `ka`, `en` and `ru` text. Dates and numeric unknowns must remain `null`; do not invent a new intake, free tuition, guaranteed funding or admission probability. Institution edits require institutional provenance, not the upstream directory's attribution for newly edited facts. Programme records require dated, institution-owned evidence. Funding checks retain exact programme/institution scope and separate application eligibility from an award.

Public pages retrieve the versioned CDN base and `/api/content` overlays. Publishing refreshes the current tab immediately. Other visitors receive changes on opening/refocusing the page. There is no automatic file rewrite or Git commit for a CMS edit. Catalogue validation and source imports still run on repository data independently. The public delta excludes editor identities and audit history. Record and total storage limits keep serverless responses bounded; admin lists are searched/paged on the server.

## Database rollout

`Server/content-schema.sql` adds two tables and does not alter accounts/sessions. Local SQLite creates its own content file. On cloud, a missing schema returns `CONTENT_SETUP_REQUIRED` and public browsing continues from the curated snapshot.

1. Clone production to a disposable Neon branch; add its **direct** URL privately to `Server/.env` as `CONTENT_TEST_DATABASE_URL`. Do not use a pooler or production endpoint.
2. Run `npm run content:test-branch`. It checks the existing account schema, executes the additive migration twice, exercises CRUD/audit and rolls back the test transaction. It writes an ignored `.qa-content-branch-result.json`, containing only the schema hash and test metadata.
3. Only after a successful real branch test, set Vercel Production `CONTENT_MIGRATION_TESTED_SHA` to that exact hash and deploy. It is a rollout gate, not a secret or a replacement for running the branch test.
4. The authenticated owner can activate the store from Administration. This same-origin admin-only action executes only the checked-in SQL, in a transaction, using a direct Neon connection inside the server. It never returns or exports credentials. No arbitrary SQL endpoint exists.
5. Confirm a temporary FAQ record can be published/read/deleted, then remove the migration gate from Vercel and redeploy. Bind the owner's immutable UUID using `ADMIN_ACCOUNT_IDS` (the owner can read their own ID at `/api/admin/status`) and remove the temporary bootstrap grant.

Until step 2 succeeds, do not enable the production migration gate. API writes stay unavailable; FAQ, loan and catalogue snapshots remain usable. A pg-mem or local SQLite test does not replace the Neon production-clone branch test.
