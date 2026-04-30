# Current State

## Branch and deployment
- Active branch for stabilization: `feature/question-format-system-no-ci`
- Active Vercel project: `grounded-study-update`
- Live beta domain: `sulcai.com`
- Use preview deployments for branch testing.
- Do not rely on production deploys for feature-branch debugging.
- Live beta access is restricted by `BETA_ALLOWED_EMAILS`.
- Vercel custom domains serve Production deployments, so Production Branch alignment matters.
- Vercel Pro is active, with Vercel Cron configured for `/api/cron/process-ingestion`.
- `CRON_SECRET` is required and configured in Production.

## Current deployment gotcha
- If `sulcai.com` shows an older UI, first check the Vercel Production Branch.
- Then check the latest Production deployment commit in `grounded-study-update`.
- During stabilization, preview deployments were often treated as the source of truth, so it is possible for preview and Production to diverge.

## What is currently true
- Google sign-in and email magic link are both production-ready auth paths.
- Email magic link is wired via Resend with DKIM/SPF/DMARC verified on `sulcai.com`.
- Google and magic-link access are restricted to the beta email allowlist in `BETA_ALLOWED_EMAILS`.
- Upload works and learner flow now attempts ingestion automatically after upload.
- Documents can reach `READY`.
- Upload can hand users into generation-at-upload, with progress shown through background generation jobs.
- Question Format page exists and supports text-only, file-only, and text+file creation flows.
- At least one generated question with citation has succeeded.
- Generate Questions now queues `GenerationJob` rows and shows resumable progress while Vercel Cron processes pending generation jobs.
- Practice Questions can display generated questions and provide cleaner structured feedback.
- Practice has New / All / Previously Incorrect tabs, with corrected session numbering.
- TRUE_FALSE questions can render and are graded deterministically.
- Mock Exam now returns a persistent review/results view after submit.
- Mock Exam setup includes a question type selector for multiple choice, true/false, and mixed exams.
- Short-answer review is presented separately from deterministic objective scoring.
- Generate Questions no longer exposes the saved Question Format selector in the main runtime flow.
- Learner-facing wording has expanded display-time sanitisation for retrieval jargon in stems, options, answers, rationales, feedback, and citations.
- Prompting has been upgraded for stronger grounding, verifier rigor, short-answer feedback quality, and broader domain-agnostic assessment style.
- Account page supports self-delete.

## Project status
Grounded generation is no longer hypothetical.

The app has reached real end-to-end success on the active preview branch and has now undergone several stabilization and UX passes.

Current focus has shifted to:
- repeatability across fresh generation runs
- validating the newest upload -> ingest -> generate -> practise loop on newly created content
- cost instrumentation for pricing
- release/documentation cleanup
- keeping live private-beta deployment state aligned with the active branch

## Release posture
- private beta only
- not public launch

## Important recent improvements
1. Structured practice feedback for MCQ / TRUE_FALSE is explicit.
2. Practice supports better session flow and cleaner summaries.
3. Mock Exam review persists after submission.
4. Upload now attempts auto-ingestion in the normal learner flow.
5. Generate flow is simplified and no longer asks users to choose both Question Format and runtime question type in a conflicting way.
6. Short-answer review is framed as model-answer-based review rather than misleading hard scoring.
7. Retrieval-jargon leakage into learner-facing wording has been reduced via prompt and display cleanup.
8. Generation now runs through background `GenerationJob` rows with a Vercel Cron processor backstop.
9. Sign-in includes production-ready Google and Resend magic-link paths behind the beta allowlist.
10. Account self-delete, Practice source tabs, and Mock Exam question type selection are in place.

## Recent changes since stabilization began
- Legal documents have been revised to remove cross-user reuse language.
- Legal documents now state that user content is not used for model training.
- A Copyright Takedown Policy has been added and linked from the sign-in consent flow.
- The legal consent version has been bumped so existing beta users can be re-prompted.

## Recent classes of bugs already encountered
1. Deployment mismatch
2. Missing DB migration for `StyleProfile.instructionsText`
3. Admin env / admin UI availability
4. Brittle strict structured-output path
5. Raw Zod issue arrays leaking to the UI
6. Style-profile normalization gaps
7. Generation/verifier schema mismatch
8. Prompt/schema alignment problems around citations and option count
9. Retrieval-style wording leaking into learner-facing question/feedback text
10. Confusing overlap between Question Format and runtime generation controls

## Current likely stabilization focus
The broad parser architecture is much healthier now.

Remaining work is likely to be:
- proving fresh success across MCQ / SHORT_ANSWER / TRUE_FALSE
- handling old saved style profiles safely
- adding cost/usage instrumentation
- cleaning branch/repo/project-doc state
- validating repeatability before wider release
- keeping Production Branch alignment with the branch currently treated as active in practice

## Recommended test discipline
Always test on the latest preview with:
- one brand-new upload when validating ingestion
- one READY document
- one question only when testing fresh generation
- fresh Question Format names
- explicit comparison where relevant:
  - no Question Format in main generate flow
  - fresh Question Format creation in its own page
- practice and mock exam validation using newly generated questions, not only legacy ones

## Strong recommendation
Do not add major new features until the following are true:
- text-only Question Format creation works reliably
- file-only Question Format creation works reliably
- text + file Question Format creation works reliably
- fresh MCQ generation works without hidden UI dependencies
- fresh SHORT_ANSWER and TRUE_FALSE generation are proven
- no raw schema issue arrays reach the UI
- upload -> auto-ingest -> READY works reliably in the common learner flow
- pricing is informed by measured usage data rather than guesses
