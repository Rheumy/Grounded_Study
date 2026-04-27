# Grounded Study — Master Brief

## What this project is
Grounded Study is a web app that turns user-uploaded study materials into grounded revision questions, focused practice sessions, and mock exams.

It is intended to work across domains, not just one subject area. The long-term goal is to support learners studying for school exams, university courses, engineering and medical assessments, and other document-based learning contexts.

## Core product loop
1. User signs in with Google.
2. User uploads study material.
3. Material is ingested into chunks and embeddings.
4. User optionally creates a Question Format.
5. App generates questions from READY study materials.
6. User practises questions, runs mock exams, and reviews progress.

## Current milestone
The app has moved beyond “first generation not yet proven”.

What is now true on the active stabilization branch:
- upload works
- learner upload now attempts ingestion automatically in the normal flow
- documents can reach `READY`
- at least one citation-backed question has been generated successfully
- Practice Questions and Mock Exam are functioning product surfaces
- structured practice feedback is now explicit for MCQ / TRUE_FALSE
- short-answer review is now presented separately from deterministic objective scoring
- learner-facing wording has been cleaned up so retrieval jargon like “excerpt” no longer leaks into normal UX

This means the project is now in:
**stabilization, repeatability testing, pricing instrumentation, and release-discipline mode.**

Current commercial state:
- private beta only
- not public launch ready

## Current operating assumptions
- Google auth is the only real production auth path.
- Google sign-in in the live beta is restricted by `BETA_ALLOWED_EMAILS`.
- Email magic link exists in code but is not production-ready.
- `grounded-study-update` is the only Vercel project that should be treated as active.
- `sulcai.com` is the live private-beta domain.
- `feature/question-format-system-no-ci` is the active stabilization branch.
- Manual ingestion still exists as fallback/admin tooling, but common learner flow now attempts auto-ingestion after upload.
- Preview deployments were previously used as the main source of truth during stabilization.
- Vercel custom domains serve Production deployments, so Production Branch alignment matters.

## Primary product concepts

### Study Materials
User-uploaded source material.

Documents move through statuses such as:
- `QUEUED`
- `PROCESSING`
- `READY`
- `FAILED`

The learner-facing flow should feel like one continuous process:
upload -> ingest -> ready to generate.

### Question Format
A saved style/profile that shapes wording, answer expectations, and exam flavour.

The intended UX is:
- text description only should work
- file upload should remain optional
- more source material improves extraction quality
- Question Format should influence style and expectations, not break core generation invariants

### Generation
Generation is grounded by retrieval from READY document chunks.

The app should:
- retrieve supporting chunks
- generate normalized question JSON
- verify/support the question
- save only accepted grounded questions
- fail cleanly when evidence is insufficient or output is malformed

The current Generate Questions flow is intentionally simplified:
- visible runtime controls decide question type for the current run
- saved Question Format support still exists in the backend, but is not currently surfaced in the main generate UI

### Practice
Practice is a focused learner workflow rather than a raw question browser.

Practice should:
- allow selection of question type for the session
- allow a chosen number of questions
- provide clean, explicit feedback
- end with a clear summary

### Mock Exam
Mock Exam should:
- allow exam-style setup
- use clear difficulty labels
- persist a detailed review screen after submission
- separate objective scoring from subjective short-answer review

## Supported question types
- `MCQ`
- `SHORT_ANSWER`
- `TRUE_FALSE`

Current invariant:
- `MCQ` uses exactly 4 options.

## Current high-level architecture
- Next.js app directory application
- Prisma + Postgres/Neon
- Google auth via NextAuth/Auth.js
- Vercel Blob for upload storage
- Chunking + embeddings for retrieval
- OpenAI-backed extraction, generation, verification, and grading
- Dashboard pages for materials, formats, generation, practice, exam, progress, billing, admin

## What is already working
- Google sign-in
- Upload flow
- learner-triggered auto-ingestion attempt after upload
- documents can reach READY
- Question Format page exists and supports text/file inputs
- Generate Questions page exists with simplified runtime type selection
- Practice Questions and Mock Exam surfaces are working
- practice summaries and exam review screens exist
- learner-facing citations are cleaner and chunk IDs are no longer exposed
- logging and retries exist around generation
- at least one generated question with citation has succeeded end-to-end

## Current main risks
1. Repeatability across fresh generation runs still needs proof.
2. Old saved style profiles may still contain malformed schema from earlier buggy versions.
3. `sulcai.com` may serve an older production deployment if the Vercel Production Branch is not aligned with `feature/question-format-system-no-ci`.
4. Branch hygiene and deployment/documentation cleanup still need finishing.
5. Prompt/schema drift is improved, but still a standing risk category whenever generation logic changes.

## Non-goals right now
- Do not add major new product features until generation is repeatable.
- Do not widen MCQ beyond 4 options unless the whole stack is intentionally updated.
- Do not redesign unrelated auth, billing, or multi-tenant architecture while stabilization is still in progress.
- Do not build large “self-learning” or cross-user reuse systems before instrumentation and repeatability are understood.

## Current near-term goal
Get repeatable end-to-end success while keeping the live private beta aligned:
- upload -> auto-ingest -> READY
- Question Format creation works in text-only, file-only, and text+file modes
- generate 1 fresh MCQ successfully
- generate 1 fresh TRUE_FALSE successfully
- generate 1 fresh SHORT_ANSWER successfully
- practise those newly generated questions cleanly
- submit a mock exam and review results cleanly
- confirm Production Branch and latest Production deployment commit whenever `sulcai.com` does not match expected UI

## Working principles for future AI agents
- Prefer small, surgical fixes over broad rewrites.
- Always identify the exact failing layer before patching.
- Treat raw LLM output as untrusted.
- Normalize before validation before persistence.
- Keep user-facing errors human-readable.
- Keep learner-facing wording free of retrieval jargon like “excerpt”, “chunk”, or “retrieved passage”.
- For short-answer, present model-answer/rubric-based review separately from deterministic objective scoring.
- For branch debugging, use the latest preview deployment.
- For live beta issues, first confirm `sulcai.com` is serving the expected Production deployment.
