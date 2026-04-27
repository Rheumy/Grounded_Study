# AGENTS.md

## Purpose
This file tells coding agents how to work in this repo without causing further drift.

## Project identity
Grounded Study is a grounded question-generation app built on uploaded study materials.

## Active project/deployment assumptions
- Local repo: `/Users/chanakyasharma/Codex Projects/grounded-study`
- Active Vercel project: `grounded-study-update`
- Live beta domain: `sulcai.com`
- Active branch for stabilization: `feature/question-format-system-no-ci`
- Production auth path: Google sign-in
- Beta access allowlist: `BETA_ALLOWED_EMAILS`
- Admin access is controlled by `ADMIN_EMAIL`

## Current priorities
1. Prove repeatable fresh generation across MCQ / SHORT_ANSWER / TRUE_FALSE.
2. Keep end-to-end learner flow working on latest preview deployment.
3. Add AI cost instrumentation for pricing visibility.
4. Keep branch/repo/docs state disciplined.
5. Avoid major new features until repeatability is proven.

## Rules for agents

### 1. Do not widen scope
If the problem is generation, do not also redesign billing, layouts, auth, or cross-user reuse.

### 2. Always identify the failing layer
Before patching, decide whether the failure is in:
- UI validation
- API route
- normalization
- schema validation
- verifier
- persistence
- retrieval/query selection
- deployment/env mismatch

### 3. Treat raw model output as untrusted
Every LLM response must go through:
- JSON parse
- normalization
- safe validation
- clean error handling

Never pass freeform raw model output directly into final persistence validation.

### 4. Prefer canonical internal contracts
Keep a single canonical question shape and a single canonical style-profile shape.
If model outputs differ, normalize them into canonical form before validation.

### 5. Keep user-facing UX simple
Users should see plain-English errors, never raw Zod arrays.
Do not leak retrieval jargon like:
- excerpt
- excerpts
- chunk
- retrieved passage

### 6. Use newest preview only
When debugging preview behavior, always confirm:
- Vercel project
- branch
- commit hash
before interpreting results.

For live beta mismatches, also confirm:
- Vercel Production Branch
- latest Production deployment commit serving `sulcai.com`

### 7. Question Format product rule
- At least one content source should be enough:
  - text description / pasted examples
  - or uploaded sample file(s)
- File upload must remain optional.
- More material can improve extraction quality.
- Question Format may influence style and expectations, but should not break generation invariants.

### 8. Current Generate Questions rule
The main Generate Questions UI is now intentionally simplified.
Runtime controls should decide what gets generated in the current run.
Do not casually reintroduce confusing overlap between saved Question Format and runtime type selection.

### 9. MCQ product rule
Current invariant:
- MCQ always has exactly 4 options.

If user text asks for 5 options, normalize or override toward 4 rather than letting generation violate schema.

### 10. Saved profile caution
Old saved style profiles may contain malformed schema JSON from earlier buggy versions.
When validating a new fix, always create a brand-new profile with a distinctive name.

### 11. Logging expectations
Add targeted logs only where they improve diagnosis:
- before/after generation calls
- before parse/safeParse boundaries
- on normalization failures
- on verifier failures
- around AI usage/cost instrumentation when that work lands

Do not flood logs with unnecessary data.

### 12. Practice and exam scoring rule
- MCQ / TRUE_FALSE are deterministic objective items.
- SHORT_ANSWER should be presented as model-answer/rubric-based review unless a stronger rubric-backed scoring path exists.
- Do not present subjective review with contradictory hard-scoring language.

### 13. Upload / ingestion rule
Common learner flow should attempt ingestion automatically after upload.
Manual admin ingestion is fallback/debug tooling, not the preferred learner path.

### 14. Deployment reality rule
- `sulcai.com` serves the Vercel Production deployment.
- Preview deployments were previously used as the source of truth during stabilization.
- If the live beta looks older than expected, first check Production Branch alignment before debugging the app itself.

## Recommended debug workflow
1. Reproduce on latest preview.
2. Capture exact UI error.
3. Capture exact Vercel log lines for that request.
4. Identify throwing file/line.
5. Apply minimal fix.
6. Re-test with one question only.
7. Compare fresh behavior against prior expected behavior if relevant.
8. Prefer newly generated questions over legacy stored questions when validating a fix.

## Definition of done for current stabilization phase
- Text-only Question Format creation works.
- File-only Question Format creation works.
- Text + file Question Format creation works.
- Upload attempts auto-ingestion and reaches READY in the normal flow.
- 1 fresh MCQ can be generated from a READY document.
- 1 fresh TRUE_FALSE can be generated from a READY document.
- 1 fresh SHORT_ANSWER can be generated cleanly or fail cleanly.
- No raw schema issue arrays reach the UI.
- Practice and Mock Exam present clear, non-contradictory results.
- AI usage/cost instrumentation exists for pricing analysis.
