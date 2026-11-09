# Key-value stores as diagrams: design

**Status:** approved 2026-11-09 · **Amends:** [the data model map](2026-11-06-data-model-map-design.md), goal 3 ("a key card per NoSQL table") · **Real case:** the project the data model map was probed on (its hub and four repositories; read, never changed)

## Problem

The graph page's Data tab draws each SQL store as an ERD: tables as boxes, foreign keys and refined relations as lines, a table's passport beside it. Key-value stores get none of that.
- **DynamoDB tables** are drawn as a grid of key cards. `render.mjs:556` packs every `dynamodb` store as `cards` with no layout (`render.mjs:642-650`).
- **Redis key spaces** are drawn as one card with their templates as a prefix tree (`data-view.mjs:590`).

Nothing joins one table to another. On the probed project, `infra:dynamodb` holds 21 tables, 17 of them bound to item types, and a message's `orbit_id`, a report's `reported_orbit_id` and a participant's `user_id` all point somewhere. The page draws 21 separate cards.

Relations are also lost where they already exist.
- **Refined relations.** A refined relation on a key-value table is checked (`check.mjs:405`), but only SQL stores attach it as a line: `packStore` adds it through its `else` branch (`render.mjs:624`). On a key card it is only listed.
- **Lineage.** It is drawn as one isolated row per claim, two boxes and an arrow (`lineageSvg`, `data-view.mjs:815`), never inside a store's drawing. So from DynamoDB's `orbit` you cannot see the Redis `{}orbit:{orbit_id}` that mirrors it.

## Goals

- **A diagram for each DynamoDB store.** Tables are boxes laid out by the ERD's own functions (`layoutErd`, `erdBox`). Lines say where they come from, and a box opens the table's key card beside it.
- **A diagram mode for each Redis key space.** Key templates and search indexes are boxes. Its default view stays the prefix tree.
- **Links between entities, labelled by trust:**
  - *refined*, from a refine file, re-checked against the code;
  - a *lead*, from an attribute's or placeholder's name, only within one repository;
  - *extracted*, when a search index's `PREFIX` covers a template.
- **Links across stores as stubs in each store's diagram,** SQL ERDs included. Clicking a stub opens the other store, focused on that entity.
- **The same links for agents.** `graph_data` lists a store's leads. `/grimoire:data-model` turns them into refined relations by reading the code.

## Non-goals (v1)

- **A canvas of every store on one page.** The owner chose stubs (D5).
- **Name leads across repositories.** All 10 such matches on the probed project were wrong (D4).
- **One box per item type for a single-table design.** No extractor records a discriminator, and nothing in `lib/data/` mentions one. This waits for an extractor that does.
- **Name leads on SQL columns** that no foreign key covers (a deduced store's columns, for example).
- **Relations inferred from data flow**, such as an attribute read from one item and then used as the key of a `GetItem` on another table. `access.mjs` places calls on tables but does not follow values.
- **Leads in a diff.** Leads are neither stored data nor refine claims, so `graph_changes`, the change overlay and the delta never list them.
- **Cardinality beyond many → one.** An attribute holding another item's key is drawn many → one, as the ERD draws a foreign key.
- **A refine claim saying "this is not a relation".** On the probed project, the one wrong lead has a real target, and a refined relation to it replaces the lead (D3).

## Decisions

**D1. A Diagram / Cards switch per key-value store. DynamoDB opens as the diagram, a Redis key space as its tree.** *(owner)*
- The switch sits in the store's toolbar. A choice holds per store while the page is open (`st`, like the SQL store's Names / Columns), never across reloads.
- In diagram mode, clicking a box opens the table's `keyCard` (`data-view.mjs:475`) as the passport beside it, in the split the ERD uses (`stage('data', …, sel)`). The card keeps everything it shows today: access patterns, bindings, conflicts, the logical table.
- Rejected:
  - **Cards by default with a Diagram switch** (the brief's first idea). The complaint is navigation, so the default should navigate.
  - **A diagram for Redis by default too.** `web:redis` would open as 11 boxes with no line between them (its `{eventId}` matches nothing in `web`). The prefix tree reads key names better.

**D2. A compact box, with a Fields switch.** *(owner)*
- **Default rows:** the keys (PK, SK, TTL marked as on the cards, `ROLE`), then each GSI and LSI with its keys and projection, then every attribute a line attaches to or that is named like an id (`…_id`, `…Id`), then "+ N more fields".
- **The Fields switch** draws every field: declared attributes and bound item fields, nested ones as dotted paths (`reactions[].user_id`). It works like the SQL store's Names / Columns.
- **Measured on `infra:dynamodb`:** 82 rows in all and 10 at most per box when compact, against 273 rows in all and 50 for `message` (about 1000 px) with every field.
- **`erdBox` gains a key-value row set**, with the same geometry contract (`rows`, `fieldY`, so `layoutErd` routes lines to the attribute's row).
- **The page lays the store out itself,** with the `layoutErd` it already carries (`data-view.mjs:147`, memoized), when the diagram is first shown. Nothing is laid out in Node for a store shown as cards, so the page's size does not grow.
- **More than 60 tables** start as names only (`DATA_COLLAPSE`), as a SQL store does.
- Rejected:
  - **Every field always.** Too tall, and the key card beside the box already holds the item tree.
  - **Keys only.** A line from an ordinary attribute would land on the header, hiding which attribute holds the link.

**D3. Three kinds of line, each labelled with its source. None looks like a foreign key.**

| Line | Comes from | Drawn | Says on hover |
| --- | --- | --- | --- |
| refined | a `relations` claim of a refine file that holds (`check.mjs`) | dashed, the ERD's `rf` | refined, its why and citations |
| lead | the name rule (D4) | dotted, a new `ld` class | a lead from the attribute's name, the rule that matched, "read the code before relying on it" |
| extracted | a Redis search index's `PREFIX` covering a template (`redis.mjs:221`) | thin solid | `PREFIX <p> covers <template>` |

- **Marks.** Lines run from the referencing attribute's row (many) to the target's key row (one), with the ERD's markers.
- **A refined relation replaces a lead** on the same entity and columns, whatever the lead's target. This is how `user_likes.like_id` gets fixed.
- **Drift is never drawn,** as today.
- **A refined relation is drawn on every declaration of its logical table** whose store also declares the other end. Equivalences already make those declarations one table, with their differences as conflicts (`binding.mjs` `logicalTables`). On the probed project, a relation stated on the prod tables also draws on the local `backend:dynamodb` diagram when the local store has both tables.
- The legend names all three. The page and `graph_data` use the same words.

**D4. The lead rule: deterministic, same repository only.** *(owner)*
- **Candidates.** An attribute (declared, or a bound item's field; for a nested one, its last segment), or a key template's placeholder, whose name splits into words ending in `id` (`orbit_id`, `orbitId`, `actor_user_id`).
- **Stems.** The words before `id`, tried from the longest suffix to the shortest (`actoruser`, then `user`). Letter case and `_` are ignored; a trailing `s` or `ies` is dropped on both sides.
- **Targets.** A table whose name stem matches. A name template is cut after its last unknown part (`{env}-{project}-orbit` → `orbit`); a name with no literal part has no stem. The target must be:
  - in the same store; or
  - in another store of the same repository; or
  - the logical table such a table belongs to.

  Never in another repository: the logical-table grouping keeps the same rule, "never by a bare name across repositories".
- **The line ends** at the target's partition key. When the target also has a sort key, the hover says "partition key only: the item also needs its sort key".
- **Ambiguity.** Two targets for one stem make no line. `graph_data` lists both, as bindings list rivals.
- **`id` alone is no candidate.** A table's own key can be a lead (`user_entitlements.user_id` → `user`), and a self-reference draws a loop.
- **Measured on the probed project:**

  | Scope | Lines | Wrong | Missed |
  | --- | --- | --- | --- |
  | Inside `infra:dynamodb` | 22 of 39 id-like attributes | 1: `user_likes.like_id` holds a user id (`user_like.rs:13,101`) | about 10 user references named by role (`owner_id` ×4, `sender_id`, `blocker_id`, `blocked_id`, `liker_id`, `reported_sender_id`) and the polymorphic `target_id` (`moderation_audit.rs:130`) |
  | Redis placeholders → same repository (`{user_id}` ×4, `{orbit_id}`) | 5 | 0 | — |
  | Redis placeholders → another repository (web's `{eventId}` → the backend's `events`) | 10 | all 10: web's `eventId` is a vote event read from a query parameter (`web/src/server/vote.ts:11`, `app/api/vote/snapshot/route.ts:26`); `events` holds async job statuses (`events.rs:30`) | — |

- Rejected:
  - **Refined only.** The probed project's refine file has no relation, so its diagrams would draw no line until `/grimoire:data-model` runs.
  - **Leads everywhere.** All 10 cross-repository matches were wrong.

**D5. Links across stores are stubs in each store's diagram.** *(owner)*
- A **stub** is a small box at the diagram's right edge: the other store's id and the entity's name, grouped by store, sorted by name. A line runs to it from the entity it links. Clicking it opens that store with that entity focused (its passport or key card), clearing a repository filter that hides the store.
- **What makes a stub:**
  - a lineage claim (`mirrors · refined`, an arrow from the mirror to the mirrored);
  - a refined relation whose ends sit in two stores;
  - a lead to a table of another store of the same repository.
- **A logical table's declarations count as one end,** so a link to it is drawn on each declaration's diagram (D3).
- **Every diagram gets stubs:** DynamoDB, Redis in diagram mode, and the SQL ERDs. That is how `app:drizzle/chat_messages` shows the `message` table it mirrors.
- **At most 12 stubs per diagram.** Beyond that, one "+k in `<store>`" stub per store lists the rest on hover.
- The Refined section's lineage drawing stays as it is: a list of every lineage claim.
- Rejected:
  - **One project canvas.** About 77 boxes on the probed project, and the 12 local and prod duplicates double the DynamoDB part.
  - **Stubs plus a store-level map.** Its job is done by the store picker and the stubs.

**D6. A Redis key space in diagram mode.**
- **A key template is a box:**
  - its type badge (`hash`, `json`, `stream`…);
  - its placeholders as key rows (`{orbit_id}`);
  - its fields;
  - its lifetime, or the no-expiry lead.
- **A search index is a box** with extracted lines to the templates its `PREFIX` covers (D3).
- **Leads.** Placeholders draw leads (D4), mostly as stubs, since a cache is keyed by another store's ids. On the probed project, `backend:redis` gets 2 coverage lines and 5 lead stubs to `Users` and `Orbits`.
- **Channels stay in the card.** They are pub/sub names, not stored data.
- **The passport** is the template's row from the card: readers, writers, conflicts.

**D7. Refining the links: no new claim kind, schema 1 unchanged.**
- **Placeholders count as fields.** When a `relations` or `lineage` claim names a key template's placeholder, `fieldIn` (`check.mjs:358`) accepts it as one of the template's fields, so `backend:redis/{}orbit:{orbit_id}(orbit_id) → …/{env}-{project}-orbit(id)` can be claimed and checked. A citation still has to name it.
- **`/grimoire:data-model` gains a step:** read the store's leads from `graph_data`, and confirm each one by the code that looks the target up with that attribute (the access patterns point to it). It writes a refined relation for:
  - every lead it confirms;
  - the real target of a lead it finds wrong (`like_id` → `user`);
  - the role-named references the rule misses (`owner_id`, `sender_id`…), found through the same lookups.

  A fully refined store then shows no dotted line. The skill's evals gain a case for this.
- Rejected: **leaving confirmed leads as leads.** A lead is never checked, while a refined claim is re-checked by citation on every render, which is the point of refining.

**D8. Agents see what the page draws.**
- `graph_data` with a store lists its leads (the attribute, the target, the rule's words, any rivals). With an entity, it lists that table's leads and stubs.
- `graph.mjs data show` prints the same.
- The rule lives in one module, `lib/data/links.mjs`, used by `dataData` (`render.mjs`) and by `graph_data`, so the page and the tools cannot disagree.

**D9. The overlays carry over to the diagram.**
- With the change overlay ("Changes vs base") or the delta on, the diagram is drawn as the ERD draws them:
  - marks on boxes and rows;
  - a removed or proposed table as a ghost box;
  - before → after on its row.
- Key-value tables already carry those marks (`packChanges` with `cards`, `packDeltaStore`); only the layout of the overlay's table set is new, and the page computes it.
- Until slice 3 lands, turning an overlay on shows the store's cards with a note, as today, never a diagram missing its marks.

## Vertical slices (smallest first)

Each is demoed on a fixture of its own and, read only, on the probed project.

1. **DynamoDB diagram, refined lines.** D1, D2 compact, the key card as passport, refined relations drawn (D3), on every declaration of a logical table. An overlay switches to the cards. *Demo:* a fixture of three DynamoDB tables with two refined relations. the probed project's `infra:dynamodb` as 21 boxes and no line: the honest picture before leads.
2. **Leads within a store.** `lib/data/links.mjs` (D4), dotted lines, a refined relation replacing a lead, `graph_data` listing leads and ambiguities (D8). *Demo:* the probed project's 22 lines, `like_id` drawn as a lead. On the fixture, a refined `like_id → user` replaces it.
3. **The Fields switch and the overlays in the diagram.** D2's every-field rows, D9. *Demo:* a branch adding a GSI drawn green on its box, and a delta proposing a table drawn as a ghost box.
4. **Stubs across stores** (D5), in every diagram including the SQL ERDs. *Demo:* the probed project's `orbit` ↔ `{}orbit:{orbit_id}` and `message` ↔ `chat_messages`, each opening the other store.
5. **Redis in diagram mode** (D6). *Demo:* `backend:redis` with its coverage lines and lead stubs. `web:redis` still opens as its tree.
6. **Refining the links** (D7). Placeholders in the check, the data-model skill's new step and its eval. *Demo:* the fixture refined until no dotted line is left. The probed project's own refine pass is its owner's call.

## Edge cases and failure modes

- **A name with no literal part,** or a Terraform `${…}` value no file states, gives no stem and no lead, never a guess.
- **Two tables with one stem** (`orbit` and `orbits` in one store) make no lead. Both are listed as rivals.
- **The logical table.** A lead or refined line to a table with several declarations is drawn wherever both ends are declared. When the local store lacks the other end (the probed project's 6 tables only in prod), no line is drawn there, and no stub stands in for it.
- **A refined relation that drifts** is never drawn, and the lead it replaced comes back. The drift is listed, as today.
- **A large store** (more than 60 tables) starts as names. Lines still run between the named boxes; a focus or a search draws boxes with rows, as the SQL ERD does.
- **More than 12 stubs** fold into one per store (D5).
- **A stub whose store a repository filter hides** clears the filter when clicked, never a dead click.
- **A static page and a served one** draw the same. Nothing here writes.
- **An extractor that fails** leaves its facts out. The leads are computed from what was read, so a missing table means a missing lead, and `graph_status` reports the failure as today.
- **Escaping.** Every name, path and template goes through `esc`/`h()`, as the ERD and the cards do. Key templates contain `{`, `:` and `}`.
- **Performance.** Leads are one pass over the attributes against a map of table stems, per render. The diagram is laid out once per store and memoized.

## Questions still owned by the user

- **Slice order.** The list above is a default.
- **Later, not now:**
  - name leads on SQL ERDs for columns no foreign key covers;
  - a store-level map;
  - one box per item type once an extractor states a single-table design's discriminator.

## Data model and architecture delta

None. The design changes how the Data tab draws the model and adds a module inside `tools/graph/lib/data` (the architecture's `data-model` component). The page already reaches it (`page → data-model`, "Data tab · change views", `docs/architecture/grimoire.architecture.json`). It changes no store, entity or key, and no component, connection or boundary. So no `.delta.json` is drafted.

## Sources consulted

- **Docs:**
  - this repository's harness memory (empty) and the user's memory: build our own, the built-in browser for visual checks;
  - `docs/specs/2026-11-06-data-model-map-design.md` (D2, D5, D8, slices 6–13), `docs/research/2026-11-06-data-model-map.md`;
  - `tools/graph/README.md` "Data models" and "Refined";
  - `skills/data-model/SKILL.md` (the relation row: "a key-value attribute holding another item's key"), `skills/data-model/evals/evals.json`;
  - `docs/architecture/grimoire.architecture.json`;
  - the sibling session notes (the probed project's refresh, 2026-11-09).
- **Code:**
  - `tools/graph/lib/render.mjs`:
    - `:205-217`: refined relations, SQL only;
    - `:554-556`: `CARDS`;
    - `:566`: `packKeySpace`;
    - `:609-650`: `packStore`;
  - `tools/graph/lib/data-view.mjs`:
    - `:145-162`: the scene and the in-page layout;
    - `:258-299`: the ERD;
    - `:475-575`: the key cards;
    - `:590-653`: the key space;
    - `:815`: `lineageSvg`;
  - `tools/graph/lib/data/layout.mjs`: `erdBox`, `layoutErd`;
  - `tools/graph/lib/data/check.mjs`:
    - `:352-363`: `entitiesOf`, `fieldIn`;
    - `:405-426`: relations;
  - `tools/graph/lib/data/redis.mjs:219-226`: `PREFIX` coverage.
- **Measured** on the probed project's index, read only, through a script that loads the reconciled model (`refineModel`) and never indexes:
  - the lead rule's yield and errors (D4);
  - the compact box's rows against every field's (D2);
  - `graph.mjs data` (0.43.2): 8 stores, 12 logical tables, 25 refined claims, no relation among them.
- **The probed project's code, read** to judge the leads:
  - `backend/lib/src/db/entities/user_like.rs`, `events.rs`, `user.rs`, `moderation_audit.rs`, `message.rs`;
  - `web/src/server/vote.ts` and its routes.

## Self-answered questions

| Question | Answer | Source |
| --- | --- | --- |
| Is there an in-house precedent for drawing a guess? | Yes: a binding below convention is drawn dashed and lists its rivals, and a deduced store's joins are drawn as "inferred, never a foreign key". Leads follow both. | `data-view.mjs:521`, `:268-271` |
| Does the check accept a relation on a key-value table today? | Yes. The fields include the bound item's, matched exactly. Only the drawing is missing. | `check.mjs:352-363`, `render.mjs:624` |
| Does it accept a Redis placeholder as a column? | No: placeholders are not fields of a template entity. D7 adds them. | `check.mjs:358`, `redis.mjs` template fields |
| Single-table design: a box per item type? | Not possible yet: no extractor records a discriminator. A box per table. | `grep discriminator lib/data` (none) |
| Lay out in Node or in the page? | In the page: `layoutErd` is already injected and memoized for SQL subsets, so stores shown as cards cost nothing. | `data-view.mjs:145-149`, `render.mjs:51` |
| What opens beside a box? | The key card as it is today: no second passport to build or keep in sync. | `data-view.mjs:475` |
| Should the data-model skill refine confirmed leads, or leave them? | Refine them: a refined claim is re-checked by citation on every render, a lead never is. | spec D8 of 2026-11-06 |
| Do leads belong in the delta or the change overlay? | No: they are neither stored data nor claims, so a branch cannot "change" a lead. | `delta.mjs` targets |
| Does this change grimoire's architecture diagram? | No: `page → data-model` already carries the Data tab. | `grimoire.architecture.json` |
| Is lineage "never drawn" (the brief)? | It is drawn, one row of two boxes per claim in the Refined section. It is never drawn inside a store's diagram, which D5 adds. | `data-view.mjs:794-833`, README "Refined" |

## Docs drift fixed

None in the docs. The README's "Data models" and "Refined" sections, the data-model skill and `data-view.mjs`'s header match the code they describe. One premise of the brief was off, and is corrected here (Self-answered, last row): lineage is drawn, but only as a list of pairs. The 2026-11-06 spec's goal 3 ("a key card per NoSQL table") is a forward-looking spec, not drift. Its status line now points here. The README, `data-view.mjs`'s header and the data-model skill will need these additions as the slices land; each slice updates them.

## Reference projects

None consulted for this roast. The pattern has a precedent in this codebase: the ERD's layout and its line vocabulary (refined, inferred from a join, below-convention bindings). The earlier research already borrowed tbls's *virtual relations* for relations no key states (research §4). No new dependency, per *build our own*.
