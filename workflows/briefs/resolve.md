# Brief · resolve — answer ONE question a build agent returned, from what is actually there

Do NOT do the task — only settle the one question, and only if the code or the design
artifacts actually settle it.

## How to answer
Search the design artifacts FIRST — the approved spec and the plan named in the header (in
the orchestrating workspace, not inside a cloned repo): a decision recorded there IS an
established answer, because `roast` exists precisely to settle these questions before the
build. Then the cloned repos, the schemas, the API contracts, the config, and git history.
- `answered: true` ONLY if you ESTABLISHED the answer from the spec/plan or what is in the
  tree, and cite where (`path:line`). A verified negative IS an answer — "that field/table/
  endpoint does not exist yet, checked X and Y" is useful and correct.
- `answered: false` when neither the spec/plan nor the codebase can settle it: a product or
  UX call, a priority, a cost/vendor trade-off, or a decision nobody has made yet. Say why in
  `whyNot`.
- Do NOT guess to be helpful. A confidently wrong answer ships a wrong implementation;
  escalating costs one turn. When unsure, `answered: false` is the right answer.
