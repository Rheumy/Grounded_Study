# Deployment on Vercel

## 1. Create GitHub Repo

```bash
git remote add origin <your-repo-url>
git push -u origin main
```

## 2. Provision Postgres + pgvector

- Use Neon or Vercel Postgres.
- Enable pgvector extension (`CREATE EXTENSION IF NOT EXISTS vector;`).

## 3. Configure Vercel Env Vars

Set at least:
- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `ADMIN_EMAIL`

Optional:
- `OPENAI_API_KEY` (required for ingestion + generation)
- `BLOB_READ_WRITE_TOKEN` (enables uploads in production)
- `CRON_SECRET` (required for scheduled ingestion/generation processing)
- `CRON_INGESTION_BATCH_SIZE` (optional scheduled job batch size)
- `CRON_GENERATION_BATCH_SIZE` (optional scheduled generation batch size, defaults to 1)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_ENABLED=true`
- `BETA_ALLOWED_EMAILS` (comma-separated private-beta allowlist for Google and magic-link sign-in)
- `RESEND_API_KEY`
- `EMAIL_FROM` (for example `Grounded Study <login@sulcai.com>`)
- `NEXT_PUBLIC_EMAIL_AUTH_ENABLED=true` (shows the magic-link button and enables the email provider)

## 4. Deploy

- Connect repo to Vercel.
- Deploy and run `prisma migrate deploy` in build step.

## 5. Stripe

- Create products and price IDs.
- Configure webhooks to `/api/billing/webhook`.

## 6. Jobs

- Run worker locally for dev (`pnpm worker`).
- Manual admin trigger: call `/api/admin/process-jobs` with `Authorization: Bearer $ADMIN_JOB_TOKEN`.
- Vercel cron is configured in `vercel.json` to call `/api/cron/process-ingestion`.
- The cron route processes both ingestion jobs and pending generation jobs.
- The cron route requires `Authorization: Bearer $CRON_SECRET`; Vercel Cron sends this when `CRON_SECRET` is configured.

## 7. Custom Domain

- Configure custom domain in Vercel dashboard.
- Update `NEXTAUTH_URL` to the domain.

## If Env Var Missing

- Stripe missing: billing UI disabled, Free tier only.
- OpenAI missing: ingestion + generation disabled with friendly errors.
- Vercel Blob missing: uploads disabled in production.
