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
- `CRON_SECRET`

Optional:
- `OPENAI_API_KEY` (required for ingestion + generation)
- `BLOB_READ_WRITE_TOKEN` (enables uploads in production)
- `CRON_INGESTION_BATCH_SIZE` (defaults to `3` jobs per cron invocation)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_ENABLED=true`

## 4. Deploy

- Connect repo to Vercel.
- Deploy and run `prisma migrate deploy` in build step.

## 5. Stripe

- Create products and price IDs.
- Configure webhooks to `/api/billing/webhook`.

## 6. Jobs

- Run worker locally for dev (`pnpm worker`).
- Manual admin trigger: call `/api/admin/process-jobs` with `Authorization: Bearer $ADMIN_JOB_TOKEN`.
- Automatic Vercel cron trigger: `/api/cron/process-ingestion` is scheduled via `vercel.json` and authenticated with `CRON_SECRET`.

## 7. Custom Domain

- Configure custom domain in Vercel dashboard.
- Update `NEXTAUTH_URL` to the domain.

## If Env Var Missing

- Stripe missing: billing UI disabled, Free tier only.
- OpenAI missing: ingestion + generation disabled with friendly errors.
- Vercel Blob missing: uploads disabled in production.
