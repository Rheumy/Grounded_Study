# Codebase Map

## Core app structure
This repo is a Next.js app-directory application with Prisma-backed persistence and OpenAI-backed extraction/generation flows.

## High-value paths

### Auth
- `lib/auth/options.ts`
- `lib/auth/require-user-api.ts`
- `lib/auth/email.ts`

Notes:
- Google auth is primary.
- Beta allowlist for Google sign-in is enforced via `BETA_ALLOWED_EMAILS`.
- Email path exists but is not production-ready.

### Upload and document creation
- `app/api/documents/blob/route.ts`
- `app/api/documents/upload/route.ts`
- `app/api/documents/ingest/route.ts`
- `app/api/documents/route.ts`
- `app/dashboard/documents/page.tsx`
- `app/dashboard/documents/upload-form.tsx`
- `app/dashboard/documents/documents-list.tsx`
- `lib/security/file-validation.ts`
- `lib/storage/storage.ts`

Purpose:
- issue blob token
- finalize upload
- create `Document` + `IngestionJob`
- trigger learner-facing ingestion attempt
- list current document statuses
- validate file type
- surface upload/queue/processing/ready states cleanly

### Ingestion / jobs
- `app/api/admin/process-jobs/route.ts`
- `app/api/cron/process-ingestion/route.ts`
- `lib/jobs/queue.ts`
- `lib/jobs/processor.ts`
- `lib/jobs/run-batch.ts`
- `lib/ingestion/ingest.ts`
- `lib/ingestion/pdf.ts`

Purpose:
- claim queued jobs
- extract text
- chunk content
- embed chunks
- mark documents READY

Notes:
- learner flow now attempts ingestion automatically after upload
- admin/manual ingestion still exists as fallback/debug tooling

### Retrieval
- `lib/retrieval/retrieve.ts`

Purpose:
- select supporting chunks for generation/verifier

### Style profile / Question Format
- `app/dashboard/style-profiles/page.tsx`
- `app/dashboard/style-profiles/style-profile-form.tsx`
- `app/api/style-profiles/route.ts`
- `lib/llm/style-profile.ts`
- `lib/llm/schemas/style-profile.ts`
- `lib/llm/prompts/style-profile.md`

Purpose:
- extract/save question format schema from user text/files
- normalize inconsistent model output

Notes:
- saved style-profile support still exists
- main Generate Questions UI no longer exposes it in the normal learner flow

### Generation
- `app/dashboard/generate/page.tsx`
- `app/dashboard/generate/generate-form.tsx`
- `app/api/questions/generate/route.ts`
- `lib/llm/generate.ts`
- `lib/llm/question-generator.ts`
- `lib/llm/schemas/question.ts`
- `lib/llm/prompts/question-generation.md`

Purpose:
- request generation
- build type slots
- retrieve chunks
- generate normalized question object
- sanitize learner-facing text where needed
- save PASSED questions

Notes:
- runtime controls now decide question type for the current run
- learner-facing wording should avoid “excerpt/excerpts” phrasing

### Verifier
- `lib/llm/verifier/verifier.ts`
- `lib/llm/prompts/question-verifier.md`

Purpose:
- check whether generated question is adequately supported

### Grading / feedback
- `lib/llm/grading.ts`
- `lib/llm/prompts/short-answer-grader.md`
- `lib/feedback/user-facing.ts`

Purpose:
- grade short answers
- format learner-facing feedback
- keep wording clean and grounded
- separate objective scoring from short-answer review framing

### Practice / Exam / Progress
- `app/dashboard/practice/practice-client.tsx`
- `app/api/practice/next/route.ts`
- `app/api/practice/answer/route.ts`
- `app/dashboard/exam/exam-client.tsx`
- `app/api/exam/start/route.ts`
- `app/api/exam/finish/route.ts`
- `app/dashboard/analytics/page.tsx`

Purpose:
- fetch questions for practice
- answer and review practice items
- build exam sessions
- finish and review exams
- surface progress

Notes:
- structured feedback is now explicit for MCQ / TRUE_FALSE
- short-answer is now presented via model-answer/review framing
- exam review persists after submission

### Dashboard shell
- `app/dashboard/layout.tsx`
- `app/dashboard/page.tsx`
- `app/dashboard/dashboard-nav.tsx`

Purpose:
- dashboard shell, navigation, and overview layout

### Admin
- `app/dashboard/admin/page.tsx`
- `app/dashboard/admin/admin-ingest-button.tsx`
- `app/api/admin/process-jobs/route.ts`

### Observability
- `lib/observability/logger.ts`
- `lib/observability/ai-cost.ts`
- `lib/observability/ai-usage.ts`

### Database
- `prisma/schema.prisma`
- `prisma/migrations/...`

## Important model concepts

### Question
Core persisted entity representing generated practice items.

Key fields include:
- type
- stem
- optionsJson
- answer
- rationale
- citationsJson
- difficulty
- verifierStatus

### StyleProfile
Saved Question Format that influences generated question style and type mix elsewhere in the product.

### Document / DocumentChunk / IngestionJob
Represents uploaded source materials and their retrieval-ready derivatives.

## Operational notes
- Preview debugging should always use the latest commit-specific preview deployment.
- Live beta domain is `sulcai.com`.
- Active Vercel project is `grounded-study-update`.
- Vercel custom domains serve Production deployments, so Production Branch alignment matters.
- Old saved style profiles can mislead testing.
- Manual ingestion still exists, but common learner flow now attempts auto-ingestion.
- MCQ should remain standardized unless the whole stack is deliberately widened.
- Generation has been proven at least once with citation-backed output, but fresh repeatability still needs deliberate validation.
