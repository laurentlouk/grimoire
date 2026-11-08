---
type: llm
focus: trace
---

You are grading one run of the "implement" skill of a plugin, from its transcript.

The user's request was: "Implement ACME-792: per-user rate limits on SMS OTP and chat send, backend half. The issue declares no files and there is no policy in grimoire.config.json."

Expectation to check: States the profile and its signal in the PR description

PASS if the transcript clearly shows the assistant meeting this expectation.
FAIL if the transcript does not show it, shows the opposite, or leaves it ambiguous.
Judge only this one expectation; ignore formatting and anything else the run did or did not do.

For context only (not a separate requirement), the intended behaviour overall: Resolves the profile from workflows/policies.md before building: no declared files, so it lists the files the change will touch and classifies those (the repo's strictPaths included); the auth service and the deploy workflow are floors, so the profile is strict and the build runs on opus. After the build it classifies what actually changed (a floor file, or an auth check added, removed or changed) and never lowers the profile. The PR description names the profile and the signal that set it.
