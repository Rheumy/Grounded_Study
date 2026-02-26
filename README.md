# Grounded Study

A secure-by-default web app for building grounded practice questions from PDFs, text files, and images.

## Quick Start (Local)

1. Install dependencies

```bash
pnpm install
```

2. Start Postgres (with pgvector)

```bash
docker-compose up -d
```

3. Configure env

```bash
cp .env.example .env
```

Fill in at least:
- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`

4. Run migrations + seed

```bash
pnpm prisma:migrate
pnpm seed
```

5. Start dev server

```bash
pnpm dev
```

6. Run the worker (separate terminal)

```bash
pnpm worker
```

## Commands

- `pnpm dev`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm prisma:migrate`
- `pnpm seed`
- `pnpm worker`

## Feature Flags (Safe Defaults)

- OpenAI missing: ingestion + generation return friendly errors.
- Stripe missing: billing UI shows disabled state, Free tier only.
- Google OAuth missing: Sign-in UI disables Google button.
- Vercel Blob missing in production: uploads disabled with clear message.

## Environment Variables

See `.env.example` for the full list. Key variables:

- `DATABASE_URL`
- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_ENABLED`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO`
- `BLOB_READ_WRITE_TOKEN`
- `ADMIN_EMAIL`

## Local Dev Auth Bypass

If email delivery is not configured, you can enable a dev-only bypass:

```
DEV_AUTH_BYPASS=true
DEV_AUTH_EMAIL=student@example.com
NEXT_PUBLIC_DEV_AUTH_BYPASS=true
```

## Deployment

See `docs/DEPLOYMENT_VERCEL.md` for Vercel setup and required env vars.

## Security Notes

- Uploads are validated by file signature + MIME, with size and pixel limits.
- All documents and chunks are private.
- No secrets are logged or stored client-side.
- CSP and secure headers are enforced in `next.config.mjs`.

## Known Limitations

- Vision OCR and generation require `OPENAI_API_KEY`.
- Short-answer grading uses LLM and may return `needs review`.
- Stripe billing UI is disabled if Stripe keys are missing.

## Next Enhancements

- Admin moderation queue for “needs review” answers.
- More granular analytics dashboards.
- Multi-org workspaces and shared libraries.
