# HumorAdmin

Standalone Checked administration and five-caption Factory, migrated from the
verified `admin-migration-source.zip` snapshot dated October 22, 2026.

## Run locally

Use Node 24.x. Copy `.env.example` to the ignored `.env.local` and configure the
same Supabase PostgreSQL/Auth/Storage project as the original application.

```sh
npm ci
npm run dev -- --port 3001
```

The root route sends confirmed Google superadmins to `/admin` and other completed
accounts to `/disguise`. Pending profiles complete the original onboarding flow.
The Admin pages remain protected on every request; Factory remains available to
all signed-in users who completed onboarding, as in the source application.

## Configuration and deployment

Production project: `thehumorproject/humoradmin` on Vercel.
Production domain: `https://humoradmin-nine.vercel.app`.

Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `ARK_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL` and
`USER_SITE_URL` in Vercel Production. The example documents their purposes.
`SUPABASE_ACCESS_TOKEN` is only for trusted local maintenance; never deploy it.

`USER_SITE_URL` points to `https://thehumorproject-five.vercel.app`. Gallery,
Checkboard and other user-site destinations use uncached temporary redirects to
that deployment. Each deployment has its own browser session. The original site
reads Supabase per request without a persistent Next data cache; Gallery and
Checkboard also refresh on focus and every 15 seconds. Cross-project invalidation
is therefore based on fresh reads, without an anonymous revalidation endpoint.

Supabase's existing OAuth allowlist must retain the original callbacks and include
the following exact entries (added and verified with user approval during setup):

- `https://humoradmin-nine.vercel.app/auth/callback`
- `http://localhost:3001/auth/callback`

The original application owns the single daily `/api/cron/ego` schedule. This
repository deliberately has no Vercel cron schedule. Configure `CRON_SECRET` in
the original project's Production environment and redeploy it if missing; its
endpoint rejects requests without that secret. Keep the old application and
shared tables/buckets intact until production acceptance is complete.

The build uses webpack, supports Node/sharp/OpenType, and explicitly traces the
original Anton font into the Factory function. Neither workflow uses Edge or
static export. Fonts, original model configuration, prompts, pixel rendering,
publication bytes and concurrency behavior are preserved.

## Validation

```sh
npm run test:admin
npm run test:factory
npm run test:images-reference
npm run test:images-media
npm run test:images-db
npm run test:migration-routing
npm run lint
npm run build
```

For an additional read-only production schema/security audit:

```sh
npm run audit:migration
```

The audit checks tables/RLS, exact RPC signatures and grants, source function
bodies, profile write restrictions, indexes, foreign keys, storage visibility and
limits, and OAuth configuration. Its default report is written outside the repo
to `/tmp/humoradmin-migration-audit.json`; it excludes credentials and user records.
The supplied historical SQL supports isolated tests and inspection, and must not
be replayed wholesale against the shared production database.

See [the migration handoff](docs/admin-migration.md) for the full behavior and
acceptance checklist. `SOURCE_MANIFEST.json` describes the imported baseline;
standalone integration changes intentionally differ from its original hashes.
