# Known Bugs / Open Issues

## 1. Practice feedback wording was too vague — closed
Status: fixed.

Practice now shows explicit objective correctness labels and the correct answer, and display-time sanitisation removes retrieval jargon from stems, options, answers, rationales, feedback, and citations.

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

## 5. Consent re-prompt needs beta validation
Legal consent versioning now redirects users with an old `legalVersion` through `/legal/accept`, but this should be validated on the latest deployment with a real allowlisted beta account after release.
