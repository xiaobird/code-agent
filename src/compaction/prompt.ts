export const SUMMARY_PROMPT = `Create a structured summary of this conversation for context continuation.

## Objective
- [one or two sentences: what the user is trying to accomplish]
## Important Details
- [constraints, decisions and why, key facts]
## Work State
### Completed / ### Active / ### Blocked
## Next Move
1. [immediate concrete action]
## Relevant Files
- [path: why it matters]

Rules: terse bullets; preserve exact file paths, symbols, commands, error strings.`

export const SUMMARY_INCREMENTAL_NOTE = `An earlier summary is included below (marked [Summary]).
Update and extend it rather than starting from scratch: keep what is still relevant, drop what is stale, merge in the new developments.`

export const CONTINUE_MESSAGE = "Continue if you have next steps, or reply with a short completion summary."
