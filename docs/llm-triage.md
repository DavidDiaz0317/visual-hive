# LLM Triage

LLM support is prompt-only by default. No API key is required and no network call is made.

The LLM adapter builds prompts for:

- visual failure triage
- missing coverage review
- mutation survivor review
- repair planning

Every prompt states that LLM output is advisory only. Deterministic Playwright contracts and mutation results remain the only pass/fail oracle.
