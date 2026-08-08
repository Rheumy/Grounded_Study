# Sulcai / Grounded Study Beta Pause — August 2026

## Preservation checkpoint

- Local repository: `/Users/chanakyasharma/Codex Projects/grounded-study`
- Branch: `feature/question-format-system-no-ci`
- Pre-pause baseline commit: `18d478b41fa8f976eeebb9871867976c4cd2158d`
- Pause tag: `pause-2026-08-sulcai-beta`
- Git remote: `https://github.com/Rheumy/Grounded_Study.git`
- Vercel team: `sulcais-projects`
- Vercel project: `grounded-study-update`
- Vercel production branch: `feature/question-format-system-no-ci`
- Production domains: `sulcai.com`, `www.sulcai.com`
- Production deployment at audit time: `dpl_6FdBciDzKmjDSnddDSok23qS31Ut`
- Production deployment commit at audit time: `18d478b41fa8f976eeebb9871867976c4cd2158d`

The pause tag is the canonical preserved state. Resolve its exact commit after cloning with:

```bash
git rev-list -n 1 pause-2026-08-sulcai-beta
```

## Pause behavior

`APP_PAUSED=true` makes middleware return a static maintenance page for browser requests and a plain-English
HTTP 503 response for every API request. This blocks sign-in, uploads, generation, billing actions, webhooks,
manual job processing, and the cron processor. The Vercel Cron schedule was also removed from `vercel.json`.

## Production environment-variable inventory

Only names are recorded here. Values remain secret and are not committed.

- `ABSOLUTE_MAX_GENERATE_COUNT`
- `ABSOLUTE_MAX_UPLOAD_MB`
- `ADMIN_EMAIL`
- `ADMIN_JOB_TOKEN`
- `APP_PAUSED`
- `BETA_ALLOWED_EMAILS`
- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`
- `DATABASE_URL`
- `EMAIL_FROM`
- `FREE_MAX_GENERATE_COUNT`
- `FREE_MAX_UPLOAD_MB`
- `FREE_QUESTIONS_PER_DAY`
- `FREE_STORAGE_MB`
- `FREE_UPLOADS_PER_DAY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `NEXTAUTH_SECRET`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_EMAIL_AUTH_ENABLED`
- `NEXT_PUBLIC_GOOGLE_ENABLED`
- `OPENAI_API_KEY`
- `PRO_MAX_GENERATE_COUNT`
- `PRO_MAX_UPLOAD_MB`
- `PRO_QUESTIONS_PER_DAY`
- `PRO_STORAGE_MB`
- `PRO_UPLOADS_PER_DAY`
- `RESEND_API_KEY`

The code also supports optional model, logging, upload-limit, Stripe, and local-development variables listed in
`.env.example`. Stripe variables were not present in the audited Vercel Production environment.

## Data preservation

Backups are outside the repository at:

`/Users/chanakyasharma/Codex Backups/grounded-study/pause-2026-08`

Preserved on 2026-08-09:

- Neon Postgres custom-format dump: `grounded-study-production-2026-08-09.dump`
  - Source database: Neon `neondb`
  - Source logical size: 79 MB
  - Dump size: 47 MB
  - SHA-256: `5c41ef201eee9277e4a70b61e8f0ea8265351dac0d41a58d9e590096ffacf641`
  - Verified with `pg_restore --list`; owner and ACL statements were omitted for portability.
- Vercel Blob files: `blob-files/`
  - 131 files
  - 1,047,197,666 source bytes
  - Every downloaded file was checked against the source-reported size.
- Blob inventory: `blob-manifest.json`
  - SHA-256: `881348c9acfcd0a685ca56754f830f8759502335166082b4ecead9e5092405f8`

The backup directory and files are owner-only. It contains private beta data and must not be committed or shared.

### Retention decision for beta uploads

The backups contain user-uploaded study materials and database records that may include personal data. Do not
retain them indefinitely by default. Before deleting cloud data or the backup, choose and document a retention
period based on the published privacy terms, any tester commitments, and applicable privacy obligations. A
privacy-minimizing shutdown would notify beta users, allow an export window if promised, then delete the live
Blob objects and associated database records after the retention period. Deleting the Vercel/Neon copies should
be a separate, explicitly approved step after restore testing and retention review.

## Known working state before pause

- Google sign-in and Resend magic-link authentication worked behind `BETA_ALLOWED_EMAILS`.
- Upload attempted ingestion automatically and documents could reach `READY`.
- Background `GenerationJob` processing was wired through Vercel Cron.
- At least one grounded generated question with a citation succeeded.
- MCQ and TRUE_FALSE objective grading worked; short answer used model-answer-based review.
- Question Format supported text-only, file-only, and text-plus-file creation.
- Practice and Mock Exam learner flows had received stabilization passes.
- AI usage/cost event persistence existed (`AiUsageEvent`); the pause-time database contained 6,422 events.

## Known unresolved issues

- Repeatable fresh generation was not yet proven across MCQ, SHORT_ANSWER, and TRUE_FALSE.
- Old saved Question Formats may contain malformed schema JSON.
- Legal consent re-prompt still needed validation with a real beta account.
- Branch/repository cleanup and CI strategy remained incomplete.
- Pricing still needed to be based on measured usage rather than estimates.
- The production environment did not contain Stripe variables at pause time.
- Blob is attached to the older `grounded-study` project/store relationship rather than appearing as a resource
  on `grounded-study-update`; preserve the token/store mapping during restart.

## Restart locally

1. Check out the preserved state: `git checkout feature/question-format-system-no-ci` or
   `git checkout -b restart-sulcai pause-2026-08-sulcai-beta`.
2. Install dependencies with `pnpm install`.
3. Start local Postgres/pgvector with `docker-compose up -d`, or provision a fresh compatible Postgres database.
4. Copy `.env.example` to an ignored local env file and set fresh secret values. Keep `APP_PAUSED=false`.
5. Restore the dump into an empty database if historical beta state is required:
   `pg_restore --no-owner --no-acl --dbname="$DATABASE_URL" <dump-path>`.
6. If restoring uploads, provision/connect a private Vercel Blob store and upload the files from `blob-files/`
   using the paths in `blob-manifest.json`.
7. Run `pnpm prisma:migrate`, then `pnpm typecheck`, `pnpm test`, and `pnpm build`.
8. Start the app with `pnpm dev`; run `pnpm worker` separately only when actively testing queued jobs.

## Redeploy later

1. Review and rotate all credentials; do not assume old API keys should be reused.
2. Reconnect the intended Neon database and Blob store to `grounded-study-update`.
3. Restore data and verify row/file counts before enabling writes.
4. Restore required Vercel environment variables and set `APP_PAUSED=true` initially.
5. Deploy a preview from a dedicated restart branch and confirm project, branch, and commit.
6. Test one new upload through `READY`, then one fresh MCQ, TRUE_FALSE, and SHORT_ANSWER generation.
7. Confirm auth allowlist, Resend domain, and privacy/legal behavior.
8. Re-add the cron schedule only after job processing is deliberately enabled and `CRON_SECRET` is configured.
9. Promote the verified deployment to Production, verify `sulcai.com`, then set `APP_PAUSED=false` and redeploy.

## Cost shutdown inventory

- Vercel Pro/project hosting: maintenance deployment remains live until the project or team plan is downgraded.
- Neon Postgres: backup exists; downgrade/suspend/delete only after restore testing and retention review.
- Vercel Blob: backup exists; live store still contains 131 files and should remain until retention/deletion approval.
- OpenAI: maintenance mode plus disabled cron stops application calls; separately set a zero/low project budget,
  revoke the app key, or remove `OPENAI_API_KEY` when ready.
- Resend: maintenance mode blocks new magic links; keep domain renewal separate and downgrade/cancel Resend if paid.
- Stripe: code paths exist, but no Stripe environment variables were present in Vercel Production at pause time.
- Domain: `sulcai.com` renewal is independent of hosting and should be retained if the name is wanted for restart.

No cloud database, Blob object, project, domain, secret, or user record was deleted during the preservation pass.
