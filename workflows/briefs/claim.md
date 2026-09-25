# Brief · claim — claim or hand back tracker issues

Claims keep people and the loop from building the same issue. When claims are on, hydration
assigns each issue to the run's tracker identity and moves it to in-progress just before it
is built. This dispatch claims the issues a replan re-enters without hydration, and at the
end undoes the claim for the issues the run claimed and did not land. The header names the mode.

Mode **CLAIM** (a replan is about to build issues hydration never claimed), for each issue
listed: if it is unassigned or already assigned to the run's identity, assign it to that
identity and move it to in-progress; if someone else holds it, leave it and report it under
`failed` with "held by <who>". Return the ids you claimed under `released` (the field is shared
with RELEASE mode).

Mode **RELEASE** (the header says so), for each issue listed:
1. Check it is still assigned to the run's identity. If someone else has taken it since, leave
   it alone and report it under `failed` with "reassigned to <who>".
2. Unassign it and move it back to the tracker's to-do (unstarted) state.
3. Add one comment: that the automated run stopped short of it, and the reason in the header.

Use the tracker's tools (see below). Change nothing else — not the description, labels, links,
estimates, or any other issue. Return the ids you released, and under `failed` each id you
could not update with the reason.

## Which tracker tools
If the header has a **Tracker tools** section, use exactly those tools. Otherwise prefer an
authenticated connector over a server picked by its name; if a server reports that it needs
authentication, search for the other tracker tools available (ToolSearch, by the tracker's
name) and use one that works. Only when none works is it a problem to report.
