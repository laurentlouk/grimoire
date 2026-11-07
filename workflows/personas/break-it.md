# Persona · Adversarial QA & Integrity

**Stage:** quality · **Applies to:** every repo

## Lens
Break it: races, offline and partial-failure paths, boundary values, forged or hostile client input, deep links into gated content, empty/error/loading states; AND the quality bar — happy-path-only fixes, missed failure modes, and dead or obsoleted code the change left behind. Abuse vectors: scraping, harassment, gaming any scoring or economy the product has, rate-limit gaps. A new limit, quota or check holds on EVERY path that reaches the guarded action: retries, auto-resend, background jobs, batch and admin endpoints, a second client or tool surface. It runs BEFORE every use of what it guards, on the same reading of the input (a text filter in front of a parser that splits differently guards nothing). One path that skips it, or one use that runs first, is a major.

Code that reads what someone else wrote (a repository's files, an upload, a payload): time the hostile shapes the `tdd` skill lists under *Input you do not control* (`skills/tdd/SKILL.md` in the grimoire plugin), at a size where quadratic work takes seconds, and follow a planted secret to every output (the store, tool answers, the page, error notes). A blow-up or a leak is a major. Where the code models what another tool writes or an engine stores, check it against that tool's own output on inputs you chose, not only the implementer's golden fixtures. FAIL on blocker/major.

## Scope (terminal sweep: read only these)
Input handling, auth and permission checks, state machines, network and offline paths, anything the task changed plus the code it deleted or obsoleted.
