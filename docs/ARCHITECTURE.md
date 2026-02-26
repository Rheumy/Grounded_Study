# Architecture

## Overview

- **Next.js App Router** for UI + API routes
- **Auth.js/NextAuth** with Email magic link (safe stub) + optional Google OAuth
- **Postgres + pgvector** for relational data and embeddings
- **DB-backed job queue** for ingestion (no Redis)
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
- Worker loop (`pnpm worker`) claims jobs with `FOR UPDATE SKIP LOCKED`.
- Admin endpoint `/api/admin/process-jobs` can process jobs via cron.

## Storage

- Dev: local `./uploads` (gitignored).
- Prod: Vercel Blob if `BLOB_READ_WRITE_TOKEN` is set.

## Security

- Private storage by default.
- Rate limiting (in-memory dev, DB-backed prod).
- CSP + secure headers in `next.config.mjs`.
