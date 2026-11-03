# Neon agent tooling — 2026-11-02

Requested source: https://neon.com/.well-known/agent-skills/neon/SKILL.md

## Initial state

- Project skills `neon` and `neon-postgres` were installed in `.agents/skills`; `neon skills status` reported both outdated.
- No project `.codex/config.toml` existed. The existing user-level Codex configuration contained no MCP server definitions.
- No Neon MCP tools were available in the running agent session.

## Changes made

1. Updated `.agents/skills/neon/SKILL.md` from the official Neon skill repository using the Neon CLI.
2. Updated `.agents/skills/neon-postgres/SKILL.md` through the same installer.
3. Added the upstream references `.agents/skills/neon-postgres/references/branching.md` and `egress-optimization.md`. The current upstream package incorporates the former standalone branching/egress skills into `neon-postgres`; no duplicate skill directory was created.
4. Updated the two existing hashes in `skills-lock.json`; retained its existing skill entries.
5. Created project-local `.codex/config.toml` with only:

   ```toml
   [mcp_servers.Neon]
   url = "https://mcp.neon.tech/mcp"
   ```

   Installed with `neon mcp --oauth --project --agent codex -y`. Removed the installer's unnecessary `type = "http"` field to keep the documented Codex URL-based format. No API key, bearer token or credential is present in this project config.
6. Preserved the prior skill folders and lockfile in ignored `.qa-neon-setup-before/`, together with a SHA-256 fingerprint of the user-level Codex config. No existing skill reference files were removed.

The global Codex config was verified unchanged by its SHA-256 fingerprint. Application code, dependencies, existing database settings and environment files were not changed. No new Neon project was provisioned and no production migration was run.

## Verification and activation

- Neon CLI 8.16.0 is available through `npx neonctl`; no global CLI install was needed.
- `neon skills status` reports both installed skills up to date.
- The project TOML parses correctly. Its MCP URL was validated with Codex's MCP configuration schema using a transient command-line override; this does not modify global settings.
- This CLI's `codex mcp list` did not enumerate the project file. This alone does not establish that the running IDE session has loaded it. Restart the Codex extension, inspect **gear menu → MCP servers**, and select **Authenticate** for Neon when prompted. Project configs require a trusted workspace. Do not change trust or global configuration merely to make a CLI listing appear.
- OAuth configuration is installation, not proof of an authenticated MCP connection. No such connection was claimed during setup.

Official Codex setup reference: https://learn.chatgpt.com/docs/extend/mcp

## Existing branch task

The CLI's existing OAuth credential is valid, but listing the sole available organization returned zero projects. Vercel separately lists the existing `globaleduai-db` resource. The current Neon identity therefore has not demonstrated access to that resource, and the previously authorized production-clone test branch has not been created. Resolve access to the existing Vercel-managed resource; do not create an unrelated replacement project or pull all production environment secrets.

## Subsequent branch verification

The user created `cms-migration-test` from `main` and configured a private direct credential in `Server/.env`. The real branch migration/CRUD/audit test passed at 2026-11-02T19:50:11.930Z; all changes were rolled back. The authorized owner account ID was verified by a narrow read from that clone and bound in Vercel Production through `ADMIN_ACCOUNT_IDS`. The temporary email bootstrap was removed. The exact tested schema hash now permits the existing authenticated admin activation flow; production installation and its final CRUD check still require that activation. CLI project-list visibility remains a separate integration/account issue; no unrelated project was created.
