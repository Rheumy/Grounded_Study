# Architecture

## Overview

- **Next.js App Router** for UI + API routes
- **Auth.js/NextAuth** with production Google OAuth and Resend email magic link auth
- **Postgres + pgvector** for relational data and embeddings
- **DB-backed job queue** for ingestion and generation (no Redis)
- **OpenAI** for embeddings, OCR, generation, and verification

## Data Flow

1. **Upload**
   - Validate file signature + size limits.
   - Store locally in `UPLOADS_DIR` (dev) or Vercel Blob (prod).
   - Create `Document` + `IngestionJob`.

2. **Ingestion Worker**
   - Extract text (PDF) or OCR (image).
   - Chunk + embed with OpenAI.
   - Store chunks in `DocumentChunk` with pgvector embeddings.

3. **Question Generation**
   - Retrieve top-K chunks using pgvector.
   - Generate question with strict JSON schema output.
   - Verify with second-pass LLM check.
   - Persist `Question` with citations.

4. **Practice / Exam**
   - Practice gives instant feedback with citations.
   - Exam mode builds a session and grades on submit.

## Jobs

- `IngestionJob` table stores job state.
- `GenerationJob` table stores background question-generation state and progress.
- Worker loop (`pnpm worker`) claims jobs with `FOR UPDATE SKIP LOCKED`.
- Admin endpoint `/api/admin/process-jobs` can process jobs manually.
- Vercel Cron calls `/api/cron/process-ingestion` to process ingestion and generation jobs.

## Storage

- Dev: local `./uploads` (gitignored).
- Prod: Vercel Blob if `BLOB_READ_WRITE_TOKEN` is set.

## Security

- Private storage by default.
- Rate limiting (in-memory dev, DB-backed prod).
- CSP + secure headers in `next.config.mjs`.
