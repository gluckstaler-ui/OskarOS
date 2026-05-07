## TARGET FILE
{{sessionPath}}

## HOW TO WORK
The current SESSION.md content is inlined at the END of this prompt under
`## CURRENT SESSION.md CONTENT`. That block IS the live state — do NOT call the
Read tool. Use ONLY the Edit tool to write changes back to the file at the path
above.

(2026-04-20: switched from "Read the entire file before editing" to inlined
content. Reason: the Read tool's 25K-token output ceiling forced a multi-round
paging cycle per stage, costing ≈14 ceiling errors per 7-stage run on a 140KB
file. Inlining the content skips the ceiling entirely.)

## RULES
- Every cut leaves exactly ONE replacement line. No holes.
- NEVER touch: user messages, discovery Q&A, CD creative responses, debugging exchanges, escalation sequences, teaching moments, code blocks.
- NEVER rewrite in your own words. Replace dead wood with stumps.
- If unsure, leave it standing.
