# LLM Guardrails

## Core Rules

- Every question must include citations referencing retrieved chunks.
- Rationale must be fully grounded in excerpts.
- A second-pass verifier must approve the question.
- If evidence is insufficient, the question is rejected.

## Pipeline

1. Retrieve top-K chunks (pgvector similarity).
2. Generate question with structured JSON output.
3. Verify answer support and distractor correctness.
4. Store only if verifier passes.

## Failure Handling

- If generation fails or verifier rejects, the system retries with different chunks.
- After max retries, generation returns `INSUFFICIENT_EVIDENCE`.

## Short Answer Grading

- Uses LLM grading with strict grounding to citations.
- If evidence is unclear, returns `NEEDS_REVIEW`.
