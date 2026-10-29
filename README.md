# HumorAdmin

Standalone Checked administration and meme-caption Factory, migrated from the
verified `admin-migration-source.zip` snapshot dated October 22, 2026.

## Run locally

Use Node 24.x. Copy `.env.example` to the ignored `.env.local` and configure the
same Supabase PostgreSQL/Auth/Storage project as the original application.

```sh
npm ci
npm run dev -- --port 3001
```

HumorAdmin is restricted to designated administrators. The root route sends
authorized Google superadmins to `/admin`. Factory, profiles and application APIs
require the same permission; only authorized administrators can complete a pending
profile here. Ordinary users continue using the original user-facing application.

The Google callback checks a confirmed email, Google identity and the current
`profiles.is_superadmin = true` permission through the user's RLS client before
loading profile data or entering the app. Unapproved accounts are signed out of
this site's session and shown an access-denied message with an account-switch
button. Lookup failures deny access with a retry message. Permissions are checked
again on private requests so revocation does not depend on a stale browser flag.

To designate another existing confirmed Google account with a profile, use the
trusted local operator tool (never a public signup or browser-supplied flag):

```sh
node --env-file=.env.local scripts/admin-setup.mjs inspect account@example.com
node --env-file=.env.local scripts/admin-setup.mjs grant account@example.com
node --env-file=.env.local scripts/admin-setup.mjs grant account@example.com --apply
```

## Configuration and deployment

Production project: `thehumorproject/humoradmin` on Vercel.
Production domain: `https://humoradmin-nine.vercel.app`.

Set `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `ARK_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL` and
`USER_SITE_URL` in Vercel Production. The example documents their purposes.
`SUPABASE_ACCESS_TOKEN` is only for trusted local maintenance; never deploy it.

`USER_SITE_URL` points to `https://thehumorproject-five.vercel.app`. Checkboard and other remaining user-site destinations use uncached temporary
redirects to that deployment. The admin app has no Gallery page or Gallery
navigation. Factory publication links open the original Gallery directly. The
Control room AI generated media page previews saved media. The Images page supports image uploads, metadata edits, publication, and deletion. Each deployment has its own browser session. The original site
reads Supabase per request without a persistent Next data cache; Gallery and
Checkboard also refresh on focus and every 15 seconds. Cross-project invalidation
is therefore based on fresh reads, without an anonymous revalidation endpoint.

Media shows a single caption and opens `/disguise?media=<id>` to change it.
Factory reads the shared `images.original_storage_path` link, loads that photo
into the upload area, and offers a manual caption or the existing five AI captions.
Save Meme replaces the same media record and rendered
bytes, preserving its owner, votes, dates and publication status. Old media whose
caption-free originals were never retained require an original-photo upload.
Originals remain private and survive preview cleanup. Caption edits preserve the
linked original file and its path; subsequent edits reuse that same photo.
Older admin media without an explicit link still use the retained-original lookup.

Before deploying this caption workflow, enable JPG/PNG retention in the existing
private bucket with the trusted local maintenance command:

```sh
node --env-file=.env.local scripts/factory-migrate.mjs --apply
```

This applies only missing Factory configuration; it preserves existing data,
bucket access policies and file-size limits.

Supabase's existing OAuth allowlist must retain the original callbacks and include
the following exact entries (added and verified with user approval during setup):

- `https://humoradmin-nine.vercel.app/auth/callback`
- `http://localhost:3001/auth/callback`

The original application owns the single daily `/api/cron/ego` schedule. This
repository deliberately has no Vercel cron schedule. Configure `CRON_SECRET` in
the original project's Production environment and redeploy it if missing; its
endpoint rejects requests without that secret. Keep the old application and
shared tables/buckets intact until production acceptance is complete.

Vercel's unique Production deployment URLs redirect browser page requests to the
stable production domain before login, using the automatic
`VERCEL_PROJECT_PRODUCTION_URL` system variable. This keeps the OAuth callback and
PKCE cookies on the allowlisted origin when opening Vercel's Visit link. API
requests, callbacks already in progress, local development and Preview deployments
retain their current origin. Preview OAuth requires its own explicit setup.

The build uses webpack, supports Node/sharp/OpenType, and explicitly traces the
original Anton font into the Factory function. Neither workflow uses Edge or
static export. Fonts, original model configuration, prompts, pixel rendering,
publication bytes and concurrency behavior are preserved.


## Admin catalogs

The sidebar provides read-only users/profiles, prompt chains, ordered chain steps,
Factory generation requests, and recorded LLM responses. Prompt chain mix entries
support weight and enabled-state updates. Terms, AI generation examples, LLM models,
LLM providers, allowed signup domains, and whitelisted e-mail addresses support CRUD.
Every record can be expanded for its complete contents; lists support pagination,
search where applicable, and relationship filters. Provider/model and example forms
accept the IDs visible in their related catalog screens.

Install the additive catalog migration against the shared project before running
the updated admin app. The command defaults to inspection; `--apply` installs only
missing catalog tables and verifies their RLS and server-only permissions:

```sh
npm run admin:catalog-migrate
npm run admin:catalog-migrate -- --apply
```

The migration includes a snapshot of the current Factory caption prompt, its step,
and an initial mix entry. Prompt, mix, provider, and model catalog metadata do not
replace Factory's deployed prompt or environment configuration. Signup catalogs
are maintained as data and do not grant superadmin access or change the existing
Google login policy. No provider credentials are stored in these tables.

Generation requests read the existing `factory_batches` records. New successful
caption-provider responses are retained in `llm_responses`, linked to the batch;
logging is bounded to three seconds and failures do not break generation. Existing
raw responses were never retained and cannot be recovered. Other deployments using
the same project must adopt the response logging change to retain their responses.
Image uploads accept JPG/PNG/WebP up to 2 MB, validate and normalize their actual
bytes, and stay private until published. The existing shared schema classifies
private admin uploads under the `generated` source. Original-photo links remain
intact; changing rendered captions continues through Factory.

## Validation

```sh
npm run test:admin
npm run test:factory
npm run test:images-reference
npm run test:images-media
npm run test:images-db
npm run test:migration-routing
npm run test:admin-login
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
