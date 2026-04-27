# Known Bugs / Open Issues

## 1. Practice feedback wording is too vague
Current observed behavior:
- after answering a TRUE_FALSE question, feedback may show “Needs review”
- explanation may imply the answer is right, but does not directly say “Correct” or “Incorrect”
- correct answer is not stated prominently enough

Desired behavior:
- explicit correctness label
- explicit correct answer
- then rationale and citation

## 2. Old saved Question Formats may still be unreliable
Saved profiles created before major normalization fixes may contain malformed schema JSON.
For validation of new changes, prefer freshly created Question Formats.

## 3. Branch/repo cleanup still needed
Engineering hygiene still needs work before merge/release:
- worktree cleanliness
- CI decision
- backup bundle handling
- reproducible build cleanup

## 4. Repeatability across question types still needs proof
At least one successful grounded generation has occurred, but the app still needs deliberate confirmation across:
- MCQ
- SHORT_ANSWER
- TRUE_FALSE
