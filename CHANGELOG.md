# Changelog

## 0.41.0 — the data model map deduces a SQL schema from the queries the code sends, for a database nothing in the repositories declares (data model map slice 14, #106)

A database that lives only in production, with no migrations, dump or schema in the repositories and reached by raw SQL, had nothing for the map's readers: it was only listed as a gap, through its client imports. Yet the statements the code sends state most of its model. The map now reads them, as the least trusted kind of fact, `inferred`: never connecting to a database, never running the code, never overriding a declaration.

- **An inferred extractor over SQL in code** (a new extractor in `lib/data/extractors/`), found by content (a query call beside SQL text, or a SQL client import: bit 64 of a source file's level), through the pinned grammars, in TypeScript and JavaScript (calls named query, execute, exec, prepare, raw, unsafe and the raw-query methods of an ORM client; `sql`-tagged templates; a config object's text), Go (the standard library's Query, QueryRow, Exec, Prepare and their Context forms, and the extension library's Get, Select and named forms, the SQL wherever it sits among the arguments), Python (execute and its siblings, the async driver's fetch methods, a data-frame library's read_sql, a toolkit's `text(…)`) and Rust (a query macro, its typed form after the type, the query functions with or without a turbofish, the embedded driver's execute and query methods). The SQL: a literal, a same-file constant that nothing can change (a `const`, a Go `const`, a Python module-level ALL_CAPS name assigned once; never one a parameter or a local shadows), a concatenation, a format string. Prose is no SQL (a capitalised verb is read only in one case style to the statement's end). The content filter run on every source file is linear, and a file is read in one walk down its tree, within 10 s.
- **Inert by construction**: whatever code fills in (a template's `${…}`, an f-string's `{…}`, a format verb, a concatenated variable) is a parameter, never evaluated; a table or a column named by one is never a table or a column, only counted; every parameter style is one (`?`, `?1`, `$1`, `$name`, `:name`, `@name`, `%s`, `%(name)s`). Only identifiers are kept, never a literal's value: a `"…"` in a value position (a string in MySQL, and in SQLite where no column has its name) is never a name, and a backslash before a closing quote, which only some dialects read as an escape, ends the statement's reading there; what is not read is noted by its line, never its text. Test code is counted, not read.
- **A statement reader** (a new reader in `lib/data/readers/`) on slice 12's splitter and tokenizer: SELECT with CTEs (a CTE's name read as no table), subqueries, derived tables, unions; INSERT with its column list, `INSERT … SELECT`, the MySQL and SQLite upsert forms; UPDATE with Postgres' `FROM` and MySQL's joined form; DELETE with `USING`; TRUNCATE; RETURNING; ON CONFLICT; ON DUPLICATE KEY UPDATE. Aliases, qualified names and correlated subqueries are resolved within a statement; a bare column only where one table can hold it; a table named like a keyword is a table, a system catalog never one, and what does not read as a table ends a FROM list; `SELECT *` reveals no column; output aliases, functions, keywords, typed literals, interval units and cast types are no columns. Bounded and linear: 256 KB a text, 200 statements, 20 000 tokens a statement, a nesting of 64, capped facts; a hundred thousand parameters, deep nesting and an unterminated quote stay bounded.
- **What it deduces**, each with the `path:line` of every statement that shows it: tables; columns; relations *inferred from a join* (ON, USING, an implicit join, a correlated subquery; a conjunction of equalities only; the `id` side referenced), never foreign keys; unique keys from an `ON CONFLICT` target; lookup columns (WHERE equality, `IN`, `= ANY`, ORDER BY), a lead for an index, never an index; readers and writers per function, through the code graph's symbols. Types (but for the casts the code states), nullability, defaults and other constraints stay **unknown**, and say so.
- **Store identity and trust** (spec D2): per repository, never across two without evidence. A file's dialect is its client's, else a type naming the database, else the repository's clients', else its SQL's own markers. Its queries **attach** to a declared SQL store of the repository only on evidence (the same client, the module they share; being the only declared store of its dialect or of the repository attaches only when the queries name a table it declares; a contradicting dialect never attaches), saying how many of the tables they name it declares, and then only add an `[inferred]` conflict where the code names a table or a column the declarations lack, and access sites on the declared tables: the declared model wins. Otherwise they are a store of their own, `<repo>:sql (inferred, <dialect>)`, named by its clients, saying why it attaches to none. A client whose queries are read is no longer a gap (one whose queries are not read stays one, and a deduced store covers its own repository only). The branch diff never compares a deduced store.
- **Shown**: `graph_data` lists the deduced store labelled inferred (its clients, how its dialect is known, what stays unknown) and the queries attached to a declared store; a deduced table with its columns, keys, joins, lookups, readers and writers; a declared table with its readers, writers and `[inferred]` conflicts. The Data tab draws a deduced store as an ERD under a banner saying it is deduced from queries, not declared: dashed table frames, columns *seen in code*, nullability unknown, relations as dashed lines *from a join*; everything escaped. `graph_status` counts the files whose SQL was read.
- **The index's schema moves to 12** (a source file's level gains bit 64): an older index is rebuilt once.
- Docs: `tools/graph/README.md` (*SQL schemas inferred from the queries in code*, the gaps). Tests: the statement reader on every statement kind, parameter style, cast and hostile text; the trust rules on hand-built facts; the call sites per language; then a synthetic shop through `call()` and the page (a TypeScript service's tagged templates and a Go service's parameterised queries against one database, no migration), and the same shop once migrations are added.

## 0.40.0 — the data model map is refined in a checked file: lineage across stores, stores no extractor reads, local and production declarations of one table, every claim re-checked, drift never trusted, gaps listed (data model map slice 13, #87)

The map extracts what files declare. What no file declares now has a place of its own, written by an agent that read the code and checked by the script on every answer and every render, the way the architecture diagrams are.

- **A new skill, `/grimoire:data-model`**, mirroring `/grimoire:architecture`: read the extracted map (`graph_data`: stores, logical tables, item types, access leads, drift, gaps), read the code at each lead, write or update the refine file, run `graph.mjs data check` until no claim drifts, show the Data tab. Its evals cover a lineage and a described store, fixing drift, an equivalence, and the two requests it is not for.
- **The refine file**, `docs/architecture/<name>.data.json` beside the diagrams (`graph.architectureDir` moves the folder), with six claim lists, each claim citing `repo:path:line`: `lineage` (an entity of one store mirroring one of another, field pair by field pair), `relations` no foreign key states, `indexes` (what an index is for), `bindings` the script left ambiguous, `equivalences` (declarations of one table no evidence ties, each named as written: an exact name or a name template, and the file that declares it) and `stores` no extractor reads yet, described entity by entity with a citation per field. Validated strictly and bounded (1 MB, 16 levels, 2000 claims, 20 citations per claim, 500 entries per list, capped strings, only the format's keys, so a `__proto__` key is refused); errors say where, never what a file holds.
- **The check** (`lib/data/check.mjs`), on every `graph_data` answer, render and `data check`, through one entry every caller shares: each citation resolves inside its repository, its lines exist and name what the claim states (one of its names, letter case aside, never inside a longer identifier; a template by its longest literal part). It confirms names at lines, not meaning: a citation proves its line names something the claim states, not that the line shows the relation. The claim must also agree with the extracted model (its entities, fields, indexes and item types exist; a foreign key or a binding the code states at convention or above contradicts it; an equivalence's declarations exist under the names or templates stated; a described store is no store an extractor reads). A claim that fails is drift, listed with where and why, never drawn or listed as a fact; an equivalence's citations are checked before the model is grouped, so one that drifts groups nothing. Bounded in what it reads: each cited file once per check by its real path, at most 1000 files and 64 MB, a line scanned up to 4096 characters and 64 MB scanned in all, each limit a plain drift past it.
- **Equivalences group the declarations** they tie into one logical table, so their differences are conflicts with each declaration's `path:line`, and an item type bound to one is bound to all; the same equivalences group the base's model, so a branch's diff compares the code only. A key-value table that no item type, call, built name or infra variable reaches in the code read says *declared, no code uses this name*, never paired by a guess.
- **Gaps**: the datastores the production code reaches through client imports (the architecture's known databases, and the key-value SDK's clients) that no extracted store and no refined store covers are listed in `graph_data`, `data check` and the Data tab.
- **Labelled refined everywhere**: `graph_data` lists the claims that hold, then *Drift* and *Gaps*, answers for a described store or entity, and lists the refined facts about an entity; `graph_changes` re-checks the claims on the branch, so a branch that breaks a citation says so; `graph.mjs data check [<file>…]` exits 1 on drift or a file that does not validate (a gap is never an error). The Data tab draws drift as a badge and a list, lineage as lines from one store's entity to another's with their field pairs, the described stores as cards, a refined relation as a dashed line on its ERD, an index's purpose under its row, a key card's refined logical table and its no-code note; everything escaped.
- Docs: the skill, `AGENTS.md` (the Docs store holds the data maps beside the diagrams), the README (the skill, the data model), `tools/graph/README.md` (*Refined: what no file declares, checked*). Tests: the format, each claim kind and each way it drifts, the grouping, the note and the gaps on hand-built models, then a synthetic project through `call()`, the CLI and the page (a lineage across two stores, a stale citation, a described document store, a local table and its production template, an unread cache client).

## 0.39.0 — the data model map reads Postgres and MySQL migrations statement by statement, in each migration tool's order, and schema dumps beside them (data model map slice 12, #86)

Until now a Postgres or MySQL migration folder was found and listed, never read: only SQLite folders could be replayed, by the engine itself. The map now reads Postgres and MySQL DDL by hand, never running it and never against a database, in the order each kind of migration tool applies its files, and a schema dump as the store the database has.

- **A statement splitter and tokenizer** (a new reader in `lib/data/readers/`), one linear pass, each dialect's own rules: strings with doubled quotes (and backslashes where the dialect escapes with them), quoted names and backticks, dollar quoting (`$$`, `$tag$`), line and nested block comments, MySQL's version comments read as code and its `DELIMITER` lines, a generator's statement breakpoints, a psql meta-command line as a statement of its own, a migration tool's statement-block markers, a routine's `BEGIN … END` body kept whole (and split again at each `;` when it never closes, so it swallows nothing). Exported as the seam other SQL readers will use (the SQL a project's code sends).
- **An interpreter** for the statements that shape a store, replayed in order: `CREATE TABLE` (keys inline and table-level, foreign keys with their actions, defaults, generated and identity columns, serials, schema-qualified names; `LIKE`, `INHERITS` and `PARTITION OF` noted, not followed), `ALTER TABLE` with one action or several (add, drop and rename a column, change its type, nullability or default, add and drop constraints, rename the table; MySQL's `MODIFY`, `CHANGE`, `FIRST`, `AFTER`, `ADD INDEX`), `DROP TABLE`, `CREATE` and `DROP INDEX` (partial, an expression kept as its text), enums and their added and renamed values, schemas, views by name, sequences owned by a column, MySQL's `RENAME TABLE` and inline keys. Postgres folds unquoted names to lower case; MySQL's stay as written. Every other statement (`DO` blocks, functions, triggers, policies, row level security, grants, comments, `INSERT`, `SET`, extensions) is skipped and counted, per file, by kind; one that does not read is noted at its line, never with its text, and the replay is then not compared for what it lacks.
- **Each tool's order**: a journal when there is one; a migration tool's versioned files (`V<version>__`) by version, number by number (`V9` before `V10`), its repeatable `R__` files last by name, its undo files never; up and down files (the up ones alone); a file's up section alone; numeric and timestamp prefixes otherwise. A folder whose order cannot be decided is reported as such, never replayed in file-name order.
- **Schema dumps**: a `structure.sql` or `schema.sql`, or any file a database's dump tool wrote (by its header, whatever its name; a versioned migration stays a migration), is the store as the database has it: an artifact, declared beside the replay of the migrations next to it, listed first and shown first, the replay kept beside it (spec D2: where they disagree, as when a migration is newer than the dump, a conflict, never resolved by precedence). A dump's serials (an integer column with its own sequence's default) read as the serials the migrations wrote.
- **How the engines' names compare**: in a Postgres or MySQL store, the names the engine holds for one type compare as one (`int4` and `integer`, `character varying` and `varchar`, `timestamptz` and `timestamp with time zone`, MySQL's `int(11)` and `int`, `boolean` and `tinyint(1)`), a default without the casts the engine adds, a quoted number as the number; in MySQL a unique constraint and a unique index are one object, compared as the unique key it is.
- **An expression index's text** is now kept by the SQLite replay (from its `CREATE INDEX`) and the TypeScript table-builder schema (its `sql` template rendered as the tool writes it), closing the known gap: each golden project, its snapshot, its migrations (now read in Postgres and MySQL too) and its schema agree, conflict-free.
- **Checked against the engines** (a dev-time oracle, never at test time: Postgres 16 and MySQL 8 in Docker, the synthetic migrations applied and their catalogs compared with the replay; their own dumps kept as fixtures the tests read beside the migrations). The differences the reader keeps on purpose, as declared rather than as the engine has them, are listed in the README.
- **What the engines write compares as what the migrations wrote**: a Postgres default or an index's expression in one normal form (the casts the engine adds, a `public.` prefix, redundant parentheses, `interval '1 day'` and `'1 day'::interval`, a number by its value, `B'…'` and `E'…'` strings by their value, an array's dimensions; shown as written), shared by the reconciliation, the branch diff and a design's planned changes, which now compare types and defaults in the store's dialect too. A qualified `COLLATE` (`pg_catalog."C"`) no longer loses a dump's table. The index MySQL builds for a foreign key is built by the replay too, marked as the engine's and counted apart (`+N implicit, for keys`); an unnamed functional index is named as MySQL names it.
- **A migration tool's own table** in a dump (the history or version table each tool keeps, by its exact name, and its schema where the tool sets one) is kept and noted, never compared with the migrations and never counted as one of the store's tables.
- **A dump's header states the dialect of the migrations beside it**, so a folder with no dialect marker of its own is read; a MySQL `DELIMITER $$` and `END$$` are no longer taken for Postgres dollar quotes. A migration tool's versioned files `V1`, `V1_0` and `V1_0_0` are one version (its trailing zeros dropped), so a folder holding two of them has no order. A routine body that never closes is reported where it opens; a constraint renamed or a check dropped counts as read.
- **Bounded**: 8 MB a file, 100 000 statements, 200 000 tokens and 5 000 elements a statement, a nesting of 256, 4 096 columns and 4 096 indexes a table, a work budget and 10 seconds a replay (past them it stops with a note, the facts so far kept); a megabyte of `(`, a million commas, an unterminated `$tag$` or comment stay linear, and so does a replay of tens of thousands of statements (a table's columns, indexes and the foreign keys pointing at it are found by name, never scanned). Both splitters now find each line once, so a file of one long line is no slower than one of many.
- **The index's schema moves to 11** (a `.sql` file's level gains 3, a dump's header): an older index is rebuilt once.

## 0.38.0 — the data model map reads SQL models the code declares: a TypeScript table-builder schema and a schema-language file, and shows where the schema was edited and no migration generated (data model map slice 11, #85)

A project that pushes its schema keeps no migration at all: its only statement of the store is the code. And where migrations exist, the code is what they are generated from, so a schema edited without generating one is drift nobody sees. The map now reads both kinds of code model, as declarations of the store their migrations go to.

- **A TypeScript table-builder schema** (a new code extractor in `lib/data/extractors/`, through the pinned TypeScript grammar, nothing evaluated). Found by content: a source file importing a SQLite, Postgres or MySQL core module of the ORM and calling a table builder; a barrel re-exporting relative modules is read for what it re-exports. Per unit, a config and the files it names (a file, a folder, a glob or a list, and what they re-export), else a folder of schema files. Read: tables (a schema's own `schema.table`, a creator's literal prefix and suffix), views by name, enums; each column's name (the builder's argument, else the key with the config's casing), its SQL type as the tool's snapshot writes it (`varchar(255)`, `timestamp (3) with time zone`, an enum's name, `int unsigned`, a custom type's `dataType()`), not null, primary key, unique, a reference with its actions (resolved across files), a literal or `sql` default as the snapshot writes it (a number as its value: `1.0`, `1e3`, `1_000`); `$defaultFn` and `$onUpdate` recorded as **computed defaults**, never evaluated; the third argument's indexes, unique indexes, partial and expression indexes, composite keys, unique keys (in SQLite the unique index the tool creates for them) and foreign keys. Columns spread from a shared object and built by a helper are read through them. The query API's `relations()` is app-level only: noted, never a foreign key.
- **A schema-language file** (a small hand reader in `lib/data/readers/`, and its extractor). Found by content: a file holding a model, view or enum block; a folder of them is one model, rooted at the file holding the datasource. Read: the provider (the dialect; nothing else of a datasource is kept, its url may hold a secret), `relationMode` emulating relations (no foreign keys modelled), models and their `@@map`, columns and their `@map`, the column type its migration tool writes for the provider (or a `@db.*` native type as written), `?` and lists, `@id` / `@@id`, `@unique` / `@@unique` / `@@index` as the indexes its migrations create (named as the tool names them, or `map:`), `@default` in the migration's terms (`now()` → `CURRENT_TIMESTAMP`, an enum value quoted), `uuid()`, `cuid()` and `@updatedAt` computed, `@relation(fields, references)` as a foreign key with the tool's default actions, an implicit many-to-many relation's join table (the two sides of a relation paired by its name, so a one-to-many beside a many-to-many is no join table), views, enums, `@@schema`; comments skipped. Bounded like the other readers (linear, 2 MB, a nesting of 32, capped lists); a block that does not parse is skipped and noted at its line, never with its text.
- **Store identity**: a TypeScript schema belongs to the folder its config's `out` names (the tool's default folder beside the config when unstated); a schema-language file to `migrations/` beside its datasource file (or the migrations path its config states). Those are the folders the snapshots and the migration replay read, so the schema, the newest snapshot and the replay are declarations of one store; a push-only project's store is named by where its migrations would go, so they join it once generated.
- **Schema edited, migration not generated** (spec D2): a column, a table, a key or an attribute the code model and the newest snapshot or the replay disagree on is a conflict carrying every side, never resolved by precedence, and named for what it is in `graph_data` and in the Data tab. A code model states what it can in the store's terms; what it cannot (a custom type, an expression default) is kept as written and not compared, and a table it cannot read whole is stated in part, so what it lacks is no conflict.
- **Checked against the tools themselves**: the two migration tools, run as a dev-time oracle on synthetic schemas (never at test time), generated migrations and snapshots kept as golden fixtures; each schema, read against what its own tool made of it, agrees with it, save the known gaps the README lists (an expression index's text; the newest beta snapshot format's arrays, integer primary keys and unique entries). Spreads of spreads and globs are bounded (a spread budget and a cycle guard; globs matched folder by folder, never through a backtracking pattern).
- **Shown**: `graph_data` lists the schema among a store's declarations, a column's computed default and enum, the store's enums at their lines; the Data tab draws the same. At a base ref the TypeScript schemas are parsed aside (once per extractor reading a file), so `graph_changes` sees a column a branch adds to a schema.
- **Configs are kept at a base**: a configuration an extractor reads (an ORM or migration config) is always kept when a base is read through git, whatever its content's level.
- **The index's schema moves to 10** (a source file's level gains the bits for a table-builder schema, a barrel and a schema-language file's models and datasource): an older index is rebuilt once.

## 0.37.0 — the data model map reads the key-value calls code makes: each index lists the functions that query it, or a lead that says what was searched (data model map slice 10, #84)

The infra says which indexes a key-value table has; only the code says which of them anything queries. The map now reads the SDK calls of Rust, TypeScript, JavaScript, Python and Go code, resolves each to the table it reaches, and puts it on that table's card: the functions that read and write it, each index with the functions that query it, and an index no call names as a lead, never a verdict.

- **An inferred extractor** (`lib/data/extractors/dynamo-access.mjs`, through the pinned grammars; the least trusted kind, never overriding a declared fact). Rust: aws-sdk builder chains from the client (`query()`, `put_item()`, `update_item()`…) or a builder type (`Update::builder()`…), with `.table_name`, `.index_name`, `.key_condition_expression`, `.update_expression`, `.projection_expression`, `.expression_attribute_names(k, v)`, `.item(k, v)` and their `set_…` forms; a chain of the project's own builder naming an index or a key condition counts too. TypeScript and JavaScript: an object literal with `TableName`, `IndexName` or `KeyConditionExpression` (an `UpdateExpression` text only beside the item's `Key` or given to an SDK call, never an ESTree visitor's key), its operation from the SDK v3 command it is given to, the DocumentClient method, a transaction leg, its declared input type, else the first call taking its variable after the declaration, within the block that declares it (one pass over the file). Python: boto3 calls with keyword arguments on a client or a `Table`, in place or through what it was assigned to. Go: `aws-sdk-go` and `-v2` input literals through `aws.String(…)` and `&x`. An accessor, a chain on another operation and an ORM's `query` are not calls.
- **What declares a table or an index is never a call**: a CreateTable or UpdateTable input, a GSI's or an LSI's declaration in code (`{ IndexName, KeySchema, Projection }`, `GlobalSecondaryIndex::builder()`, a `create_table()` chain, `types.GlobalSecondaryIndex{…}`), the table's administration (`createTable`, `describeTable`…). The GSI it declares stays a lead until a call queries it.
- **Constants, never by a guess**: a name of the file or one in SCREAMING_CASE is resolved through the binding's constants, a member only of a module imported whole; `process.env.X`, `cfg.X`, `settings.X` stay unknown. A file holding only string constants (an exported `const`, a module-level Python name, a Go `const`) is read for them, so another file's call can name them. Test code is marked by the code graph's test paths as well as each language's own marks.
- **What each call says**: its operation, what names its table, its index, its key condition's attributes, what an update writes (SET, REMOVE, ADD and DELETE paths, `#names` resolved through a literal ExpressionAttributeNames), a literal put item's attributes, its projection. A constant of the same file is followed (a Rust `const`, a TypeScript `const`, an object's or an enum's member, a Python module or class constant, a Go package constant); one of another file goes through the binding's constant resolution. Anything else stays unknown, never guessed.
- **Its table, never by a fuzzy match** (`lib/data/access.mjs`): the names the call's own table argument builds, else its function's, else its file's, matched as the item binding matches names (a template's literal parts, an environment variable the infra sets, a constant), production code over test code. A call naming an index keeps the tables declaring an index of that exact name; when none of the tables found declares it (only the call's own table argument outweighs the index), those tables stand in. Several at once are listed as ambiguous, the first three named. A call that could reach more than 5 tables is counted on each, never listed, and never turns the index it names into a false lead.
- **Bounded output**: a file gives at most 400 calls; a table lists at most 25 functions per index, 25 reading or writing it and 25 inferred conflicts, the rest counted; the page ships each way a call reached its table once. A call of unknown operation is counted apart, never as a write.
- **Each index**: the functions that query it, through the code graph's symbols (the innermost function, method or constructor holding the call, its `path:line` and its callers), or **"no access found (lead)"**, saying what was searched and what it may have missed: "no IndexName or index_name naming it in the indexed repositories; it may be reached through a constant built elsewhere, another repository, or a script". Calls naming it only on another table, or only in test code, are leads that say so.
- **A write the item does not state**: an attribute a call reaching one table writes that neither the item types bound to it nor its declarations state is an inferred conflict, `written` against `absent from the item`, both sides cited. It never becomes a field. Paths into a map, a list's elements or a type the shape does not expand are not compared, and a table with no item type bound says it was not compared.
- **`graph_data`** sums the access patterns in one line; with a table, each index with its queries or its lead, the functions that read and write it with their operations and what they write, and the inferred conflicts among the conflicts. **Key cards** draw the same: under each index the functions querying it or a lead pill, a *Reads and writes* list, the inferred conflicts; search finds a table by a function's name. `graph_status` counts the files read for access patterns.
- **Not compared at a base**: `graph_changes` does not diff access patterns yet (a base would parse its source files a second time aside); a base's files are not read for them.
- **The index's schema moves to 9** (a source file's level now has a bit for the access patterns, and `.js`, `.py` and `.go` files are inspected for them): an older index is rebuilt once.

## 0.36.0 — the data model map reads item shapes from Rust and TypeScript types and binds them to the key-value tables the infra declares, with a confidence, the evidence and the rivals (data model map slice 9, #83)

A key-value table's infra says its keys; its items' shape lives in code, and nothing states which type goes in which table. The map now joins them: the types code converts to and from an item, their fields as stored, and the table each is bound to, read from how the code names the table where it converts the type. Across repositories: the tables of an infra repository bind the types of the services that write them.

- **Item shapes, as stored** (`lib/data/extractors/serde.mjs`, `ts-types.mjs`, through the pinned grammars): Rust structs and enums deriving `Serialize` or `Deserialize`, with serde's rules (typeshare's, read again): `rename`, `rename_all` in every case style serde knows, `rename_all_fields`, `flatten`, `default`, `skip`, `skip_serializing`, `skip_deserializing`, `skip_serializing_if`, `tag` (a newtype variant's struct beside it), `tag` + `content` (each variant's value at the content key), `untagged`, external tagging, `Option` nullable, lists, maps, wrappers, newtypes and `transparent`. TypeScript interfaces and type aliases: `?` and `| null` nullable, literal unions as enums, arrays, records and index signatures, nested object types, `extends` and `&`. Nested fields by dotted path (`lines[].sku`, `prices{}.cents`, `payment.details.last4`). Types resolve within their own language: a Rust conversion never reaches a TypeScript type of the same name.
- **A bounded candidate set.** Only the types code converts to or from an item (`to_item`, `from_item`, `to_dynamo_item`, a turbofish, `marshall`, `unmarshall(…) as T`, an `Item:` member, `….Item as T`…) and those implementing a conversion are item types; a file's functions are kept only when one of them converts. A Rust or TypeScript file is read only when its content shows a serde derive, a type, a conversion, an environment read or a string constant, and again only when it changes.
- **Binding, in falling confidence, each with its evidence and rivals** (`lib/data/binding.mjs`): a mapper (the hook, no extractor yet: *declared*); an environment variable the code reads (directly or through a constant, of its file or another) that the infra sets to the table, in the function that converts the type (*convention*) or only its file (*name-match*); a name the code builds (a literal, `format!`, a template literal, a concatenation) that the table's name or template matches on its literal parts, the unknown parts wildcards, the table's last word spelt by the code (`format!("{}-shop-orders", stage)` and `"test-shop-orders"` match `{env}-{project}-orders`), in one function or one file (*name-match*). A conversion in test code ranks below the code it tests. Several tables at the best rank: *ambiguous*, each with the others as rivals. Below *convention*, drawn dashed. A type no table pairs with is listed as unbound.
- **No fuzzy matching.** Letters compare exactly: no case folding, no plural, no edit distance. `Orders` never matches `orders`, nor `{env}-{project}-orders`. A literal equal to an exact table name is evidence in its own repository only. A table only test code names binds no higher than *name-match*, and says *named only in test code*.
- **The environment the infra sets** is read where it names a table: a Terraform resource's `environment { variables }` (a table's `.name` by its address, or a value evaluating to its name or template) and a template function's `Environment.Variables` (`!Ref` to a table resource or its literal name; SAM globals, the Serverless Framework's environment). No other variable is kept, by name or by value.
- **One logical table, declared in several places.** The same name template in two stores, or an exact name a template matches (a local-dev `local-shop-orders` beside a prod `{env}-{project}-orders`): one logical table, and what its declarations disagree on is a conflict, local-dev against prod (a GSI the local-dev file still declares). A bare name is no evidence across repositories: two repositories each with their own `sessions` table keep two tables, each noting the other. A different naming (`Customers`) joins nothing: no rule states it.
- **Item fields on the tables.** A binding (not an ambiguous one) adds its type's fields to every declaration of the table, each with what each bound type stores there and its code line. `graph_data` shows the item tree, the bound types with their evidence and rivals, the logical tables and the unbound types; `graph_changes` and the delta address an item field as `<table>.<field path>` and report it added, removed or changed. **Key cards** draw the item as a tree with the keys marked, each binding (dashed below convention, its rivals), the logical table and its conflicts; the Data tab lists the item types per repository.
- **Bounded, and never in the way.** A type holding itself (a struct, a newtype, an alias, directly or not) is a leaf; each type's expansion is computed once per depth; an item keeps 400 fields and one model 200 000, cut and noted; types and tables pair per type and table, not per conversion and name. A failure while binding leaves every store answered, and `graph_data` and the page say the item shapes were not bound.
- **A base's code is read aside.** At a base ref, the Rust and TypeScript files are parsed in Liftoff-only child processes (`readers/code-aside.mjs`, in batches, bounded in time; a batch that fails is read again file by file, so a file that kills the reader fails alone), never in the MCP server's.
- **`graph_data` and `graph_changes`** say so in their tool descriptions: item trees, bindings with their confidence and rivals, logical tables, unbound types, item fields in a diff. A base's failures past the twentieth are counted, not listed.
- **The index's schema moves to 8** (`.rs` and `.ts` files are inspected for item shapes now): an older index is rebuilt once.

## 0.35.0 — the data model map reads key-value tables declared in Terraform, evaluated through the configurations that run their module, and never guesses what no file says (data model map slice 8, #82)

The data model map now reads key-value tables declared as Terraform resources: each instance of the module that declares them, through the wrapper configurations that run it (their inputs merged through their includes) or the tfvars beside it, one table per `for_each` key, each element at the line that states it. What no file states stays unknown, drawn as such, never guessed.

- **An HCL reader, by hand** (`lib/data/readers/hcl.mjs`, no grammar): blocks, attributes, literals, strings with their escapes, heredocs (`<<EOF`, and `<<-EOF` with its common indentation dropped), templates with `${…}` and `%{ if }` / `%{ for }` kept as expressions, lists, objects, `for` expressions, conditionals, operators, function calls; three kinds of comment. One linear pass; a text past 1 MB, a nesting past 64 levels or a read past 10 s is refused with its line. A file that does not parse is noted, and the others are read.
- **A small evaluator** (`lib/data/readers/hcl-eval.mjs`): `var.*` (the default, then the wrapper's inputs, then `terraform.tfvars`, `*.auto.tfvars(.json)` and a var-file, as Terraform orders them; conformed to the variable's type, `optional(T, default)` attributes filled), `local.*`, `each.*` under `for_each` (a map, or a set of strings), `count.index`, `dynamic` blocks, `for` expressions, conditionals, string templates and the common functions (`lookup`, `try`, `can`, `merge`, `coalesce`, `compact`, `flatten`, `toset`, `tolist`, `concat`, `contains`, `format`, `join`…). The wrapper's `include` blocks are found with `find_in_parent_folders()` among the repository's own files, their inputs merged as the tool merges them (bottom-up, the configuration's own winning; `deep` merging maps key by key and appending lists, `shallow` replacing whole inputs), their locals read when exposed; `read_terragrunt_config`-style reads and the path functions answer from the repository too. Nothing reads the disk, the environment or the network, and nothing runs. Bounded by a budget of steps, a depth, a string size and a deadline.
- **Unknown, never guessed.** Another configuration's outputs, an environment variable, a command, a data source, another resource's or module's attributes, the workspace, a function the evaluator does not run, an included file the repository does not hold (a git-ignored one, say): each is unknown, propagates, is kept in the model as its expression (`${dependency.search.outputs.sort_attr}`), is noted with why, and leaves its table not stated whole. A **name** with an unknown part is named by its **template**, its literal parts kept and each unknown part `{label}` (`"${var.env}-${var.project}-${each.key}"` → `{env}-{project}-orders`), carried as `nameTemplate` for binding to the names code builds, a later slice.
- **Found by content** (`lib/data/extractors/terraform.mjs`): a folder whose `.tf` files declare the provider's key-value table resource is a module; each wrapper configuration (the tool's own file name for a unit it runs) whose `terraform { source }`, its own or an include's, resolves to that folder is an instance of it; else each var-file beside it; else the module alone. A module out of reach (a git, registry or other remote source whose address names a key-value table module) is listed as found, not read, its address without credentials or query. Every `.tf`, `.tfvars`, `.tfvars.json` and `.hcl` file is a candidate; a test file, a lock file and the wrapper's cache never are.
- **What a table holds**: its name, its partition and sort keys, its `attribute` blocks (static and `dynamic`), each GSI (`hash_key` / `range_key`, or the newer `key_schema` blocks of a multi-attribute key; projection and non-key attributes) and LSI, its TTL (off unless said; an empty attribute kept as such), its stream and its billing (`PROVISIONED` unless said, as the provider documents). Each element cites the line that states it outside the resource's code (the inputs entry for that table, its GSI's object, a tfvars line, a variable's default) and the module's line as a second source. Nothing else is evaluated, so a tag, a policy or a secret beside a table is never computed.
- **One store per repository, grouped by exact name.** A Terraform table and a CreateTable file or a template naming the same table exactly are two declarations of one table, and their disagreements are conflicts; two instances whose names are unknown alike share a template.
- **Secrets stay out.** Only what lands in a table's model is kept: names, keys, attribute names and types, index names, the TTL attribute, stream, billing. A tfvars credential or a password in an included file's locals is evaluated in memory only if a table needs it, and dropped with the evaluation: tested absent from `graph.db` and the page. A note names what the source writes (an expression, a literal file or variable name), never a value it evaluates to. A data input that is a symbolic link to a file out of the repository is never followed: it is listed as found, not read.
- **A file that does not parse says only where.** Every JSON a data extractor reads (CreateTable files, templates, tfvars, snapshots, the migration journal, a delta) is reported as `not valid JSON at line N`, never with the engine's message, which quotes the text around the error; HCL errors carry no text of the file; a migration SQLite rejects keeps its error without the literal it quotes. This fixes the CreateTable and template reader too, which quoted it since 0.34.0.
- **Hostile values stop the evaluation, not the job**: a string that would grow past 1 MB stops before it is built, a value nested past 256 levels (200 for `jsondecode`) is refused, and the engine running out of room is a stop said in a note.
- **`graph_data`** says when a name is a template and when a TTL has no attribute; **`graph_changes`** compares a branch's wrapper inputs against its base, element by element, the change in one declaration named with its file. **Key cards** draw an unknown value as unknown (its expression, underlined) and a templated name with a pill; the inputs line and the module's line are both cited.
- **The index's schema moves to 7** (`.tfvars.json` files are inspected for Terraform now, not for tables): an older index is rebuilt once.

## 0.34.0 — the data model map reads key-value tables declared in CreateTable inputs and CloudFormation, SAM and Serverless templates, and draws them as key cards (data model map slice 7, #81)

The data model map now reads AWS key-value tables from the files that declare them, JSON or YAML, never from a database and never by evaluating anything: their keys, indexes, TTL, stream and billing, each at its line. Two files declaring one table are both kept, and where they disagree, the disagreement is a conflict.

- **Found by content, two formats.** Every `.json`, `.yaml`, `.yml` and `.template` file is now a candidate, and what it holds decides: one with a `KeySchema` and `AttributeDefinitions` is a CreateTable input (the request `create-table --cli-input-json` or `--cli-input-yaml` takes, as local-dev table files are written; a list of them, describe-table's `{ Table }`, one table per YAML document); one naming a table resource type is a template (CloudFormation and SAM `Resources`, the Serverless Framework's `resources.Resources`). Folder and file names decide nothing. Every other resource, parameter and output is left alone: only what lands in a table's model is kept. A repository's key-value tables are one store, wherever each is declared.
- **The model** (`lib/data/model.mjs`): each table's attributes (typed `S`, `N`, `B`), its partition and sort keys (up to four attributes each: a multi-attribute key), its TTL as a key of role `ttl` (on, off or not said), each GSI and LSI with its keys and projection (`ALL`, `KEYS_ONLY`, `INCLUDE` with its attributes), its stream view type and its billing mode (stated, else implied by `ProvisionedThroughput`, else a SAM SimpleTable's documented `PAY_PER_REQUEST`); a SimpleTable's `PrimaryKey` (by default `id`, a string) is its partition key. Each element cites its `path:line`.
- **References are kept, never evaluated.** Intrinsic functions in YAML's short form (`!Ref`, `!Sub`, `!GetAtt`, `!If`…, any tag) or JSON's long form (`{ "Ref": … }`, `{ "Fn::Sub": … }`) stand as their short-form text, and a `${…}` variable as written. A table whose `TableName` is one is named by its logical id, the expression kept beside it; a part stated by one is not read, and the declaration's notes say where.
- **YAML through the pinned grammar** (`lib/data/readers/yaml.mjs`): the core schema's scalars, quoted and block scalars, anchors, aliases and `<<` merges, several documents per file, each member at its line; what aliases and merges stand for is counted against a cap, so a document that expands without bound is refused. The pinned grammar's scanner is C++ and imports `operator new` and `delete`, which the pinned runtime lacks: `lib/deps.mjs` renames them to `malloc` and `free` in the grammar's bytes before it loads. YAML at a base ref is parsed in a Liftoff-only child process (`readers/yaml-aside.mjs`), never in the MCP server's.
- **Source against source.** Two files stating the same `TableName` (a local-dev table file and a template) are two declarations of one table, both kept and labelled with their kind and format (and a template's logical id). A GSI or an attribute one states and the other does not, a different projection, a stream on one side only, TTL on and off are conflicts; each file describes every table it states whole, unless a part of it is a reference. A table named differently per environment stays two tables: binding names through their templates is a later slice.
- **`graph_data`** speaks of attributes, keys, TTL, GSIs, LSIs, billing and stream. **`graph_changes`** identifies a table and an index by name, a key by its role and attributes, and compares a key-value table declaration by declaration, since its files are of equal standing: what one file changed is named with that file (`projection in lending/template.yaml: INCLUDE (dueAt, title) → ALL`), and a file that now declares an element too changes where it is `declared in`. A SQL element is still compared by its merged value.
- **The delta** addresses them in the same grammar (`…/index:<name>`, `…/key:partition(…)`, `…/key:sort(…)`, `…/key:ttl(<attribute>)`; a table's billing and stream are changed on the table), with their own `after` (a GSI's or an LSI's kind, keys and projection; a TTL's `enabled`), validated like the rest. A change several files declare is planned and built only when each has it, a difference only some have naming its file.
- **Key cards in the Data tab.** A key-value store is drawn as a card per table, not as an ERD: name, billing, stream and conflict count; partition and sort keys with their attributes' types, the TTL, each GSI and LSI with its keys and projection, the attributes; the declarations, linked, a template's logical id beside its file; the conflicts with each side's source; on hover, each row's `path:line`. Search narrows the cards. Both overlays mark cards and rows as they mark an ERD (before → after, the file of a change one declaration made), and each card lists the delta changes it carries. Every name from a file is text, never markup.
- **Bounded, whatever a file holds**, since every JSON and YAML file may now be read, some in the MCP server's process (the model at a base ref):
  - JSON nested deeper than 200 levels is refused before it is parsed, and `readers/json-lines.mjs` builds each member's key from its parent's: linear (a deeply nested file used to exhaust the heap).
  - Every scan of a string is linear: a `${` with a `}` after it is found by two scans, a YAML header's comment and the blanks before a line break are cut by hand. No regular expression that backtracks on a long run.
  - YAML: a text past 512 KB is refused before it is parsed (at that size the worst cases measured read in under a second and under 400 MB), a node's children are counted against the million-value cap before they are listed (and listed in one call), and reading stops past 10 s.
  - At a base ref, each YAML text is parsed in a process of its own, killed past 5 s plus 10 s per MB, all within 30 s, so a slow text fails alone.
  - A leading byte order mark is dropped. A table's notes stop at 50, a file's at 200.
  - Each refusal is the job's error, stored with the file's hash, so the file is not read again until it changes.
- **A declaration that moves is still compared.** When a file left and another came (a file renamed, a file of several tables split into one per table), the two are compared, so what changed with the move is reported beside where the element is declared now; when what is left does not pair and no file is on both sides, the merged values are compared. The delta states and the overlays follow.
- **Text answers cannot be forged.** A name or value from a file holding a line break or another control character is printed JSON-quoted by `graph_data` and `graph_changes`.
- **The index's schema moves to 6** (JSON and YAML files are inspected for tables now): an older index is rebuilt once.
- **Tests.** The graph tests' temporary repositories commit unsigned, as the workflow tests' do, so a signing agent that is locked or absent does not fail them.

## 0.33.0 — the build loop commits the design's delta on the run branch, and the orchestrating checkout is left alone (#97)

Asked whether the loop should commit the delta it updates, the owner answered "Yes, commit it" (spec D4, amended 2026-11-07). Until now the ship step appended each kept unplanned change to the delta in place, in the orchestrating checkout: no branch and no PR carried it, a later implementer's `git add -A` could sweep it into its own commit, and a stash or `git checkout .` dropped it.

- **Committed on the run branch.** When the delta is a file of one of the run's repositories (its path under that repository's `path`, compared once `root` makes both absolute), every kept change, whichever repository's task kept it, is recorded by that repository's ships. The ship writes the delta in its own worktree, before its push and under the ship lock, through `tools/graph/delta-append.mjs` (the same validation, idempotent ids and delta lock). It stages the delta alone (`git add -- <path>`) and commits it as `chore(data): record unplanned changes in <path> (<tasks>)`, with the repository's own git identity, hooks and signing, and a `Grimoire-Run: <runId>` trailer. The push carries it, so the PR holds it and the owner merges it with the code. The receipts: `PUSH ok=1 remote=<landed head>`, then `DELTA ok added=… already=… refused=… commit=<sha>` (`deltaCommit` in the ship's return).
- **The orchestrating checkout is not modified** while tasks run. Its run branch never gets those commits, so every later landing diverges from the remote by exactly those. Every ship of that repository therefore carries them forward first, a merge that changes only the delta, whether or not it has entries of its own (a halt ship too); a ship that has some commits them on top. Its push is then a fast-forward, where pushing the landed head alone would be refused. Acknowledgements made in `serve` on that checkout are the owner's own edits and merge like any change.
- **On a resume**, the reconcile fast-forwards a local run branch that is only behind. One that diverged from origin by the delta's own commits alone (a session that ended after a landing, before its ship) is now `sync=delta-ahead`, not a refusal: nothing is reset, and the next ship carries them forward.
- **The gate brings them in.** Before its gate command, the gate runs a `SYNC` script. It fetches the run branch and merges what the remote holds beyond the checkout's branch, when that is the delta alone (a fast-forward, or a merge that changes only the delta). The gate then certifies a tree that holds the delta, and its push stays a fast-forward. `SYNC none`: nothing to bring. `SYNC bad …`: anything else on the remote is left alone, and the push says the rest.
- **The design's delta not on the branch yet** (written by the design and never committed there) is copied from the orchestrating checkout, as it stands, and committed with the first entries; the commit says so.
- **The delta changed on both sides.** An acknowledgement made in `serve` and committed on the branch, or the design's delta added on both sides, can make a carry-forward merge (or the gate's `SYNC`) stop on the delta. It then keeps the branch's version and appends the remote's unplanned changes to it. `delta-append.mjs` now takes another version of the delta as its changes: that version's unplanned entries, each without its acknowledgement, so an acknowledged one shows unacknowledged again and is never lost. The resolved merge keeps no conflict list in its message, so the run's trailer stays its last paragraph. Any other conflict abandons the merge.
- **A kept change in another repository** goes to the delta's repository. A ship of that repository is sent at once: its landed head is pushed already, so that ship only commits the delta and pushes it. A repository delivered at the end, or one with nothing landed yet, records them with its next ship or its seal. The delta repository's PR section names the other repositories whose entries its delta commits carry ("the delta on this branch also records what web kept: …").
- **`deliver: 'end'`.** The seal commits what no ship recorded on what the gate pushed, in the ship worktree, and pushes that commit as a fast-forward. It leaves the PR's body and ready state alone.
- **Nothing here fails a ship.** A refused entry, a held lock (`DELTA skipped lock=0`), a commit a hook refuses (`DELTA bad step=commit`), a push that fails (`DELTA bad step=push`) or a step that never ran (the PR out of draft, unreadable, no worktree: `DELTA skipped push=0`) leaves the ship and its push as they were. The entries stay pending for the next ship, and the run log says why.
- **Outside every shipped repository** (a hub folder that is not one), the delta is written in place, as before, and the PR's *Data model and architecture changes* section says "The delta lives outside the shipped repositories: written in place, not committed." With the delta on a run branch, that section says where its commit is.
- **The run report.** The `delta` journal event gains `where` (`run-branch` or `in-place`) and `commit`; `/grimoire:logs` and the run log name the commit.
- **In a session**, `implement` writes the delta on the issue's branch and commits it there before the PR, the delta alone, so the PR carries it (its eval says so).
- **Limits.**
  - While tasks run, `serve` on the orchestrating checkout does not show the unplanned entries: they are on the remote run branch until the gate's `SYNC` brings them in.
  - A repository whose pre-push hook requires the gate's stamp refuses the seal's delta push (`DELTA bad step=push`): those entries are listed as unrecorded at the end of the run.
  - A delta whose repository has no landed task in the run gets no ship and no seal: its entries are unrecorded, and the end-of-run warning says so.
  - When that repository's PR is already out of draft, its land ships stop: the entries wait for its next terminal slot's seal.
  - A conflict in the delta other than the two-sided one above abandons the merge, and the push is refused as before.

## 0.32.0 — the architecture change view: a branch's architectural impact and a design's architecture changes, drawn, stated and acknowledged (data model map slice 6, #80)

What the data model map does for stored data, it now does for the architecture diagrams: a design proposes architecture changes, the page draws them over the saved diagram with their states, the user acknowledges them, and a branch's architectural impact against its base is shown, reported in the PR and never blocks.

- **The delta's architecture changes are read now.** Its `architecture` list is validated change by change (`lib/data/delta.mjs`): targets `component:<id>`, `connection:<from>-><to>` (the ends split at the one `>` an id cannot hold; `#<label>` after them names one of several lines joining the same two components) and `boundary:<label>`; `after` in the diagram's own words (a component `{ label, type, paths?, … }`, a connection `{ label?, variant?, via? }`, a boundary `{ kind?, wraps }`; a rename names a component's new `id` or a boundary's new `label`; a connection has no name to rename). Ids are unique across the delta's two lists. The same hash and acknowledgement as a data change.
- **A branch's architectural impact** (`lib/arch-change.mjs`), against the base `graph_changes` already resolves: the saved diagrams at the base, read through git with nothing checked out, against the working tree's (diagrams, components, connections and boundaries added, removed or modified, before → after), and the check's findings on the branch's index and not on the base checkout's, each saved diagram checked against both: a new link no line draws, a module no component covers, a new external service by import, a drawn line the code no longer shows. The base index is the base checkout's (`lib/freshness.mjs` `baseIndex`); with none, only the diagram files are compared, and every answer says so. The check itself (`lib/arch.mjs`) gains its findings as data (`findings`, `newFindings`) and a warning for a known external service the code of a component imports that no component reaches.
- **States, computed against the saved diagrams**: planned and built, pending, built differently (planned → built), stale once edited after its acknowledgement, and unplanned: the impact no change covers, either drawn in the branch's diagram or only in the code. A rename covers the lines that meet the renamed component; a boundary that only wraps what the delta adds is covered with it; a planned component's paths and imports cover a module or a service it takes in.
- **`graph_changes` covers both maps.** An *Architecture* part follows the data model's when the project saves a diagram or the delta proposes architecture changes: the diagrams against the base and the code's new findings; with `delta`, each architecture change's state, the unplanned, a summary. `repo` leaves it out.
- **The Architecture tab draws it**, two toggles over a saved diagram, one overlay at a time. *Changes vs `<base>`*: elements added green, removed red where they stood, modified amber with before → after, the code's new links dotted, a legend and the list. *Delta*: the Data tab's visual language, a proposed component as a dashed ghost placed by the layout (laid out in Node with the others), a proposed line dashed, a proposed removal struck, planned and built green, built differently amber, not in the plan in its own colour, a stale acknowledgement badged; the change list with why, slice and acknowledgement, the changes no diagram can hold listed apart, and a component's passport naming the changes that concern it. Strings from the files are escaped as everywhere else. The page stays static and network-free; `lib/arch-pack.mjs` packs it.
- **Acknowledging an architecture change** under `graph.mjs serve`: `PUT /api/delta` takes the ids of data and architecture changes alike, each `ack` edited in place in its own list (`setAcks` takes the list), under the same lock, refusals (409 with a Reload, 400, 422, 503 said beside the control) and rules. The two tabs share one delta object, so an acknowledgement from either sends the hash the file has.
- **The pipeline.** `modelChanges` takes architecture targets: an implementer keeps an architectural impact with the diagram updated in the same branch, as `/grimoire:architecture` does, or reverts it; the ship step's `delta-append.mjs` routes an architecture target to the delta's `architecture` list; the hydration copies the delta's architecture changes with its data ones; the PR's *Data model and architecture changes* section lists them under the same heading and points to the Architecture tab. Nothing blocks.
- **The code is compared only at the fork point.** The base checkout's index is read for a repository only when the head it recorded is the merge base the diagrams are compared at, with no re-parse pending there: an index behind or ahead of the fork point would report what the base did as the branch's impact. Otherwise only the diagram files are compared, and `graph_changes` says why with a short reason and the checkout to refresh; the page says it without the checkout's path (nothing in a rendered page names a path outside the project); the implementer reports it (`architectureCompared: "diagrams-only"`, `architectureWhy`) and the PR section says "architecture: diagram files only (<reason>)". A project that draws no diagram and proposes no architecture change loads no second index, and its `graph_changes` reads as before, footer included.
- **Skills.** `architecture` updates the diagram in the same pull request when a branch's impact shows an unplanned change and reports it, and reads a delta's architecture states (two evals). `roast` states an architecture change's `after` in the diagram's words; `implement` applies the same rule to the architecture.

## 0.31.0 — unplanned changes to stored data are resolved by the implementer, recorded in the delta and listed in the PR, never blocking (data model map slice 5, #79)

A design's delta says what the work will change in stored data. The pipeline now builds against it and tells the owner about everything else, without ever stopping for it: the implementer resolves each change outside the plan, the map is updated, the PR and the run report say so.

- **Planned changes reach the implementer.** `to-issues` names each issue's model changes from the delta (id, op, target, why). In the loop, the index agent says whether the delta exists beside the spec (`<date>-<topic>.delta.json` beside `<date>-<topic>-design.md`, or `deltaPath`), the hydration copies each task's changes from it by slice (`deltaChanges`), and the implementer brief (the team agents, `migration-engineer`, `test-engineer`) carries them with the delta's path.
- **The implementer resolves what is not planned.** Before it returns it runs `graph_changes` with the delta against its starting commit. Its return gains `deltaStates` (planned and built, pending, built differently, per planned change) and `modelChanges`: one `{ target, op, kept, reason, after }` per change outside the delta (with no delta, per change it made to stored data), kept with a reason or reverted. Neither is a question, a pause or a failure. A later dispatch of the task (a fix round, a retry after a replan) is told the task's own start as the base and the earlier report, and its whole current list replaces it: a change it no longer lists reads as reverted, and nothing reverted is appended. A task a replan re-emits keeps its planned changes (the replanner never sees the delta); a split gives each part the changes its text names, and those none names to all of them.
- **The ship step is the single writer of the delta.** Once a task lands, its kept changes wait for the repo's next ship; its script, while it holds the repo's ship lock, appends them as `{ id: unplanned-<task>-<hash>, op, target, after, why: <the reason>, slice, origin: "unplanned" }`, never acknowledged, through `tools/graph/delta-append.mjs`. That script validates each change with `delta.mjs` (one that would not validate is refused and said), skips an id already there (a ship sent again writes nothing twice), keeps the file's layout, takes the delta's lock (`lib/data/delta-lock.mjs`, a directory beside it) and writes through a temporary file renamed over it. `serve` takes the same lock around an acknowledgement's read, check and write, so neither the ships of two repositories nor an acknowledgement write over each other; held past its wait, the server answers 503 (busy, try again) and the page says so beside the control. A write that failed is retried by the next ship; ships of one repo coalesce, so two lanes landing together are written in one step. A repo delivered at the end has its seal carry them, and a halt ship does too. A kept change with no reason is listed, never recorded; an entry with no target is dropped; both are logged. Lanes and implementers never write the delta.
- **The PR says it.** The draft PR body gains a *Data model and architecture changes* section, rebuilt with every description: each planned change of the repo's tasks marked planned ✓, built differently (what differs) or pending (not built yet, or its task not landed), then each change outside the delta, unplanned ⚠, kept or reverted, with its reason (and "added to the delta" once written). With no delta it lists the branch's changes the implementers reported; with nothing to say there is no section. The gate keeps the section in the final description.
- **The run report says it.** A log line per landed task that changed stored data and one per delta write, the `model` and `delta` journal events (`/grimoire:logs` renders them), and the result's `dataModel` (`{ delta, changes, unrecorded }`). In a session, `implement` appends the kept changes itself, adds the section and tells the user.
- **Review.** An unplanned change is never a finding by itself; a wrong one (it drops what another repository still reads, it loses data) is a finding on its merits.
- **The parts of a planned table** (the finding carried over from slice 4): what the branch builds on a table the delta adds beyond what its `add` states (a column beyond `fields`, a key, an index, a cascading foreign key) is now unplanned, each part named as a target with the change whose table it is on, instead of passing as planned and built (or, for a column, as built differently); a part another change of the delta adds stays covered by it. `roast` now states a new table's keys, indexes and foreign keys in its `add`.

## 0.30.0 — the data model map draws a design's proposed changes, acknowledged change by change (data model map slice 4, #78)

A design can now say what it changes in stored data before anything is built, and the user can see it drawn over today's model, validate it, and acknowledge each change. The check then tells, change by change, what the code has built.

- **The delta** (`tools/graph/lib/data/delta.mjs`): `docs/specs/<date>-<topic>.delta.json`, beside its spec, `{ schema: 1, spec, data: [change], architecture: [change] }`, a change being `{ id, op: add | change | remove | rename, target, before?, after?, why, slice?, origin: planned | unplanned, ack? }`. Validation names every problem at once (the schema version, an unknown op or key, a target outside the grammar, an `after` missing or holding what the element has not, a missing `why`, a duplicate id). `architecture` is checked to be a list; the architecture change view reads it later.
- **Targets address an element the way the model diff identifies it** (its identity and name folding are now exported by `diff.mjs`), so a target resolves exactly where `graph_changes` matches: `<repo>:<store>/<entity>`, `….<column>` (dotted when nested), `…/index:<name>`, `…/key:<role>(<columns>)`, `…/fk:(<columns>)-><table>(<columns>)`, names in any letter case where the dialect's are.
- **A hash per change**: SHA-256 of its canonical JSON (keys sorted) without `ack` and `slice`, so editing what changes or why makes an acknowledgement stale, and reordering keys or giving the change its slice does not.
- **States, computed on every read, never written**: planned and built (a removal once gone, a rename once only the new name is there), pending (with what it proposes), built differently (planned → built), the acknowledgement apart (acknowledged, or stale once edited), and unplanned: a change of the branch against its base that no change of the delta covers.
- **`graph_changes --delta <file>`** (and `graph.mjs changes --delta`): each change with its state, the `path:line` that builds it, what differs or what it proposes, its why, slice and acknowledgement; then the unplanned changes; then a summary. Without `--delta`, unchanged. The tool is confined, since an agent chooses the path: it reads only `docs/specs/<name>.delta.json` beside the specs of a project root (the real file, symlinks resolved), given relative to the project root, and refuses anything else with one message that says nothing about the file. A value echoed in a validation problem is escaped and cut short. `graph.mjs render` and `serve --delta` read the path typed.
- **The Data tab draws the delta** over the model, with the change overlay's renderer: a toggle (one overlay at a time) and a picker when several deltas sit beside the specs (the newest first, or `graph.mjs render --delta <file>`). A proposed table is a dashed ghost box laid out in Node among the others, a proposed column, key or index a dashed row, a proposed removal struck in amber dashes; planned and built is solid green, built differently amber with planned → built; the branch's changes outside the plan have their own colour, *not in the plan*; a stale acknowledgement is badged. A legend; every change listed in its store and its table's passport with its why, slice and acknowledgement (who, when). Strings from the file are escaped as every other name is.
- **Acknowledging, under `graph.mjs serve` only** (the static page stays read-only): an Acknowledge control per change and one for every change of a store not acknowledged yet. `serve.mjs` gains `PUT /api/delta`, under the notes' host, origin, token and JSON-only rules, writing only `docs/specs/<name>.delta.json` inside a project repository (no `..`, no absolute path, no other extension, no symlink out), refusing with the disk text (409) a delta changed since it was loaded and never writing one that does not validate. The server sets `ack = { by: the repository's git user.name, else the system user (one line, 120 characters at most), at: now, hash: the change's }` itself, edits only those `ack` members in the text (indentation, line ends, final newline and every other change kept; a layout it cannot edit in place is rewritten whole, after the same check), and writes through a temporary file renamed over it. Unacknowledging removes `ack`. A refused write is said beside the control pressed, with a Reload that reopens the page on the same delta.
- **Skills**: `roast` drafts the delta beside its spec when a design changes stored data or the architecture, checks it with `graph_changes --delta`, and asks the user to validate and acknowledge it in the Data tab; `to-plan` gives each change its slice and changes nothing else, so the acknowledgements hold. An eval for each.

## 0.29.1 — the graph page: a drag never selects the page, and the arrow keys pan (#92)

Dragging a diagram used to stop at the edge of its box, and the browser's text selection then took over and spread over the page around it. The Architecture and Data tabs and the file map now move the same way, through one helper shared by all three (`tools/graph/lib/stage-view.mjs`, injected into the page like the tabs). It replaces the pan, wheel and release code the Data tab had copied from the Architecture tab.

- **A drag never selects the page.** The press that starts a pan is cancelled, so no text selection or image drag begins. Past 3 px the pointer is captured: the pan follows it out of the box and past the scroll ends until the button is released, anywhere. A press on a table, a component or a file that moves 3 px or less is still a click and opens it; the click that ends a pan opens nothing. A drag that starts on a table or component still pans nothing, and selects nothing either: while any press that began on a drawing is held, the page starts no selection, and the drawings' text is not selectable.
- **Touch.** On the Architecture and Data tabs, a finger scrolls the drawing's box the browser's own way (with momentum, and the page scrolls on once the box reaches its end); on the file map, where nothing scrolls natively, a finger pans the map.
- **The keyboard pans and zooms.** Each drawing is focusable (its label names the keys), and a click on its background focuses it without scrolling the page. With the focus on it, or on a table or component inside it: the arrow keys pan by 60 px and Shift + an arrow by most of the visible size, stopping cleanly at the edges (an arrow that cannot move the drawing, at its edge or in a drawing smaller than its box, scrolls the page as usual); `+` (or `=`) and `−` zoom about the visible centre by the zoom buttons' step; `0` fits. The keys never act with Ctrl, ⌘ or Alt held, nor from the search box, the passport or any other field, and they scroll instantly. Enter and Space still open a table or component; Escape still leaves full size. After a re-render (Fit, a click on the background, leaving full size) the focus returns to the drawing without scrolling the page.
- The wheel zooms as before. The zoom buttons of the Architecture and Data tabs now step from the zoom as it is, after the wheel or a key changed it, not from the zoom of the last render. The page still fetches nothing, and its CSP still admits only its own script, by hash.

## 0.29.0 — the data model map shows a branch against its base: `graph_changes` (data model map slice 3, #77)

A branch's data model can now be read as a model change, not as lines of SQL: what it adds, removes and modifies against its base, drawn over the Data tab.

- **The model diff** (`tools/graph/lib/data/diff.mjs`): two models compared store by store and element by element (tables and views, columns, keys, indexes, foreign keys), each added, removed or modified, the last with the before and after of every attribute that changed, and the `path:line` that declares it on each side. A table added or removed is one change, not one per column. Names compare in any letter case where the dialect's do (SQLite), types and defaults as reconcile compares them, keys by their role and columns: a change of formatting is no change.
- **Rename candidates, never decided.** A removed and an added element of the same kind and shape (a table with the same columns; a column of the same type at the same position; an index or a foreign key on the same columns) are flagged as a possible rename. Both stay a removal and an addition. Several of one shape on each side are one ambiguous group, listed whole.
- **The base, read through git, nothing checked out** (`tools/graph/lib/data/base.mjs`): `base` when given, else `baseBranch`, else the branch the index is based on, else `main`, at its merge base with `HEAD`, so commits the base gained since the branch left it are not the branch's. The base commit's model-bearing files are chosen by the same rules as the index's, read as blobs in one `git cat-file --batch` (the batch form of `git show <commit>:<path>`; binary-safe, size-capped), and run through the same discovery and extractors (`registry.mjs` `extractAll`: one code path for the working tree and a commit). The base's facts never enter `graph.db`; they are memoised in the process per commit and extractor version. A store absent from the base is an added store, never an error; a ref that names no commit is a clear error.
- **`graph_changes`** (MCP) and **`graph.mjs changes [--base <ref>] [--repo r]`**: a one-line summary, then per store each change with `path:line` on its side and the rename candidates, with the same "Leads, not facts" footer as `graph_data`.
- **The Data tab's change overlay**: a toggle *Changes vs `<base>`*, off by default. On, added elements are green, removed ones struck through in red (a removed table drawn as a ghost box among its foreign key neighbours), modified ones amber with before → after on their row and in the passport, and rename candidates linked (tables by a dashed line, columns and indexes by a bracket beside their rows), with a legend and per-store counts. The overlay is packed in Node at render time (`graph.mjs render --base <ref>`, else the default base), so the page stays static and network-free; with no base to compare against, the toggle is absent and the tab says why. Names from the repository's SQL are escaped as everywhere else on the page.

## 0.28.0 — the data model map gets its Data tab (data model map slice 2, #76)

The graph page (`graph.mjs render`, and `serve` unchanged) gains a **Data** tab after Architecture: the data model `graph_data` reads, drawn as an entity-relationship diagram per SQL store, every fact linked to the code that declares it.

- **An ERD per store.** A store picker names each store with tables (`repo:folder`, dialect, counts as `graph_data` gives them); `#data-<n>` opens the nth. Each table lists its columns with their type, primary and foreign key markers and nullability (a filled diamond for `NOT NULL`, a hollow one for nullable), then its unique keys and declared indexes; the indexes SQLite builds for keys stay a count on the store. A line runs from a foreign key's column (many) to the column it references (one).
- **Laid out in Node, deterministically** (`tools/graph/lib/data/layout.mjs`), once per render, as the architecture diagrams are: a table sits left of the tables referencing it, linked tables are grouped and their order swept to cut crossings, tables with no foreign key come last. The same tables always get the same coordinates, whatever order they come in. The same function is injected into the page for the subsets below.
- **Search and focus.** The header's search names tables and columns. A click lights a table and its foreign key neighbours and opens its passport: every column, key, index and foreign key (both ways) with the `path:line` of each declaration, a link to the file in the Files tab when the file is indexed (migration `.sql` files are), plain text otherwise. The zoom and full-size controls are the Architecture tab's.
- **Conflicts are badged** on the column or table they concern, the badge naming both values (`integer ≠ text`) and its tooltip both sources; the passport lists each side.
- **Large stores start collapsed.** A store of more than 60 tables is drawn as names only. A focus draws the table with its neighbours, a search the matching tables (40 at most), each with its columns; *Columns* draws them all. A 200-table store renders and answers a search within the page's existing time bound.
- **Never pretends to be complete.** Under the store picker, the folders found but not read (dialect unknown, order unknown, a dialect with no reader yet) are listed with their reason, and so are the extractors that failed.
- No network and no CDN: the page's CSP still admits only its own script, by hash. The store summary `graph_data` prints now lives beside the model (`reconcile.mjs`), so the tool and the page say the same.

## 0.27.1 — SQLite keeps the migration replay off the disk

The data model's replay runs a repository's own SQL in an in-memory database. Until now, a text filter alone kept `ATTACH`, `DETACH` and `VACUUM` out. A crafted migration could slip one past it and write a file on the machine that indexes the repository. The review of this fix showed it with a trigger whose body uses an identifier such as `éCASE`: SQLite reads it as one name, the splitter read a `CASE` keyword in it, so the trigger never closed and swallowed the `ATTACH` that followed.

- **The engine enforces it.** The replay's database allows no attached database (`limits.attach = 0`, which also stops `VACUUM INTO`, since it attaches its target). An authorizer denies `ATTACH`, `DETACH` and the `temp_store_directory` and `data_store_directory` PRAGMAs. Those two are process-wide, so they would also move the graph store's temporary files. A probe `ATTACH` confirms the guard on every replay, and a refusal says why the replay stopped.
- **Older Node.** Where Node provides neither, any statement whose text names `ATTACH`, `DETACH`, `VACUUM` or one of those PRAGMAs stops the replay, with the reason. SQLite needs those keywords as plain tokens, so this can refuse too much but never too little. Each piece then runs as one prepared statement, never through `exec`.
- **Nothing else changes.** Columns named `attach` or `vacuum` still replay where the engine guards.

## 0.27.0 — the data model map reads SQL migrations: `graph_data` (data model map slice 1, #75)

The code graph now also keeps a map of the data models the repositories declare, read from migrations and schema snapshots, never from a database and never by running the project's code. This first slice reads SQL migration folders and the schema snapshots a migration generator writes beside them; later slices add the Data tab, the change view and more formats (`docs/specs/2026-11-06-data-model-map-design.md`).

- **The model** (`tools/graph/lib/data/model.mjs`): stores, entities, fields, keys, indexes and foreign keys, name-keyed. Every element carries the `path:line` of each declaration that states it, most trusted first, and a conflict wherever two declarations of a store disagree, with every side kept: nothing is resolved by precedence. Composite primary keys compare as keys.
- **Found by content, whatever the tool.** A migration folder is any folder with a `.sql` file that creates or alters a table or an index, whatever it is called, with one migration per file or per versioned subfolder (`<version>_<name>/migration.sql` or `up.sql`). Once found, every file of it holding a schema statement is replayed, one holding only a `DROP` or a view included. Down migrations and files with no schema statement (seeds, queries) are left out. The order comes from the tool's journal (`meta/_journal.json`), else from the numeric or timestamp prefix of the names, else it is unknown and the folder is not replayed.
- **The dialect is stated or seen, never guessed.** `graph.data.migrations` in `grimoire.config.json`, the migration tool's own config, journal, lock file or datasource, or a Supabase folder (Postgres) state it; otherwise `readers/sql-dialect.mjs` sniffs the SQL's own markers. No marker, or markers of two dialects, leaves it unknown, and an unknown folder is listed, not replayed.
- **SQLite folders are replayed** into an in-memory `node:sqlite` database and read back with PRAGMA, so the model is what a fresh database gets. Each table, column, key, index and foreign key cites the migration line that created or last altered it. A statement SQLite rejects stops the replay there: the facts so far are kept, labelled with where it stopped and the error. Postgres and MySQL folders are listed as found, not yet read.
- **Schema snapshots** (the newest `meta/NNNN_snapshot.json` with its `tables{}`, and the v1 format's `<version>_<name>/snapshot.json` with its `ddl[]`, whose DAG leaves are used) are a second declaration of the same store, so a hand-edited migration shows as a conflict against the snapshot.
- **In the index.** The files the extractors read and the facts they produce are stored per file and per folder in `graph.db`, re-extracted only when an input changes (a deleted migration re-runs its folder). The store's schema moves to 5, so an older index is rebuilt once. An extractor that throws loses its facts and is reported by `graph_status`, `graph_index` and `graph_data`; the index goes on.
- **`graph_data`** lists the stores, one store's entities, or one entity with every source and conflict; `graph.mjs data list [<store>] | show <entity>` answers the same from a shell.

## 0.26.1 — the `/grimoire:logs` test no longer ages out

`scripts/render-logs.test.mjs` pinned its run-closing fixture to 2026-11-04 12:00 UTC, while the `summary` command it spawns reads the real clock. Twelve hours later, the fixture's "live" run read as stale and the outcome line failed, on `main` and on every pull request. The fixture is now anchored on the real clock, like the file's other fixtures. Test-only: nothing changes for a project.

## 0.26.0 — the stuck watch acts, under `loopGuard: "on"` (token economy slice 5, #51)

The stuck watch (0.22.0, 0.23.0) can now tell a looping agent, once `economy.loopGuard` is `"on"`. The default stays `"shadow"`, which records what it would do and sends nothing. Spike S1 confirmed that a `PostToolUse` hook's `additionalContext` reaches the subagent's own context, not its parent's. The same answer to a `PostToolUseFailure` was not part of the spike: if the client ignores it there, that call's redirect is lost, and the next verdict comes on a later call.

- **The redirect, then BLOCKED.** The first stuck verdict on a dispatched agent sends it the judge's `redirect` text, or the template when no judge ruled. It goes as `additionalContext`, under the event name the call came in on (`PostToolUse` or `PostToolUseFailure`), and a fresh segment starts. The next stuck verdict sends one line: stop and return BLOCKED, with what it tried and the reason, the summary starting `STUCK WATCH <agent_id>:`.
  - A pending judge request is dropped at each step, so no judge rules again on a segment that has ended. The new segment writes its own request once it reaches the gate.
  - At the block the hook writes the watch's record, `.grimoire/economy/judge/<agent_id>.blocked.json` (the reason and the digest: counts, commands and failure signatures, never output).
  - A judge's `reason` and `redirect` are model-written: each is cut to one line of bounded length, without backticks or control characters, before it reaches an agent, so neither can forge the `STUCK WATCH` marker.
- **Only the backstop acts without a judge.** The spec's free rules (D6 when the judges' budget is spent, D10 for the main session) are `is_stuck` and the backstop: a stuck segment past 2.5 × the role's envelope is a verdict with no judge. A stuck segment past the envelope but short of the backstop is the judge's to rule on, and is left alone where no judge can rule. In shadow it was recorded as `would-redirect` until now. It no longer is, so shadow's record matches what `"on"` would do. `replay.mjs` still counts the envelope tier.
- **The engine.** The judges' `stuck` journal events are `redirect` and `block` under `"on"` (`would-` under shadow), and the judge is told its verdicts are delivered. The step comes from the request's segment, which counts the redirects the hook already gave (the judge's or the backstop's), no longer from a count of the engine's verdicts. A verdict after a backstop redirect is therefore journaled as the block it is. A backstop's own redirect or block is recorded in the agent's state (`turns/<agent_id>.json`, `events`), not in the journal. A BLOCKED whose summary starts with `STUCK WATCH` goes to the resolve rung, as a NEEDS_CONTEXT question does. The scout gets the agent's summary and the command that reads the watch's record. An answer re-dispatches the implementer with it; without one, the task stays BLOCKED for the replanner. The resolve brief gains a paragraph: the record's digest is evidence of what failed, and a record that is missing, or names another repo than the task's, is no evidence.
- **The main session, under `"on"` only.** One turn per prompt: the state is keyed by session (`turns/main-<session_id>.json`), dropped at `UserPromptSubmit` and closed at `Stop`. That gives the spec's per-prompt key without relying on a prompt id in the hook input. `Stop` feeds the `<repo>/main` envelope from a turn that ended green. Free rule only, no judge: one redirect line, then a `systemMessage` asking the person to press Esc if the turn is not making progress. `hooks.json` registers the wrapper on `UserPromptSubmit` and `Stop`. The wrapper starts `node` for the main session's events only when `grimoire.config.json` sets `"loopGuard": "on"`. In a linked worktree it also reads the main checkout's config, as `project-config.mjs` layers it.

## 0.25.0 — learned facts in the loop's briefs (token economy slice 7, #53)

The environment facts the economy hook learns (0.24.0) now reach the loop's agents, and the ones that hold are proposed as memory.

- **In the briefs.** The harness-context loader runs the new `scripts/economy/facts/cli.mjs render` once for the run's repos and returns each repo's block and the ids it shows (`HARNESS_CONTEXT_SCHEMA.factBlocks` and `factIds`).
  - Every implementer, fix and gate brief of a repo carries the block under "## Learned environment facts (machine-observed; you never write them)".
  - It is the same block for the whole run (a resumed run reads it again), so the cached brief prefix never changes. Reviewers do not get it.
  - Only a block the CLI could have rendered (its header, at most 1,000 characters) is pasted. `economy.facts: "off"` keeps every brief clear, and the harness-context log line names the repos that have facts.
- **Counted as fired.** A marker beside the block names the ids shown. The hook reads it from the dispatch's first prompt at `SubagentStop`, so a failure the block prevented in a loop dispatch counts as fired, as it does for a session.
- **Into memory.** `render-logs.mjs summary` lists the facts active for at least 10 of their repo's folds, with how often they fired (`learnedFacts` in `--json`, one line each in the text). `crystallize` proposes them as memory entries in its PR (new signal row and eval case). The CLI's `durable` command gives the same list.

## 0.24.0 — learned environment facts (token economy slice 6, #52)

Agents keep rediscovering the same things about a repository's environment. The economy hook now learns them from finished work, with no model, and shows them to the next session in that repository.

- **`scripts/economy/facts/`** ports microsoft/TokenEconomizer's LLM-free micro-skills (commit `1deb887`, Apache-2.0, credited per file):
  - `observe.mjs`: command segmentation, intent and form, error classes, outcomes in compound commands. rtk's prefix is stripped too.
  - `families.mjs`: the five families: form repair, arg repair, env value, boundary and empty probe.
  - `lifecycle.mjs`: three confirmations, the 0.8^age score with contradictions weighted 5×, the firing gate of ≥ 40 % over ≥ 4.
  - `render.mjs`: at most 4 facts and about 600 characters, with the advice lint.
  - All of its envfacts tests are ported (89 checks). A differential against the Python matched on 3,485 of 3,486 comparisons; the one difference is a tie the Python breaks by hash order.
- **The hook folds** each finished dispatch (`SubagentStop`, its transcript) and session (`SessionEnd`) once, into the store of each repo its calls ran in (`.grimoire/economy/facts/<repo>.json`; a git worktree of a repo, such as a loop lane, counts as that repo).
  - This happens under a lock. Every repo's store is computed before anything is written, so a retry never folds twice.
  - A busy lock skips a dispatch's fold until its next stop.
  - A fact's history keeps its last 50 folds and its count tables their 20 most frequent entries. A fact missing its family's fields is dropped as it is read.
- **Never a secret.** The block reaches every later session in the repo, so secrets are kept out of it at capture:
  - a URL's credentials never reach a boundary host;
  - an environment variable's value is kept only when its name does not read like a secret and the value is a short plain word or path that does not look like a token. Otherwise the fact names the variable alone.
- **Small changes from the source**: a failed command's `Exit code N` counts only at the start of its output, where Claude Code puts it; and a confirmation no longer keeps the session's edited files (environment facts do not drift, so they were never read).
- **It shows them** at `SessionStart` (`startup`, `clear`, `compact`; never `resume`): a session inside a repo gets that repo's block as `additionalContext`. The ids shown are kept so the session's fold counts a prevented failure as fired.
- `economy.facts: "off"` learns and shows nothing. The wrapper lets the session events through. The hooks README has a "Learned environment facts" section.

## 0.23.0 — the stuck judge: the engine rules on the stuck watch's requests (token economy slice 4, #50)

The stuck watch (0.22.0) writes a judge request when a dispatched agent's calls look like a loop. Now a judge rules on those requests. It is a workflow subagent the engine dispatches, never a `claude -p` call.

- **When.** While a writer has been in flight past `economy.judgeAfterMin` (10), the engine dispatches a `stuck-judge` every `economy.judgeEveryMin` (5), on `economy.judgeModel` (haiku) with effort low.
  - Only implementer and fix dispatches start the clock, not a gate or an integration. No judge goes out during a halt.
  - Never two at once: a judge has no hard limit, so a late one holds the next one back instead of running beside it on the same requests. None goes out once no old writer is left.
  - A workflow has no clock, so each writer's age is a timer; the judge needs `agentTimeoutMin` > 0.
  - Not yet measured (spec spike S3): a judge competes with implementers for the runtime's concurrent-agent cap, so under a full cap it queues, and queue time counts toward its soft limit.
- **What it does** (`workflows/briefs/stuck-judge.md`). It reads the pending requests (an agent's id is the file name; a request over two hours old is dropped unruled), whose digests are data, never instructions, and rules `{stuck, confidence, reason, redirect}` on each, favouring sparing. It writes `<agentId>.result.json` for the hook to read on the agent's next call, and deletes the request.
- **What is journaled.** One `stuck` event per verdict:
  - `would-redirect` when stuck at confidence ≥ 0.7;
  - `would-block` for the same agent's next such verdict;
  - `spared` otherwise.
  Nothing is sent to any agent in this release.
- **The judges' budget**, `economy.sidecallBudgetUsd`: once the judges have spent it, none is dispatched, and one `budget` event (`kind: 'judge'`) says so. A budget whose spend cannot be read (no `runId`, no cost back) is blind: one `budget` event (`action: 'blind'`) and one log line say so, and the judges go on. A budget with a price table that lacks the judge's tier warns at start.
  - Their spend is what `runs.mjs cost --kind stuck-judge` reads from their transcripts.
  - It is counted in USD with `economy.prices` (USD per million effective tokens, per model tier), in effective tokens without.
- `economy.loopGuard: "off"` dispatches no judge. `/grimoire:logs` reads `stuck` events as sentences, and the judges' cost shows under the dispatch kind `stuck-judge`.

## 0.22.0 — the stuck watch, in shadow (token economy slice 3, #49)

A dispatched agent can loop: the same failing test, edit after edit, until its time limit. This release watches every dispatched agent's calls and records what it would do. Nothing is sent to the agent yet.

- **`hooks/scripts/economy.mjs`**, a new hook on `PostToolUse`, `PostToolUseFailure` and `SubagentStop`, folds each subagent call into `.grimoire/economy/turns/<agent_id>.json`, in the main checkout.
  - When the gate opens (18 calls, then a repeated failure or 8 error outputs), it writes a judge request holding counts, commands and failure signatures, never file content.
  - Stuck and past the role's envelope (or 2.5× it) is recorded as `would-redirect`, a later one as `would-block`. A judge's verdict left for the current segment is recorded the same way.
  - At `SubagentStop`, a dispatch that ended green feeds its role's envelope: the 90th percentile × 1.25, after 5 samples, per repo and agent type, under a lock that drops the sample when busy.
  - It always answers `{}` and fails open: errors go to `errors.log`, with a malformed input's position only. `GRIMOIRE_ECONOMY=0` or `economy.loopGuard: "off"` turns it off.
  - The main session's calls are answered by the wrapper without starting `node`. A dispatched agent's call costs about 50–60 ms, almost all of it `node`'s startup; the handler's own work is about 0.3 ms. No model, git or transcript read on a call.
  - One agent's parallel calls fold one at a time, under a per-agent lock. A Write's response, which carries the whole file, is never read for failures.
- **`scripts/economy/loopguard/`**: the fold and rules, ported from TokenEconomizer (commit `1deb887`, Apache-2.0, credited in each file). That is `SpiralState`, shell-edit detection, failure signatures, a runner's summary verdict for piped test runs, the gate, `is_stuck`, the redirect template and the envelope. Their pinned cases are ported with them (114 checks). Its learned thresholds and its judge cascade are left out: the judge is the engine's dispatch (slice 4).
- **`scripts/economy/replay.mjs`** runs the same fold and free rules over recorded runs, each workflow's dispatches in the order they started, and prints, per role, the dispatches gated, stuck, would-redirect and would-block, the envelope and the flagged cost.
  - On the maintainer's 13 runs, it would redirect 6 engineer dispatches and block 1.
  - The gate opens on many dispatches, as it should: it only decides when a paid look is worth it.
- `.grimoire/economy/` resolves to the main checkout (`scripts/economy/paths.mjs`). `grimoire.config.example.json` gets `economy.loopGuard` and `economy.loopGuardThresholds`, and the hooks README a "stuck watch" section.

## 0.21.0 — tool evidence: the MCP servers each role loads and never uses (token economy slice 8, #54)

Every dispatched agent is sent its loaded tools and the names of its deferred ones on each request, used or not. On recorded runs, the deferred tool-name list of a team engineer was about 8.7 k tokens, 775 of them MCP. This slice measures what each role never uses. Nothing is changed automatically; `crystallize` proposes the denials.

- **`scripts/economy/tools.mjs`** reads the recorded runs offline, with slice 1's reader. Per role, a (repo, agent type), it records the MCP servers its dispatches loaded (`.prefix.json` plus the deferred-tool deltas) and whether any of them called it.
  - A server is a candidate when the role never used it and loaded it over at least 10 dispatches in at least 2 runs, or over 5 runs. The thresholds are adapted from TokenEconomizer's tool pruning (commit `1deb887`, Apache-2.0, credited in the file).
  - Built-in tools are never candidates.
  - The desktop app's own servers (`ccd_*`) always are. On real runs, the app and webapp engineers did call `ccd_session` and `ccd_turn`, which act on the launching session's panes, so the candidate says so.
  - Dispatches the journal places in no repo (startup probes, run-level agents) and the generic `workflow-subagent` are left out: a probe loads a role's tools and calls none.
- **`render-logs.mjs summary`** reports it: `toolEvidence` in `--json`, with each candidate's counts and the tokens its deferred names cost each dispatch, and one line per role in the text.
  - On the maintainer's 13 recorded runs, it never proposes the simulator for the app engineer or the browser for the webapp engineer, both of which used them.
- **`crystallize`** proposes `disallowedTools: mcp__<server>__*` on the role's definition, with the counts (new signal row and eval case). The denial fails open for teammates whose connectors carry other ids.
- **The team-agent template** withholds the desktop app's servers, one `mcp__ccd_<server>__*` entry each. A prefix wildcard across servers is not documented for `disallowedTools`. `/grimoire:setup` proposes the line for an existing agent that lacks it (new eval case).
- **Not counted: an agent's own subagents.** The issue asked for the used tools "subagents included". A dispatched agent's Agent-tool subagents are not in the workflow's agent dir, so their calls are not joined to it. The recorded runs hold no such call from an engineer (0 of 1,551 dispatches), so no candidate rests on the gap.
- `scripts/economy/runs.mjs` exports `labelContext` and `attributeIn`, which `costOf` now uses too. The transcript reader gains a `skipResults` mode: the calls and tool deltas without their results.

## 0.20.1 — the cost report: exact attribution, a faster read (#56)

The follow-ups from the review of the token economy's slice 1 ([#55](https://github.com/laurentlouk/grimoire/pull/55)).

- **Attribution** (`scripts/economy/runs.mjs`):
  - An attempt suffix (`#n`, `~rn`, `+ctxn`) is dropped before a `:<segment>`, so a task id that holds `:` keeps its task (`privacy:org/r:12#2` → `org/r:12`, `privacy:api:final#1` → `api:final`).
  - Run-level kinds (`preflight`, `journal`, `status`, `claim`, `replan`, `hydrate`) are attributed to no task or repo, whatever their label holds (`preflight:grimoire:perf-scout` is no longer billed to a repo named `grimoire`).
  - A symlinked project or session dir is read like any other.
- **"Cost by kind"** counts every review persona as one kind, `review`. The lens split still names each persona.
- **A faster read.** A bill parses only the assistant lines of each transcript and reads no calls or tool lists. On 1,588 recorded transcripts (1.1 GB), billing every run went from 3.2 s to 1.8 s with identical totals. The workflow-file scan was 67 ms of it, so the bounded peek the review proposed was left out.
- **The cost tile** says it counts the dispatched agents only, not the launching session.
- **Not done: labels on the journal's events.** The review's root fix would add an event per dispatch, so more journal flushes, each a paid haiku dispatch. The attribution fixes above give the same answers without that cost.

## 0.20.0 — maxCost: a cap on what a run really costs (token economy slice 2, #48)

`maxOutputTokens` caps output tokens, the one usage counter a script sees, and those were 4–7 % of the real cost on recorded runs. `maxCost` caps the real cost, in effective tokens with the cache included (the slice 1 weights), across every session of the run.

- **The journal reads the cost.** With `maxCost` set, each journal flush runs `scripts/economy/runs.mjs cost --run <runId>` after writing. It reads every session of the runId from Claude Code's transcripts, under the project root and its worktrees, and the writer returns `costSoFar`. `journal-writer.sh` is regenerated.
- **The engine checks it before every dispatch**, beside `maxOutputTokens`. At 80 % it warns once. At the cap it stops dispatching, lets in-flight work settle, and halts `budget_exhausted` naming the cost cap. Its `budget` events carry `kind: 'cost'`. The cap lags by up to one flush.
- **A cost it cannot read never halts.** With the journal off, no `runId`, no transcripts on this machine, or a cost script that fails, one `budget` event (`action: 'blind'`) and one log line say the cap is blind.
- **`pluginRoot`**, a new engine arg the orchestrate skill passes: the skill runs a copy of `workflows/` only, so the cost script is found in the plugin itself. Without it, the blind cap's log line says where it looked.
- **A resumed run waits for its start flush** before dispatching, so its earlier sessions' cost is checked first. A flush the writer lost or never ran does not make the cap blind, and resends do not run the cost command.
- **`runs.mjs cost`** is a new CLI: `COST <n>`, or `COST none` when no workflow of the runId is found. A run's roots now include the real path of a symlinked root.
- `/grimoire:setup` proposes `maxCost` beside `maxOutputTokens` (new eval case). `/grimoire:logs` labels cost `budget` events, and the knobs table, the "Cost fuse" paragraph, the orchestrate skill and the example config list the new cap.

## 0.19.0 — close a run whose work finished outside the loop

A run that halted or died while its work shipped by hand (PRs merged after the halt, issues redone or canceled) kept coming back in every manager briefing as "resume it", because nothing in the journal could say it was over. On one project, all 7 runs the briefing flagged were already finished: 5 had every PR merged, and 2 had every issue canceled and redone by hand.

- **`run.close`, a new journal event** (`{reason, note, by}`, reason `shipped`, `superseded` or `abandoned`), written in a chunk of its own (`<next seq>.close[.a<N>].jsonl`) by `render-logs.mjs` `closeRun`. Only a person writes it, never the loop. The run reads `closed` from then on, whatever run.json or its `run.end` says, until a later session's `run.start` reopens it. A run still writing its journal (running, written to within 12 h) is refused, and closing a closed run writes nothing.
- **`manager.mjs close-run <runId> --reason … [--note …]`**, and `/grimoire:manager close <runId> <reason> [note]` in the skill: check the PRs and issues, confirm, close. It does not close a PR, delete a branch, move a ticket or touch run.json.
- **The briefing leaves closed runs out.** A halted or stale run whose issues and PRs (`runIssues`, `runPrs`: from its checkpoint, `landed.jsonl`, summary and events) are all absent from the open items now leads with "finished outside the loop? none of its N issues or M PRs is open", and its next step is the close command. This needs every tracker source (and, when the run names PRs, every prs source) read in full. It is a hint, not a verdict.
- **`/grimoire:logs`** shows `closed` with its reason in the runs table, the overview and the timeline. The scorecard counts closed runs apart (`closed N: shipped 1, …`), out of run success.
- **`/grimoire:orchestrate`** does not resume a closed run on its own: it says why it was closed and asks whether to start a new run or reopen this one.

## 0.18.1 — crystallize: what PRs #59 and #60 taught

The crystallize pass on execution policies ([#59](https://github.com/laurentlouk/grimoire/pull/59), [#60](https://github.com/laurentlouk/grimoire/pull/60)). Report: `docs/crystallize/2026-11-01-grimoire-pr59-pr60.md`.

- **`roast`: measure what the design promises.** When a design's value rests on a sorting rule (a router, a threshold, a classifier), run it over the recorded data before approval and put the mix next to the claimed saving. The execution-policy router sent 1 of 113 recorded tasks to FAST, which was found only after approval. New eval case `roast-6`.
- **Docs synced to the code:** the execution-policies spec's status (shipped in 0.16.0 and 0.17.0), its `policies.mode: 'shadow'` mentions (no such flag: every route event records `autoPolicy`), and its resume test (the policy is kept; the implementer is dispatched again and finds its commits).
- **Follow-ups** filed as [#61](https://github.com/laurentlouk/grimoire/issues/61); all but the live-run benchmark shipped in 0.18.0.

## 0.18.0 — execution policies: the gaps the first live run found

Closes the follow-ups of [#61](https://github.com/laurentlouk/grimoire/issues/61): what the first live
run of the policies (three issues, two repos, `/grimoire:implement` + `/grimoire:review`) and the
#60 review left open.

- **Routed again after the build.** The router classifies the declared files; before the panel the
  files the implementer changed are classified again, raise-only: a changed file on a floor makes
  the task strict (the lenses its files promote, fixes on opus, `raisedAfterBuild`, a
  `policy.raised` event), and a FAST build past FAST's footprint (code in a docs-only pick, more
  than `fastMaxFiles` files) runs balanced. An issue with no declared files is no longer judged on
  a guess.
- **An auth change is strict whatever the file is named.** The precheck reports `authChange` (the
  diff adds, removes or changes an authentication or authorization check, `path:line — what`); it
  never fails the change, it raises it to strict with the privacy lens.
- **`repos[].strictPaths`:** floor globs for one repo, added to the run's, where its auth, money or
  contract code lives under names the defaults miss (`src/services/auth.rs`, `**/aws_cognito/**`).
  `setup` proposes them while exploring a repo.
- **The `contract` lens** (the deferred per-task contract check): a reviewer persona no repo draws
  by tag, promoted under strict by a contract file (`policies.promote.contract`: proto, OpenAPI,
  AsyncAPI, GraphQL, Avro) or a dependency on another repo's issue. Its brief names the other
  repositories' paths and run branches and the task it depends on; it FAILs a mismatch or a breaking
  change with no stated release order. It runs on the reviewer agent and its verdict schema, so
  verify, fix and guard treat it like any lens.
- **One rule, stated once.** `workflows/policies.md` now carries the promotion rule and a session's
  version of the floors: a session lists the files it will touch when none are declared, classifies
  the diff again after the build, floors on a blocking relation on another repo's issue (declared or
  found while building), and promotes lenses only by `policies.promote` and a cross-repo
  dependency. `implement` and `review` defer to it instead of paraphrasing it.
- **A session's panel is written down:** with no terminal sweep, `balanced` and `strict` add the
  terminal lenses that fit the repo's tags. On the live run those lenses found all three majors.
- **The spec hawk reads the repo's rules.** The invariants and golden rules of its agent
  instruction files (`AGENTS.md` and its peers) are part of the task; a breach is a major. **`break-it`**: a new limit or check that a retry,
  resend, job or second path skips is a major. Both misses were caught by an outside reviewer on
  the live run.
- **#60 review minors:** an escalated task's STRICT round-0 verifier has its own label and worktree
  (`verify:<id>:<mode>#0~strict`, `verify-<mode>-r0-strict`); `reviewParallel: 'off'` holds after an
  escalation (spec ~strict, then quality ~strict); escalations not landed are in the PR marker
  (`esc`, raise-only), so a resume from the marker alone never runs such a task FAST again.
- **The benchmark's input:** `landed.jsonl` records each task's `declared` files apart from the files
  it changed, and `policy-counterfactual.mjs` routes on them when present (`declaredCoverage`), so
  the FAST tuning in #61 can be decided on the router's own facts.
- **Fixed:** a landed delta now counts its bytes as written (the stamp included), so it stays under
  `LANDED_DELTA_BYTES`.
- Tests: `execution-policies.test.mjs` 105 assertions (build re-routing, the auth signal, `allowBelowFloor`, an already-strict task gaining lenses,
  `repos[].strictPaths`, the contract lens, the marker's `esc`, `reviewParallel: 'off'` after an
  escalation); the resume suite reads `esc`; the counterfactual routes on declared files. New eval
  cases `implement-7`, `review-7`, `setup-14`.

## 0.17.0 — execution policies: FAST, escalation, history, and the edge

Slices 3–5 of [execution policies](docs/specs/2026-10-31-execution-policies-design.md). The default
is still balanced, as in 0.15.1: FAST runs only where `policy` (run, repo or label) asks for it or
`auto` picks it.

- **FAST is live.** `spec-hawk` ∥ `break-it` judge the head once; verified gating findings from
  both stages go to ONE fix, spec first (`fix:<id>:fast#1`); the guard alone checks it
  (`guard:<id>:fast`), running the repo's new `repos[].check` command when set. A guard PASS lands.
- **Escalation in place.** Any other outcome is a visible FAST failure (`fast` event) and the task
  continues as STRICT on the same head: the commits stay, the strict panel reviews the whole task
  range as round 0 (`<persona>:<id>~strict`), the fix round spent counts against
  `maxFixAttempts`, the implementer moves to opus. No second implementation, no replan spent.
  `policies.fast.onFail: 'fail'` books `SPEC_FAILED` / `QUALITY_FAILED` instead.
- **Resume keeps it:** `checkpoint.policies` holds escalated tasks not yet landed (raise-only, from
  the local `run.json` only); a replan keeps the issue's labels and an escalation.
- **History raise (D6):** the harness-context loader sums each repo's FAST tasks and escalations
  from earlier ledgers (`policyHistory`); a repo above `historyMaxEscalation` over at least 4 tasks
  keeps its tasks off FAST, and a learning about the repo naming a task's file raises that task.
- **A docs-only FAST pick that changed code** runs balanced (`raisedAtPrecheck`).
- **`workflows/policies.md`**, the one profile table, read by `/grimoire:implement`,
  `/grimoire:review` (a session's default is FAST unless a floor or raise applies: the owner's
  one-review rule as a profile) and the manager's launch prompts. Drift-checked against the
  engine's router block (group 10 of `npm run check`).
- **Manager:** a loose issue's launch prompt names its execution policy, and a launch into a repo a
  live grimoire run named waits for it (`waitsForRuns`).
- **`settle` events carry `policy` and `escalatedFrom`**; `result.policies.fast` counts passes,
  escalations and failures.
- **Review follow-ups from 0.16.0 fixed:** annotated declared files (`x.proto (new)`, backticks,
  `x.tf: add`) meet their floor; a re-routed task counts once in `byPolicy`; a replanned task keeps
  its labels; `*` and `?` inside a glob's `{a,b}` work; hydration's proposal applies under `auto`
  only (documented).
- Tests: `execution-policies.test.mjs` grows to 81 assertions (FAST pass, consolidated fix,
  escalation without re-implementation, shared fix budget, `onFail`, mixed DAG, resume, history,
  annotated paths); `manager.test.mjs` covers the live-run wait.

## 0.16.0 — execution policies: the router, shadow mode, and STRICT

The first two slices of execution policies ([spec](docs/specs/2026-10-31-execution-policies-design.md)).
Each task runs under a profile, fast, balanced or strict, picked by a deterministic router inside
the existing engine: one scheduler, one task graph, one journal, one resume path. Without a
`policy` in the config, every task runs balanced, the lifecycle of 0.15.1 unchanged, and the
existing suites pass as they were.

- **The router** (`classifyPolicy`, no model call). Hard floors make a task STRICT: a declared
  file in `policies.strictPaths` (migrations, auth, payments, billing, protobuf, OpenAPI, GraphQL
  schema, CI workflows, Terraform by default), a repo tag in `strictTags` (`infra`), the migration
  specialist, a dependency on another repo's issue. Raises keep it at least balanced: no declared
  files, more than `fastMaxFiles` (3), `fanOut` (3) dependents, an opus pick, a replan after a code
  failure. A docs-only footprint, or a small one with no raise, picks fast. Hydration may propose a
  stricter policy with a reason (`policy`, `policyReason` on the task); it never lowers one.
- **Shadow mode, always on.** Every `route` event records `autoPolicy` and the signals behind it,
  whatever ran. With no policy asked for, that is the benchmark's shadow record.
- **STRICT** floors the implementer at opus and moves `privacy` (auth, session, secret, payment
  paths) and `data-integrity` (migrations, SQL, schemas, contracts, and any cross-repo dependency)
  into the task's own quality stage, as reused personas (`policies.promote` reshapes the globs).
- **Overrides:** a tracker label `grimoire:policy/<p>` (hydration copies `labels`) >
  `repos[].policy` > the run's `policy`; `auto` takes the router's pick. An explicit policy below a
  hard floor is refused (the task runs strict, `policy.override_refused` journaled) unless
  `policies.allowBelowFloor`.
- **FAST is not live yet:** a `fast` pick runs balanced until the next slice ships its profile
  (one review round, one consolidated fix, the guard once, escalation to strict on failure).
- **Where it shows:** `result.policies` and the ledger (`byPolicy`, `auto`, `refused`,
  `belowFloor`, per task `policy`, `auto`, `source`, `signals`); the preview's
  `policies.strictAtIndex` and rules; `render-logs.mjs summary --json` groups first-round passes,
  fixes and cost by policy (`byPolicy`, `costByPolicy`, `autoPolicyMix`).
- **`scripts/policy-counterfactual.mjs`**, the benchmark's first stage: it re-routes recorded runs
  through the engine's own router block (`policy:begin` … `policy:end`, evaluated as is) and lists
  any task it would send FAST that carries a recorded failure signal. On this machine's 113
  recorded tasks: balanced 96, strict 16, fast 1, and no round-0 failure on the FAST pick (its one
  flag is a terminal finding in its repo, an IAM grant unrelated to its files).
- Tests: `workflows/tests/execution-policies.test.mjs` (default, auto, raises, floors, overrides,
  proposals, config, preview) and `scripts/policy-counterfactual.test.mjs`.

## 0.15.1 — crystallize: what PR #55 taught

The crystallize pass on the token economy's first slice ([#55](https://github.com/laurentlouk/grimoire/pull/55)). Report: `docs/crystallize/2026-10-30-grimoire-pr55.md`.

- **`crystallize`: append eval cases in the file's own format.** Never re-serialise an
  `evals.json`, which rewrites every existing case. Then regenerate the eval suite and run its
  check. In #55, two one-case additions came out as a ~260-line rewrite and had to be restored.
  New eval case `crystallize-8`.
- **Docs synced to the code:**
  - `workflows/README.md` "Token economy (built in)": the real cost is in `/grimoire:logs`;
    `maxOutputTokens` sees output tokens only, 4–7 % of the cost on recorded runs.
  - The token-economy spec, D1: journal events carry no `agent()` label, so cost is attributed
    by parsing labels.
  - The plan: the `economy.prices` USD table moves to slice 4 (#50).
- **Follow-ups** from the #55 review, filed as #56 under #46: attribution edge cases, scan
  speed, grouping review personas, and labels on journal events as the root fix.

## 0.15.0 — full size for the diagrams, their controls inside them

- **Full size** (`⛶`) for the Architecture diagram, the system map and the file map
  (`tools/graph`): the diagram fills the window, and the browser's own fullscreen where it allows
  it. Esc, `✕` or another tab leaves it. It is a page state, so a click on a component (which
  re-renders the page) keeps it. At full size, Architecture's Fit fits the whole window both
  ways, and a selected component's passport opens beside the diagram.
- **The zoom controls sit inside the diagram**, in its top-right corner, in and out of full size:
  Fit, −, the size and +. Architecture's moved there from the toolbar above it. The system map
  gains them (it only scaled to the page width before), and the file map gains buttons next to
  its wheel zoom; its size reads as a share of the fitted view.
- Tests: `tools/graph/tests/arch-docs.test.mjs` and `graph.test.mjs` press the controls through
  the page's own script. The arch test's fake `window` now keeps every listener of a type, as a
  browser does.

## 0.14.0 — what a run really costs, cache included

The first slice of the token economy ([#46](https://github.com/laurentlouk/grimoire/issues/46),
[spec](docs/specs/2026-10-30-token-economy-design.md)). The loop's only usage counter is the
output-token count, and on 3,357 recorded dispatches output tokens were 5.9 % of the cache-aware
cost: input, cache reads and cache writes are the rest. `/grimoire:logs` now reads each run's real
bill from Claude Code's own transcripts, for runs that already happened too, with no engine change.

- **Cost per dispatch, per task, per tier, per lens, per repo.** `scripts/economy/` reads every
  agent a run dispatched: the workflow files whose `args.runId` is the run (one per session, so a
  resumed run counts whole), then each `agent-<id>.jsonl` with its `.meta.json` (the dispatch
  label). Usage is counted once per message id (a transcript repeats it per content block),
  request blobs are skipped, and cache writes are priced by TTL. Cost is in **effective tokens**:
  input 1, cache read 0.1, cache write 1.25 (5 min) or 2 (1 h), output 5. A model that is not
  Claude's is priced on the same curve and labelled `fallback`.
- **`/grimoire:logs`**: a cost tile and a cost column on the scorecard, **Where the cost went**
  (by dispatch kind, with the tiers), and **Cost by dispatch** in each run's view.
  `summary` prints the cost lines (by tier, kind, lens and repo, largest first), and `--json`
  carries them per run, in the scorecard and per version group (`costByTier`, `costByLens`).
  **Cost coverage** is the share of implementer dispatches whose transcript was found: a run
  launched on another machine has no cost, and says so. `--claude-dir` reads another Claude
  config dir (default `$CLAUDE_CONFIG_DIR`, else `~/.claude`).
- **`crystallize`** weighs spend on the cost lines, never on output tokens alone: its
  routing-rubric row cites the cost by model tier. One eval case each for `crystallize` and
  `logs`.
- Measured on this machine's runs (15 runs, 3 projects): cost coverage 100 % (113/113
  implementer dispatches), output 4–7 % of the cost, implementer dispatches 48–59 % of it.

Adapted from microsoft/TokenEconomizer (`trace/claude.py`, `pricing.py`, commit `1deb887`,
Apache-2.0): the deduplication rules and the cache-aware weights. Nothing of it is installed or
called.

## 0.13.0 — the loop stops redoing what it already did, and the tracker follows it

From an audit of one week of real runs (0.12.1, four projects, 1.93M loop output tokens). No
agent was found repeating the same command with no progress. The waste came from the loop
rebuilding work it had already done, halts that gave the wrong cause, and waits that kept
throwing away each agent's prompt cache. New tests: `workflows/tests/loop-redo-audit.test.mjs`.

### Engine (`workflows/orchestrate-loop.js`)

- **`root`: the run no longer depends on the launching session's folder.** An agent starts in
  whatever folder the launching session is in when it is dispatched. One session `cd`'d into a
  webapp worktree mid-run, and three things broke: the journal resolved its relative run dir
  against the webapp repository and wrote a second run dir there, the commit check failed, and
  the next launch rebuilt a task already landed and pushed. With `root` (an absolute path, which
  `/grimoire:orchestrate` now passes), every brief names it and reads its file by absolute path,
  and every verbatim script (journal, ship, seal, environment check, reconcile) changes to it
  first. Without `root`, prompts are unchanged.
- **A run dir the writer resolved stays absolute.** A resumed run kept the relative
  `.grimoire/runs/<runId>` for every flush and re-resolved it each time; it now uses the absolute
  dir from the first receipt.
- **Environment halts quote the error.** A failed check's reason now quotes its first output
  line. A repo path the check could not enter (`cannot change to`, `not a git repository`) is
  named as that, with "run from the workspace root, or pass `root`". An exit 128 from a path
  failure used to be reported as a signing failure with "unlock the commit-signing agent".
- **A wedged writer keeps a grace window: `wedgeGraceMin`.** It defaults to the hard limit, at
  most 60 min. When the only open work was a wedged writer, the run halted at once, and the halt
  ended that writer: one was minutes from done, and the resume rebuilt its task for three hours.
  The run now keeps waiting for it through the window, and a result inside it is used as usual.
  Other repos keep running meanwhile. `0` keeps the old behaviour.
- **An earlier attempt's commits are reviewed with the new ones.** When an implementer names
  `landedBefore` SHAs and also commits on top, the unreviewed SHAs now widen the reviewed range
  back to the first of them. A rebuilt task once added a one-line comment commit, and the panel
  reviewed only that line while the whole feature under it went unreviewed.

- **Tracker statuses follow the run, on any tracker (`trackerStatus`, on by default).** A run used
  to move an issue only with claims on (in progress at hydration, back to to-do at the end), so
  the tracker could not say what was being built, what was built and waiting for its PR, or what
  was stuck. Each issue now moves:
  - to in progress when its implementer starts, and again when a replan retries it;
  - to in review once it has landed;
  - to blocked, with a comment saying why, when it fails or blocks, and at the end of a run for
    an issue it started and did not land.

  Done is left to the PR merge. Moves are batched into one haiku dispatch at a time
  (`briefs/status.md`, kind `status`, 4/8 min) and never hold the loop up. `{trackerStatus: false}`
  turns it off; `{trackerStatus: {names: {…}}}` names the project's own states. With `claim`, the
  release leaves a blocked issue blocked. Tests: `workflows/tests/tracker-status.test.mjs`.

### Briefs and skills

- **`implement` and `gate`: never one shell wait past 4 minutes.** A Bash call is capped at 10
  minutes and an agent's prompt cache expires after 5, so the turn after a 10-minute poll
  re-wrote the agent's whole context. That was 71 turns and 60% of the week's loop cache writes.
  Long commands now run in the background, waited on in chunks:
  `until grep -q '^EXIT=' <log> || [ $SECONDS -ge 240 ]; do sleep 15; done`. The old "run it in
  the FOREGROUND and wait" could not hold past the shell cap anyway. `implement` also says to list
  an earlier attempt's commits in `landedBefore` even when committing on top.
- **`crystallize`: config fixes and upstream findings get a route.**
  - A repo whose writers keep running late or wedging gets its config fixed in the crystallize PR:
    a `gate` for the long check every task runs, or a `timeoutMin`.
  - A defect in grimoire itself is filed on the plugin's repository, after a search of its open
    issues, and never patched into the engine or its project copy.
  - The report gains Config and Upstream sections. The skill and the loop's brief both say so,
    with an eval case.
- **`review`: the three-round cap applies in a session too,** counted across every source of
  findings on the PR (re-review, bots, PR reviews, later panels). At the cap the remaining
  findings go to the user. "Fix everything" never turns minors into a round of their own. Only
  the failed lens is re-reviewed. The gate never starts on a head still under review. One
  session spent eight review-driven rounds on one PR. With an eval case.
- **`orchestrate`** passes `root`, and says not to `cd` the launching session while a run is in
  flight.
- **`implement`: the 4-minute wait rule, and a resume budget.** After about five resumes, or a
  compaction, the next round starts a fresh implementer from a short handoff. One implementer
  resumed thirteen times reached a context of about a million tokens. With an eval case.

### Releases

- **Every change that ships bumps the version.** The drift check now fails when the CHANGELOG's top
  entry is not the version in `plugin.json` (no more "Unreleased"). Given a base (CI on a pull
  request; the pre-push hook, against `origin/main`), it also fails a change outside `docs/` and
  `.github/` whose version is not higher than the base's (`scripts/version-check.mjs`, with
  tests). Projects install releases only, so this audit's own fixes once sat on main under
  "Unreleased", out of every project's reach.

### Logs (`scripts/render-logs.mjs`)

- **Late and wedged writers per repository:** `lateWriters` and `wedged` in the scorecard's
  `repos`, two columns in the page's Repositories table, and a summary line
  (`repos with writers past the soft limit: web 11 late · 1 wedged (16 landed, no gate passed)`).
  This is the evidence crystallize cites for a repo's `timeoutMin` or `gate`.

## 0.12.1 — every worktree sees the project

A linked worktree now sees the same grimoire as the main checkout: the same config, an index that
starts from the branch it is based on and re-bases onto it after a merge, and a guard that keeps
main's protections. The model came from how other tools solve it: Claude Code reads its project
settings from the main checkout instead of copying them, worktrunk layers config and detects the
default branch in a fixed order, and zoekt and Glean share one base index with a per-branch layer
on top. Only the ideas were borrowed: no dependency, no schema change. Also: the Architecture tab
zooms on scroll, the README covers what 0.12.0 shipped, and two fixes left over from 0.12.0.

### Worktrees

- **One config for every checkout (`scripts/project-config.mjs`, new).** `grimoire.config.json`
  is often untracked or gitignored, so a new worktree had none. The guard and the graph then ran
  on defaults: a `guard.protectedBranches` set on main no longer protected a worktree, and a
  worktree's graph ignored `graph.exclude`. Every reader now resolves the config the same way.
  - A linked worktree with no file of its own reads the main checkout's. Nothing is copied, so
    an edit on main shows up everywhere at once.
  - A worktree's own file is layered over the main one. Objects merge key by key, and any other
    value the worktree sets, an array included, replaces the main one whole.
  - The main checkout is found from files only (`.git` → `commondir`), with no git process, so
    the guard stays within its 5 s budget.
  - `node scripts/project-config.mjs --root <dir>` prints what a checkout sees; `--sources` lists
    the files. `skills/orchestrate` reads the config through it.
  - Readers: the guard (`hooks/scripts/guard.mjs`), the graph (`tools/graph/lib/project.mjs`),
    the manager (`scripts/manager.mjs`: a `--config <dir>/grimoire.config.json` is resolved in
    layers at `<dir>`, any other file is read as is) and the log renderer. The manager's own
    `mainCheckout` is now the shared one.
  - `scripts/project-config.mjs` joins the harness manifest, since the guard's verdicts depend
    on it.
- **The graph starts from the branch a worktree is based on (`tools/graph/lib/freshness.mjs`).**
  The base is the first of these branches that another checkout has checked out with an index:
  `baseBranch` in the config, the branch's upstream when it names another branch, `origin/HEAD`,
  `main`, then `master`. Otherwise it is the main checkout, as before. A branch stacked on `dev`
  is seeded from dev's index, not main's.
- **…and re-bases onto it after a merge.** Every index run, under its lock, checks whether HEAD
  moved since the last index. If it did, it counts the files left to re-parse from its own index
  and from the base's (`git diff --name-only`). When the base's saves at least 20
  (`GRIMOIRE_GRAPH_REBASE_MIN`), it copies the base's index in one transaction (WAL-safe, so
  readers see the old index or the new one), then indexes incrementally. Once work merged into
  main is indexed there, a worktree that pulls it copies the result instead of parsing it again.
  The answers stay the same; only the parsing cost changes. `graph_status` names the base.
- **Fix: seeding a worktree saved nothing in a project without `repos[]`.** The one repository
  was named after the checkout's folder, so the rows copied from the main checkout (`grimoire`)
  never matched the worktree's (`feat-x`): the first index dropped them and parsed everything.
  The default repository is now named after the main checkout in every worktree. An existing
  worktree index is rebuilt once, on its next refresh.

### The graph page

- **The Architecture tab zooms on scroll (`tools/graph/lib/arch-view.mjs`).** The wheel, or a
  trackpad pinch, zooms around the pointer, as d3-zoom and React Flow do: the point under the
  pointer stays put. Drag or the scrollbars pan. Fit, −, + and the percentage stay in the
  toolbar, which now ranges 20–300 %. The diagram is resized in place, with no re-render, so it
  keeps up with a trackpad.

### Docs

- **The README covers what 0.12.0 shipped:** a section on `/grimoire:manager` (sources,
  read-only scouts, the ranking, launching, the headline, the schedule and the shared post), one
  on worktrees, and the Architecture tab's zoom and pan. The graph README, the graph skill and
  the hooks README describe the worktree base and the config read-through.

### Fixes

- **The schedule's probe goes through the route the schedule takes (`skills/setup`).** In 0.12.0,
  the probe was always `claude -p`, also for a desktop task. Launched from a desktop session, it
  inherits that session's `ANTHROPIC_BASE_URL` and `CLAUDE_CODE_*` variables and fails before any
  read (`401 OAuth access token is invalid`). Cleared of them, it needs a CLI login of its own,
  and even when it passes, it says nothing about the task.
  - **A desktop task is probed through the app, never the CLI.** On the yes to the probe, setup
    creates the task with no schedule (manual only) and the probe as its prompt, runs it once
    (`run_scheduled_task`) and reads the result (`list_task_runs`). The second yes gives that same
    task its prompt and cron (`update_scheduled_task`), so an approval given in the probe's run
    stays on it. Setup never asks for `claude auth login` on this route.
  - **The cron probe runs in cron's bare environment:** `env -i HOME USER PATH <claude> -p …`.
    A 401 there is the CLI's own login, which is the user's to fix.
  - Setup says where a desktop task runs: the project's main checkout, also when the task was
    created from a linked worktree. It also says whether the task kept the session's permission
    mode.
  - Evals `setup-12` and `setup-13` follow.
- **The shared post stays small enough to retype (`scripts/manager.mjs` share-body,
  `skills/manager`, `skills/setup`).** A Linear document or a Slack canvas gets its body through
  one connector call, so the model retypes `share-body`'s output verbatim. A 148-item briefing
  made a 65 KB body, which was slow to send, could not be checked, and was split across three
  writes.
  - **Default limit by destination.** 20,000 characters for a `linear-document` or a
    `slack-canvas`. A `github-issue` keeps GitHub's 65,536, and its body is now redirected into
    the file (`share-body … > <file>`), never retyped. The cut is unchanged: from the end, with
    "… N more".
  - **What repeats is said once, what nobody acts on is listed by key.** Hand to AI's one reason
    (every item there has the same) sits under the heading instead of on 49 lines. Waiting on
    others and Not now list their keys, `A-1 · A-2`, and each item's lines stay in the local
    briefing.
  - The repo check's reason, one machine's checkout state, is only ever a Not now reason, so it
    can't reach the post any more. Its stripping code is gone.
  - On the 148-item briefing: 65,276 characters down to 20,000. Decide and Do come first, and
    the rest is counted.

## 0.12.0 — know where things stand

Three views of where things stand: what the team owes (`/grimoire:manager`, a briefing read from
the tracker by scouts that cannot write, ranked by a tested script), what the system is
(`/grimoire:architecture`, diagrams the code graph checks, and the project's notes as a vault in
the graph page), and whether the runs deliver (a scorecard on `/grimoire:logs`). Underneath, the
loop's journal no longer loses chunks, the ship lock no longer lets two ships in at once, and
`/grimoire:setup` can be re-run on a project already set up.

### The briefing: `/grimoire:manager`, and a setup you can re-run

What the team owes, grouped Decide / Do / Hand to AI / Waiting on others / Not now, from the
tracker, the open pull requests and the loop's own runs. The scouts that read them cannot write,
`scripts/manager.mjs` does the ranking (507 checks), and the issues ready for AI launch from the
briefing. Setup proposes the sources and now re-runs on a configured project, keeping what the
user set by hand.

**Setup (`skills/setup`, `scripts/config-merge.mjs`)**

Re-running `/grimoire:setup` on a project already set up was not handled: nothing checked for an
existing `grimoire.config.json`, `.claude/settings.json` or memory before writing, and the
no-overwrite rule named only the Markdown instructions, the roster and agent definitions.
- **A re-run reads what is there, shows one diff, and writes only what is approved.** Step 0 gains a
  "Re-run" part beside migration mode. Hand-edited values are the user's choice, and secrets are
  referenced, never read. The no-overwrite rule now covers the config, the settings and memory.
- **`scripts/config-merge.mjs` makes the JSON diff.** It takes the current file and a proposal kept
  in the session scratchpad, and prints each key as ADDED, CHANGED or KEPT.
  - A CHANGED key is applied only when an `--approve` names its path, such as `repos[api].gate`.
  - `repos[]` are matched by `name` and `specialists[]` by `agent`; a gate is compared whole.
  - Permission lists and a hook group's commands are sets: the user's entries stay, and the
    proposed ones are added once. A hook is the same hook when its type and command are.
  - Without `--write` it writes nothing. With it, the write is atomic and keeps the file's mode,
    a symlink is written through, and nothing is touched when nothing changes.
  - It names each file by absolute path, and a symlink's target, and warns when an added repo
    sits on another repo's path.
- **Secrets of known shapes are masked.** The two JSON files are read only through the script,
  and its output prints `«redacted»` for:
  - every `env` value;
  - every value under a key named like a token, key, password, credential or auth;
  - inside any value, with the rest of the string kept: `Authorization:` and bearer headers,
    `token=`-style pairs, `--token X`-style flags, `mysql -pX`, `curl -u`, cookies, URL
    credentials, secret query parameters, JWTs, Slack webhooks, and token formats such as
    `ghp_…` and AKIA/ASIA keys.

  Keys and paths are never masked, so a repo named like a token prefix keeps its `--approve`
  hint. An invalid file's error gives its line and column only. The written file keeps the real
  values.
- **The user applies `.claude/settings.json`.** The guard closes that file to agents, so setup
  writes `grimoire.config.json` itself, but for the settings it prints the exact `--write`
  command and the user runs it. A dry run then confirms what is left.
- **The manager section binds the briefing's sources to read-only official tools.** It rides on
  the re-run diff, so a hand-edited source or threshold is kept.
  - It detects the trackers from the docs, `.mcp.json`, the session's connectors, PR templates,
    git remotes and `toolHints.tracker`, and proposes `manager.sources`: one per tracker, a `prs`
    source over the GitHub remotes, and `runs`. Each has a `hint`, a `scope`, and `readOnly`, what
    holds it today: `endpoint` (Linear's `/mcp/readonly`, GitHub's `/x/issues/readonly`) or `flag`
    (`--read-only`) only when the route already uses it, `admin-group` (a read-only account),
    `permission-rule` (`gh` for issues), or `guard` for a claude.ai connector and for the `gh` PR
    source, which only the guard's MCP rule and the scout's instructions hold. A stronger route is
    proposed apart, for the user to apply. Only the vendors' own tools and claude.ai connectors,
    never a community server.
  - Secrets stay out of context: `.mcp.json` joins the files read only through `config-merge.mjs`
    (its `headers` and `env` print as `«redacted»`), and a remote URL is read with its credentials
    stripped by `sed` as it is read.
  - Each source is read once before the diff and gets `verifiedAt`, again after the user corrects
    its scope or hint; a failing one is shown with its fix and not written. `config-merge.mjs`
    matches `manager.sources[]` by `id`, and a re-run reuses the id of a current source with the
    same kind and scope.
  - `manager.repoLabels` (new) maps tracker labels to `repos[]` names from the labels'
    descriptions, the description winning over the name: a `frontend` label described as the
    mobile app maps to the mobile repo, not the web app. A label the descriptions don't tie to one
    repo is left out and named.
  - For a GitHub tracker, the default `priorityLabels` (`priority: urgent` … `low`, `P0`–`P3`,
    `critical`); when the repo has no priority label, an offer to create the four `priority:`
    labels with `gh label create`, listed as a tracker write and run only when the user's answer
    names them. Labels are listed with `--limit 200`, so a long list can't hide them.
  - The `gh` permission rules: deny what the pipeline never runs (`gh issue close`, `delete`,
    `transfer`, `gh pr merge`, `close`), ask for what `to-issues` and claims do. The urgency
    defaults and `maxItemsPerSource: 200`; a re-run builds them and `priorityLabels` from the
    current block, so a hand-set value never shows as changed back to a default. An optional
    `repos[].remote` for a hub of nested clones, which the loop ignores.
  - `grimoire.config.example.json`'s `manager` block follows the spec: a `guard` Linear source,
    the default priority labels, `repoLabels`, and a repo `remote`.
- Checks: `scripts/config-merge.test.mjs` (135, a `.mcp.json` read against `{}` included), and
  the setup evals `setup-6` (a configured project re-run changes nothing before the yes, and
  never writes the settings itself), `setup-7` (a hand-edited gate is kept), `setup-8` (a Linear
  hub gets a `guard` source, `prs`, `runs` and `frontend` mapped to the mobile repo, with no
  secret read raw), `setup-9` (a GitHub repo without priority labels is offered them, created
  only when named), `setup-10` (a hand-set `stalledDays` shows no change) and `setup-11` (the
  briefing itself is the manager's).

**Guard (`hooks/scripts/guard.mjs`)**
- **Scouts can't write through MCP tools.** The manager's scouts read trackers through whatever
  connector the session has, and the guard did not see MCP calls at all. Now `hooks.json` routes
  `mcp__.*` to it. A call from the plugin's scouts or `reviewer` is refused when the first known
  verb in its tool part (after the last `__`, split on `_`, `-` and camelCase) is a write:
  `slack_send_message`, `share_issue`, `createJiraIssue` and `run_scheduled_task` are refused, while
  `list_task_runs`, `slack_read_channel` and `getJiraIssue` pass. The deny line names the verb
  that decided and tells the agent to report the write in its result; the main session applies it.
  - The implementers, generic subagents and the main session are never blocked, nor is a project's
    own agent the config names in `repos` or `specialists`, even one called `reviewer`; the plugin's
    `grimoire:reviewer` stays bound.
    `GRIMOIRE_GUARD_ALLOW=1` and `guard.enabled: false` lift it.
  - It reads verbs, a heuristic: a name with no known verb passes, an unknown write verb
    (`issue_cert`) included. The hooks README lists the limits.
  - An MCP call is judged by its name alone, before the guard asks git anything.

**Manager (`skills/manager`, `scripts/manager.mjs`)**
- **`/grimoire:manager` writes a briefing from the tracker:** what the team owes, grouped Decide /
  Do / Hand to AI / Waiting on others / Not now, each item with why it is there, its next step and
  its link. The skill dispatches `tracker-scout` once per tracker source in `manager.sources` (or
  `toolHints.tracker`, and says so, when there is no `manager` block yet), then runs
  `manager.mjs brief`. It never writes to the tracker.
- **The ranking is a tested script, not the model's judgment.** The scouts return WorkItems against
  `skills/manager/workitem.schema.json`, and the script refuses the whole file on any invalid item,
  naming the item and field, never the value. null in an optional field reads as absent: an
  unread `hasAcceptanceCriteria` shows as "not checked", never as "none". From the fields and one
  `--now`:
  - urgent: priority Urgent or High (`manager.urgent.priorityAtMost`), an SLA breaching within
    24 h or past, due today, overdue or within `dueWithinDays` (2) calendar days;
  - Decide: triage, or urgent with no assignee. Do: any other urgent item. Hand to AI: an issue
    with acceptance criteria, unassigned, nothing open blocking it, no linked PR, no sub-issues
    (the rest of D8, the repo check among it, came with launching: below);
  - the model's `bucketHint` moves an item only between the non-urgent groups: it never makes one
    urgent, nor moves one out of Decide or Do;
  - the order: urgent, priority (none last), due date, oldest created, id.
- **The files:** `.grimoire/manager/briefings/<YYYYMMDD-HHMMSS>.md`, `latest.md` (front matter with
  the counts, `generatedAt`, `partial` and the sources) and `ledger.json` (when each item was first
  seen, a hash of what matters, its last group), under one `.lock` broken after 30 minutes; a held
  lock exits 3. Ticket text is escaped for Markdown and HTML, its `scheme://` and `www.` can't
  become GFM autolinks, and its bidi controls are dropped. `view()` builds the one view model the
  page and the panel will render from, and it carries only safe http(s) urls (null otherwise).
- **`tracker-scout` reaches the tracker's connectors.** Its `tools:` line is gone, so it inherits the
  session's tools (a probe confirmed a subagent loads the claude.ai connectors with ToolSearch);
  `disallowedTools` takes away Write, Edit, MultiEdit and NotebookEdit, the guard refuses its MCP
  writes, and a `gh` write through Bash is held by its instructions and setup's permission rule. It
  has a memory file now. It maps native fields onto
  the WorkItem (Linear's priority as is, Jira Highest..Lowest to 1..4, GitHub labels by
  `manager.priorityLabels`; states onto the six state types, the native ones kept).
- `grimoire.config.example.json` has the `manager` block, documented in `workflows/README.md` as not
  read by the loop.
- **Every urgency rule.** Two more, each a named function next to the others and set in
  `manager.urgent`:
  - not started (backlog or unstarted) and blocking at least `blocksAtLeast` (2) open issues:
    "blocks 3 open issues". A blocked id the briefing did not read counts as open;
  - started with no activity for at least `stalledDays` (5) calendar days, from `lastActivityAt`,
    else `updatedAt`: "no activity for 6 days".
- **New and changed, from the ledger.** An item not in the last briefing is badged **new**; one
  whose state, priority, assignee, due date, blockers, labels or linked PR changed, **changed**.
  The items gone since, or now completed or canceled, are counted as resolved, not listed. The
  counts are in the view model and the front matter (`counts.new`, `.changed`, `.resolved`); the
  first briefing (no ledger) says "first briefing" (`firstBriefing: true`) and badges nothing.
- **Partial sources.** `brief --sources <file>` takes what each scout reported, which the skill
  now writes: `ok`, `capped` (its count shows as "≥ N", never as complete) or `failed` (listed
  under **Not checked** with its reason and fix, and `partial: true`). An item a failed or capped
  source didn't show is neither resolved nor dropped from the ledger. `tracker-scout` replies in
  prose naming the routes it tried when a source can't be read, never `[]`, and says so when it
  stops at `maxItemsPerSource`. Without `--sources`, the sources are inferred from the items.
- **`priorityLabels`** maps labels to 0–4 case-insensitively, defaulting to `priority: urgent` /
  `high` / `medium` / `low`, `P0`–`P3` and `critical`; a config map replaces the defaults. The
  scout applies it, and the script maps a `nativePriority` label itself when `priority` is
  absent, so the result is the same whoever maps it. An unknown priority ranks last.
- **Robustness.** A corrupt or old-schema ledger starts over, said once on stderr, with no crash;
  the ledger's `firstSeenAt` is re-checked; a date-time must be a real calendar day and clock
  time (`2026-02-30T10:00:00Z` is refused); `--items=/dir/a=b.json` splits at the first `=`; a
  stale lock is moved aside, re-checked and only then unlinked, so two runs breaking it never
  both hold it; a `.lock` that is a directory, or any state file the script can't use, is a
  one-line error. Checks: `scripts/manager.test.mjs` (222), and the eval `manager-5` (a source
  that can't be read is listed as not checked, with its fix).
- **Every session opens with the briefing's headline.** A new `SessionStart` hook,
  `hooks/scripts/briefing.sh`, runs `manager.mjs headline`, which reads `latest.md`'s front matter
  (in a linked worktree, the main checkout's too, and the newer wins) and prints one line:
  `grimoire manager · 2 urgent, 3 ready for AI · 1 new · briefing 5 h old (/grimoire:manager)`.
  "first briefing" replaces the new count on the first; the page's path follows when `briefing.html`
  exists; a partial briefing adds `partial: <ids> not checked` (brief now writes `notChecked` to
  the front matter); and past `manager.schedule`'s interval the line ends `stale, run
  /grimoire:manager` (`when` read leniently: a cron line, hourly, every N, weekly; daily, weekdays,
  no schedule or text it can't read is 24 h). It reads files only, never runs a briefing, and
  prints ids and counts, never ticket text: one line under 10,000 characters. No briefing, a
  corrupt one, an unreadable root or no `node` prints nothing, exit 0. Checks:
  `scripts/manager.test.mjs` (287 in all).
- **Open pull requests.** A `prs` source (`category: prs`, `scope.repos`) is dispatched with the
  tracker sources: `tracker-scout` reads `gh pr list --state open --json …` per repo (behind
  `requireHook.raw` when set, or GitHub's MCP) and maps each PR onto four new optional,
  null-tolerant WorkItem fields: `reviewDecision`, `checks` (`passing` / `failing` / `pending`, from
  the status rollup), `reviewRequested` and `isDraft`. The script places a PR by its own rules,
  first match wins: a draft → Not now, a pending review request (anyone asked) → Decide, failing
  CI or an approval not merged → Do, the rest → Waiting on others. A PR is never counted urgent,
  and its review and checks are part of its hash, so a change badges it **changed**.
- **Grimoire runs that need us.** With a `runs` source in `manager.sources`, `brief` reads the run
  journals itself (no scout), through render-logs' `loadRuns` and `runOutcome`, under
  `telemetry.dir` (default `.grimoire/runs`) in the project's main checkout, also when `--root` is
  a linked worktree. Each project's latest run is listed
  under Do when it halted (with the halt's first line), is still "running" with no journal write
  for 12 h, or drained with tasks that need attention; its next step names `/grimoire:orchestrate`
  on the project. A drained run with nothing pending is left out, and no runs directory is
  `runs (0)`, no error. Its status joins the sources like the others.
- **The headline names what people forget.** PRs and runs are never counted urgent, so `brief` adds
  `counts.runsNeedingUs` (the runs under Do) and `counts.prsFailing` (open PRs failing CI, drafts
  left out) to the front matter, and `headline` appends `· 2 runs need you · 1 PR failing CI` after
  the ready-for-AI part when either is above 0. An older `latest.md` without the keys gives the
  same line as before.
- **A shared briefing post, opt-in, replaced on every run.** `manager.share` (`null` by default,
  chosen at setup: a Linear document, a GitHub issue labelled `grimoire-briefing`, or a Slack
  canvas when the session has the Slack connector, replaced in place with no channel message)
  gives the team one view. `brief` now saves its view model as `latest.json`; `manager.mjs
  share-body` renders the post from it in Markdown: the groups, reasons, next steps, counts, Not
  checked and "≥ N", without the new and changed badges or a repo's availability (one person's
  ledger, one machine's checkouts), ending "generated
  by <git user.name> · at <time> · covering <sources>", with a hidden `<!-- grimoire:manager-briefing
  v1 -->` marker the skill finds its own post by (a canvas, by its id). Ticket text is escaped as
  in the briefing, its @mentions broken so the post notifies no one, and the body cut to a GitHub
  issue's 65,536 characters with "… N more". The skill's Share step finds the post through the
  vendor's tool, replaces it or creates it, and records the outcome with `share-status`: a failure
  is a "Share: failed (<reason>)" line in the local briefing, never filed anywhere. It is the
  manager's only write. `config-merge.mjs` compares `manager.share` whole. Checks:
  `scripts/manager.test.mjs` (401 in all, with launching), `scripts/config-merge.test.mjs`.
- **What ODY-872's review found.** A `--sources` file holding `null` is refused, no longer read as
  absent. A `manager.sources` entry missing from `--sources` is listed under Not checked, "not
  reported by the skill", and makes the briefing partial; without `--sources`, a configured source
  with no items reads the same way, since nothing said it was read. An `ok` source whose count is not its
  number of items shows both, flagged "count mismatch", and is not trusted as complete. The
  stalled rule reads the later of `lastActivityAt` and `updatedAt`. With neither `priority` nor
  `nativePriority`, the most urgent label in `labels[]` maps. Checks: `scripts/manager.test.mjs`
  (326 in all).
- **Launch from the briefing.** After the briefing, the skill offers the ready issues as
  multi-select checkboxes, one question per project, and one per source for the issues with no
  project (GitHub Issues), at most 4 options each, plus **All ready**,
  and starts what the user ticks: one new conversation per tracker project, through the host's
  session tool when ToolSearch finds one (the desktop app has one), else a prompt per project to
  paste. Headless runs skip the step.
  - **Hand to AI applies every D8 condition.** On top of the earlier ones: not started (an In
    Progress issue is not handed to AI), the assignee may be `claim.identity`, the issue maps to a
    `repos[]` entry (first through `manager.repoLabels`, so `frontend` reaches the mobile repo,
    then through its `repo`, else to a single-repo project's one entry), and that repo is
    available. Each failure is a reason: "no repo
    mapped: no label in repoLabels", "repo not checked out: repositories/webapp, fix: …".
    Only issues: a PR or a run keeps its own rules and has no repo check. `brief --check-repos`
    runs the check; without it a repo shows as "availability not checked".
  - **`manager.mjs repos`** reports each `repos[]` entry as JSON: available when its path is a git
    work tree (a directory a hub ignores must be a clone of its own), a registered submodule
    initialised. A failure carries its fix, and the command when it is one: `git clone --
    <remote> <path>` for a missing nested clone, `git submodule update --init -- <path>` for an
    uninitialised submodule (the `--` keeps a path that starts with `-` from reading as an
    option). A remote with any credential (on http(s), ftp or git URLs, any user name, a bare
    token included; a password anywhere) is never printed: the fix is prose, with no command.
    The skill runs a fix only on the user's yes. Clones `repos[]` doesn't name are ignored.
  - **`manager.mjs launch-plan --ids …`** re-checks the ticked ids against the WorkItems and a
    fresh repos check, and groups them per tracker project: a sliced project goes to
    `/grimoire:orchestrate`, a loose ready issue to `/grimoire:implement` then `/grimoire:review`,
    an issue without acceptance criteria to `/grimoire:roast` first. Groups that share a checkout
    run one after the other (`waitsFor`), never in parallel: a checkout is compared by its real
    path, so `repositories/webapp` and `repositories/webapp/` are one. Each prompt is self-contained and
    carries ids, routes and repo paths only, never a ticket's title, body, labels or project
    name: the launched conversation reads the tickets itself. An unknown, ambiguous or ineligible
    id is refused with its reason. Checks: `scripts/manager.test.mjs` (384 in all, the repos
    check on real temp git repos), and the evals `manager-6` to `manager-8`.
- **A local daily schedule, under the user's own login, no API key.** `/grimoire:setup` gains an
  opt-in schedule step, through the re-run diff:
  - **a desktop task first,** when ToolSearch finds the host's scheduled-tasks tool (the desktop
    app's `create_scheduled_task`): a local cron expression (weekdays 08:30 proposed, the time is
    the user's) and the prompt `/grimoire:manager scheduled <project path>`, created only on the
    user's yes to the schedule, and updated, never duplicated, on a re-run;
  - **otherwise a crontab line** the user installs: `cd "<project>" && mkdir -p .grimoire/manager
    && env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN <claude> -p '/grimoire:manager scheduled
    "<project>"' --permission-prompts none [--max-budget-usd <budgetUsd>] >>
    .grimoire/manager/cron.log 2>&1`, with a `PATH=` line for `node` and `gh`. Never `--bare`
    (it needs `ANTHROPIC_API_KEY`), and no key anywhere: `env -u` drops one the shell or cron
    inherited, which `claude -p` would otherwise use instead of the login;
  - the `permissions.allow` rules a headless run needs (each source's read tools by name, the
    briefing's script and its input folder), for the user to apply. They name the version-pinned
    plugin root, so re-run `/grimoire:setup` after `/plugin update`. Then a headless probe,
    `env -u … claude -p "<one read per source>" --permission-prompts none`, run only on a yes; the
    `runs` source is read through the `manager.mjs` call, as a scheduled briefing reads it. A
    source that fails headless is flagged with its fix, and a schedule whose probe passed gets
    `verifiedAt`. Creating the schedule is a second yes;
  - `manager.schedule` is `{kind: 'desktop-task' | 'cron', when, taskId?, verifiedAt?}`, and
    `budgetUsd` is the user's call, proposed and said so.
- **Headless briefings carry the launch prompts.** A run that can't ask (no AskUserQuestion, a
  `-p` run, a scheduled prompt) skips the checkboxes and runs `brief --headless`: the briefing ends
  with **Launch prompts**, `launch-plan`'s prompt for every issue in Hand to AI, one per project,
  each in a fence nothing in it can close, ids, routes and repo paths only. The opt-in shared post
  still goes out (the user's standing ask); its write needs its own allow rule, else the share is
  recorded as failed. `--headless` checks the
  repos, as `launch-plan` does; without it there is no such section.
- **"Stale" reads the schedule better** (ODY-873's review): a cron restricted to some days of the
  week other than `1-5`, or to a day of the month, reads as a week, not 24 h; "weekdays" and a
  `1-5` cron skip the weekend, so Friday's briefing is fresh until Monday's run (cron's day names
  read as its numbers, `mon-fri` as `1-5`, and a day of the month of `1-31` is every day); and a 15 minute
  grace comes before "stale" (a desktop task starts a few minutes late). Whole days are added on
  the calendar, so a DST change keeps the run's hour. Checks: `scripts/manager.test.mjs` (426 in
  all, with the shared post), and the evals `setup-12` (a desktop task proposed, nothing created before a yes) and
  `setup-13` (a crontab line, no `--bare`).
- **A visual briefing page.** Every briefing run, scheduled ones too, writes
  `.grimoire/manager/briefing.html` (`manager.mjs render --html` writes it again, `--out` elsewhere),
  and the skill prints its path to open (`open` on macOS, `xdg-open` elsewhere). One self-contained
  file, as the run log's: inline CSS and JS, a CSP with no network, light and dark; the view is
  embedded as JSON that ticket text can't break out of, every node is built with `textContent`, and
  only http(s) urls become links. It shows the groups in the Markdown's order, the counts, Not
  checked, the badges, filters (urgent, ready for AI, PRs, runs), checkboxes on the ready issues with
  **Select all ready**, a disabled row with its fix for an issue held back by its repo, and **Copy
  launch prompt** per project: the page runs launch-plan's own planner (`planLaunch`), so the copied
  prompt is launch-plan's text, ids, routes and repo paths only, with a box to copy from when the
  clipboard is unavailable. `manager.mjs view --json` prints the view model the Markdown and the page
  both render from, now with each issue's launch pick, `heldBack`, and the launch plan for every
  ready issue (`launch.allReady`), which a headless briefing's **Launch prompts** now print: one
  source for the page's prompts and the scheduled briefing's. Checks: `scripts/manager.test.mjs`
  (463 in all with the shared post's and the schedule's, the page run under a minimal DOM).
- **The briefing as a panel in the desktop app, with Launch.** When ToolSearch finds a widget
  tool that renders HTML in the conversation (the desktop app's `show_widget`), the skill runs
  `manager.mjs render --widget` and passes its output to the tool verbatim: the model writes no
  HTML around ticket text. The fragment shows the counts, the groups with their urgent, new and
  changed badges (Decide and Do capped, Waiting on others and Not now as counts), a checkbox on
  each ready issue with **All ready**, a disabled row with its fix for an issue held back by its
  repo, and **Launch**, which sends `/grimoire:manager launch <ids…>` into the session: plain ids
  taken from the panel's data and checked again, never a title. It is built like the page (data
  escaped against `</script>`, `<!--` and U+2028/2029, `textContent` only, http(s) links only),
  styled with the host's CSS variables, and stays compact (13 KB for a 200-item briefing). Without
  a widget tool, the AskUserQuestion checkboxes and the page's path stay.
  - **`brief` writes `latest.json`**, the view itself. `render --widget` reads it (its badges are
    the briefing's), or builds a fresh view from `--items` and brief's other flags.
  - **`manager.mjs launch-check <ids…>`** checks a launch message's ids against `latest.json` and a
    fresh repos check, then prints `launch-plan`'s plan. It refuses, with the reason, an id that is
    not plain, not in the latest briefing, not under Hand to AI there, or whose repo became
    unavailable since (with the fix), and every id of a briefing stale by the headline's rule
    (`staleAt`). A held-back issue carries its launch pick now, so it launches once its repo is
    fixed.
  - **The page's CSP** allows its one script by the `sha256` of its exact body, no longer
    `script-src 'unsafe-inline'`.
  - Checks: `scripts/manager.test.mjs` (507 in all, the panel run under the minimal DOM with a stub
    `sendPrompt`), and the evals `manager-9` to `manager-11`. The panel shows in a session only:
    a headless briefing keeps its **Launch prompts**.

### Architecture diagrams the code backs, and the docs as a vault

Two things the graph page could not show: what the system *is*, and what the team wrote about it.
Taking [archify](https://github.com/tt-a1i/archify) as the example but building grimoire's own (no
dependency, free to evolve), an architecture is now a typed diagram drawn as an interactive page,
one the code graph checks; and the project's Markdown notes open in the
page as an Obsidian-like vault, editable when the page is served
(`tools/graph/tests/arch-docs.test.mjs`, no parser runtime needed).

**Architecture (`/grimoire:architecture`, `lib/arch.mjs`, the Architecture tab)**
- A diagram is `docs/architecture/<name>.architecture.json`: typed components (frontend, backend,
  worker, database, messagebus, cloud, security, external, library, cli) with the `paths` of their
  code, the `imports` that reach them and `path:line` sources; boundaries; connections with a label,
  a variant and `via` for what the code graph cannot see; cards. `graph.architectureDir` moves it.
- `graph.mjs architecture draft` drafts one deterministically: one component per module of the
  system map, typed by folder names and the frameworks it imports; the external services its
  imports name (PostgreSQL, Redis, Kafka, AWS, Stripe, an LLM API… 23 known); a line per module
  link resolved by syntax. It never overwrites a refined diagram without `--force`.
- `graph.mjs architecture check` checks one against the index: the schema, every glob matching
  indexed production files, every source existing with its lines, each line between code
  components counted in file pairs (or importing files), lines the code shows only the other way,
  code links no line draws, files in two components, and the share of production files covered.
- The skill drafts, has the agent refine the draft by reading the code (names by responsibility,
  datastores and queues from config, trust boundaries, what flows on each line, sources), and
  checks until it passes, answering each warning.
- The tab draws every saved diagram and one drafted on each render, laid out by flow (boundaries
  as bands, free components beside their neighbours), at natural size with Fit, zoom and drag to
  pan. A line the graph confirms is solid; one it cannot see is dashed amber unless it names its
  `via`. A component's passport lists the code it covers, its sources and each line with what the
  graph saw; Upstream, Downstream and Route light up what the drawn lines reach (reachability, not
  runtime impact); *Code links not drawn* shows what the diagram leaves out.
- `docs/architecture/grimoire.architecture.json` is grimoire's own: 19 components, every
  production file covered, all 13 lines between code components confirmed by the graph.

**Docs (the Docs tab, `lib/docs.mjs`, `lib/md.mjs`)**
- Every `.md` and `.markdown` note of the project's repositories, and of the project root in a
  hub, in a folder tree; the header search filters by path and text, with the matching line.
- A Markdown renderer with no dependency, shared by the page and the tests: headings with
  GitHub's anchors, lists and task lists, GFM tables, fenced code, callouts (foldable), front
  matter as properties, `[[wikilinks|alias]]`, `#tags`, `==highlights==`. Raw HTML passes only as
  allowlisted tags rebuilt without attributes; links go out only to http(s) and mailto.
- Beside each note: its outline, its backlinks with the line that links, the indexed files it
  names (inline code such as `lib/render.mjs:42` opens that file's neighbourhood), and its
  unresolved links. A file's page lists the notes that mention it.

**Editing (`graph.mjs serve`, `lib/serve.mjs`)**
- The same page on `127.0.0.1`, re-rendered on every load, whose Docs tab can save: Read, Edit
  or Split views, Ctrl/⌘-E to switch, Ctrl/⌘-S to save, + New note, and an unresolved
  `[[link]]` offers to create its note.
- Local only, behind a random token: the host must be the loopback address (no DNS rebinding),
  writes must be same-origin JSON carrying the token, and only Markdown notes inside the
  project's repositories are written (no `..`, absolute path, skipped folder or symlink out),
  atomically. A save from a copy that changed on disk since is refused with the disk text, and the
  page offers to load it or overwrite; a served page reloads a note changed on disk when it gets
  focus back.
- Symlinks follow one rule, listing and saving alike: a note whose real file is outside its
  repository, or is not itself a Markdown note outside skipped and excluded folders, is never read
  into the page nor written, and a note symlinked to another note is saved through to its real
  file, so the link stays. Read-only notes
  are refused, a CRLF note is saved back with CRLF, and Markdown renders in linear time on any
  input (a note past 200 KB shows as plain text). One malformed diagram is reported in its place
  and never takes the page down.

### The run scorecard, and a journal that arrives whole

The log page could replay one run's decisions, but not say whether the runs deliver. Reading the
journals of seven real runs also showed that two drained runs were displayed as `running`, and that
three had lost a whole chunk of events (the first one, in two of them) without the page noticing. The page now reports both, and the
loop's writer no longer loses them (`workflows/tests/run-durability-journal.test.mjs`, the writer's
scripts run for real in bash, zsh and dash).

**Logs (`scripts/render-logs.mjs`)**
- **A scorecard opens the page**, over the runs the version, briefs and new project filters keep.
  It shows:
  - runs by outcome (drained, halted, running, stale) and the run success rate (drained over finished)
  - the task landing rate (landed over settled), first-round review pass, PRs opened
  - halts by kind, with how many a resume carried to a drain
  - median active time per run and median output tokens per landed task
  - implementers past their soft limit
  - per-persona FAIL and overturn rates, gates per repository
  - the journal's own completeness

  One row per run links to its overview. `summary` prints the same numbers first; `summary --json`
  adds `scorecard` and one `outcomes` row per run. Both use one function, so the CLI and the page
  never disagree.
- **A run whose final run.json write was lost no longer reads as `running`.** When the newest
  session wrote a `run.end`, its status wins over a `running` run.json, or one an earlier session
  wrote, and the overview says where the status came from. A run still `running` with no journal write for 12 h is marked stale.
- **A lost chunk is counted.** These are shown as an incomplete journal, so numbers that undercount
  say so:
  - gaps in `seq` within a session, and before the first session's first event
  - the writer's unfinished temp files (`<file>.<pid>`, `.chunk.<pid>`, `.runjson.<pid>`,
    `.landed.<pid>`, with `.b64`, `.s` or `.d`)
- **A halt the run resumed from is not its verdict.** The overview shows it as "halted in session N,
  then resumed" instead of in red on a drained run.

**Journal (`workflows/orchestrate-loop.js`)**

The haiku writer retypes every payload as base64, and the chunks that did not arrive were among
the biggest (12 to 24 events). One writer's leftover temp file decoded to a first chunk copied
wrong and cut short, and the engine counted an unconfirmed chunk and dropped it.
- **The first flush goes before the first dispatch.** It carries `run.start`, the startup checks and
  what was absorbed. The run is on disk from its start, and its first chunk is small. It used to wait
  for the first landing, hours in, with as many as 24 events by then.
- **A chunk also goes once the buffered events hold `flushBytes` bytes of JSON.** The default is
  3000; set it in `telemetry.flushBytes`. `flushEvery` still applies.
- **A chunk the writer did not confirm is sent again once,** in two pieces that carry its events
  only, with no run.json and no landed delta:
  - Each piece goes to `<firstSeq>.r1.jsonl`, never over a chunk on disk.
  - A piece still unconfirmed is lost, and counted.
  - A resend that writes nothing turns resends off for the run.
  - `telemetry.journal.resent` counts the chunks sent again.
- **The final run.json is sent again alone, up to twice, when it was not confirmed.** Nothing after
  the run's end rewrites it. `telemetry.journal.runJsonResent` counts these resends.
- **A flush's landed delta is capped at 4,000 bytes as well as 8 tasks;** one task always goes.
- A writer returning nothing still marks the writer dead after two in a row, resends included, and
  nothing is resent once it is dead.
- **The writer is a file now, not text the haiku retypes.** `workflows/scripts/journal-writer.sh`
  holds the lock, the attempt registry, the decoding and the checks, and ships with the engine
  copy, next to the briefs. It is the engine's `JOURNAL_WRITER` byte for byte:
  `npm run journal:writer` writes it, and a test and `npm run check` compare it.
  - A flush now retypes under 1 kB of shell besides its payloads, against about 5 kB before.
  - Each flush checks the file's cksum before it sources it. A missing or altered file prints
    `WRITER missing` and writes nothing; that flush and every later one then carry the writer
    inline. `telemetry.journal.inlineWriter` says so.
  - `scriptsDir` overrides where the file is; the default is next to `briefsDir`.
- Each event is serialized once: the byte count and the chunk share its line.

**Loop (`workflows/orchestrate-loop.js`)**

The ship lock no longer lets two ships in at once. Two waiters on a dead ship's lock could both
remove it, the slower one after a third waiter had taken it fresh, and two ships then held the lock
(`workflows/tests/run-durability-final.test.mjs` F-6 replays each case on a simulated clock in bash,
zsh and dash; F-3 still runs six real waiters). Four bugs, all fixed:
- **A breaker's mutex could be broken too soon.** A takeover runs under a second `mkdir` mutex,
  `<lock>.brk`. A waiter read the mutex's time stamp before its breaker had written it, took it
  for 0 s old (so stale), and removed it while its breaker was still inside. The mutex now holds
  its breaker's pid, as the journal's lock does: it is broken once that pid is gone, or, with no
  pid in it, once 5 s old by its own age. The owner line is read again under the mutex and
  compared whole before the lock is removed.
- **A lock with no owner line was judged by the waiter's age.** One that had waited 10 s took over
  a lock made a moment ago, before its taker wrote its owner line. Such a lock is now taken over
  once 10 s old by its own age (its mtime, against a stamp the waiter makes beside it).
- **A holder ignored a failed owner write.** It held the lock with no owner line in it, open to
  takeover. Now it removes the lock and fails with `LOCK error`.
- **The gate's release removed whatever lock was there.** The gate releases "the moment it stops",
  so one whose take came back `LOCK busy` removed the live ship's lock it had waited for. Its take
  and release are different shells, so the engine now gives each gate dispatch a holder id,
  written where a ship writes its pid. The release removes the lock only while the owner line
  still names that id as `gate`; otherwise it prints `LOCK kept` and leaves it. A ship or the seal
  already removed the lock only while it named its own pid, and now says `LOCK kept` too when it
  was taken over meanwhile.

Three liveness fixes:
- After a takeover, `mkdir` is tried again at once, before the wait's budget is checked: a waiter
  used to report `LOCK busy` just after clearing a stale lock.
- A busy mutex is waited for with a backoff (0.1 s doubling to 1 s). Five instant tries used to
  give up in about 0.1 s with `LOCK error`.
- A lock released between a failed `mkdir` and the check that it exists is tried again; it used
  to read as `cannot create (not writable?)`.

Every change of hands now happens under one mutex, as in the journal's lock: take, takeover,
release, and the gate heartbeat's rewrite all run under `<lock>.brk`
(F-6 replays each window below, red first). The fixes:
- **A release could race a takeover.** The gate's release, finding no lock, still ran `rm`, so a
  ship that took the lock in between lost it. A ship's release could remove a lock taken over
  after it read its owner line. A release now reads and compares the owner line in the mutex, and
  removes nothing when there is no lock. A takeover takes the lock in the same section, so no one
  sees the gap.
- **The heartbeat could overwrite a new holder.** It read the owner line, then wrote the gate's
  over a halt ship or seal that had taken the lock over. It now renews the line in the mutex, only
  while the line names this gate (its id survives), and otherwise stops with a `LOCK kept` line.
- **A mutex could stick forever.** If its holder was SIGKILLed inside and its pid then reused,
  every ship and gate reported `LOCK busy`. A mutex unchanged for 30 s is now broken, even when its
  pid looks alive. That is thousands of times the section it guards, and under the gate's 90-s wait.
- **A breaker acted on a mutex that was not its own.** Its pid write was unchecked, and nothing
  re-read the pid before the `rm`. The pid is now written and read back before anything is done,
  and read again right before the lock is removed or rewritten. A holder that finds another's pid
  there backs off and touches nothing.
- **Stamps were left behind.** A waiter killed with SIGKILL left its `<lock>.<pid>.l` or `.b` in
  the git dir. A take now removes the stamps whose pid is gone, never a live waiter's.

The gate's release is a script now (a code block in the gate prompt, no longer an inline
command), and the ship brief says what a `LOCK kept` line means: another holder has the lock, and
the ship leaves it alone. The messages and exit codes are unchanged.

**The ship lock is a file now, not text the agents retype.** `workflows/scripts/ship-lock.sh`
holds the lock's functions (the mutex, the take, the release, the gate's heartbeat, the ship's
unlock) and ships with the engine copy, next to the briefs. It is the engine's `SHIP_LOCK` byte
for byte: `npm run ship:lock` writes it, and a test and `npm run check` compare it.
- The gate's prompt is back to about 7 kB, from 18 kB: its take, release and push carry about
  2.5 kB of shell between them, against 13.4 kB. A ship retypes about 9 kB of its script, against
  15.7 kB, and the seal 4 kB, against 10.6 kB.
- Each lock script checks the file's cksum before it sources it, so the functions run in the
  script's own shell as before. The windows the one mutex closed stay closed, and the `LOCK`
  messages and exit codes are unchanged.
- A missing or altered file prints `LOCK missing` and moves nothing (`lockMissing` in a ship's or
  the seal's receipt, `failedStep: 'lock'` from the gate). That dispatch is sent again, and every
  later lock script carries the functions inline; `telemetry.inlineShipLock` says so. A gate sent
  again runs its gate command once more.
- `scriptsDir` locates it, as it does the journal writer's.

**Tests (`scripts/run-tests.mjs`, the loop-durability files)**

The suite took about 9½ minutes, one file after another, and six loop-durability files spent
most of that waiting, not computing.
- **The files run in parallel** (the CPU count by default; `--jobs N` or `GRIMOIRE_TEST_JOBS`),
  slowest first. The lock and concurrency trials, and the graph's millisecond-bounded rendering
  check, run alone afterwards, so a busy machine cannot make them flaky. Each file's output is
  printed whole when it ends, and every failure is listed at the end, not only the first.
- **`npm run test:fast`** leaves out the six slow loop-durability files: the other 22 files in
  about 25 s, for iterating. `npm test` and CI still run everything.
- **The six slow files wait less and assert the same.** Their shells (bash, zsh, dash) now run
  side by side on sandboxes of their own, setups are copied from one template instead of rebuilt,
  fixed sleeps became waits for the condition the test then checks, and timeouts sit at the
  smallest value that still proves the behaviour. No assertion was removed or loosened; mutated
  copies (a slow heartbeat, a long lock wait, a late deadline) still fail.
  - `hardening` 105 → 28 s, `followups` 105 → 41 s, `delivery-fix` 85 → 43 s, `final` 72 → 12 s,
    `statewrite` 58 → 18 s, `resume` 46 → 11 s, each run alone.
- **`run-durability-final`'s lock trial was flaky for a reason:** it catches a real race in the
  ship lock, where two breakers can both take a stale lock and two ships end up inside at once.
  The engine fix is its own change.
- **The ship lock's fallback is tested too.** F-6 runs every case through `ship-lock.sh` and
  through the inline fallback, in each shell. It starts first and runs while F-1 … F-5 wait on
  real locks, so `run-durability-final` takes about 14 s instead of 20.
  `GRIMOIRE_TEST_SHIP_LOCK=inline` runs any loop test file against the fallback, and
  `run-durability-shiplock` covers the file's drift check, a missing file, an altered one, and a
  gate and a seal sent again.
- **Its size bounds no longer depend on the machine.** The scripts SL-2 measures name the sandbox
  and the checkout's scripts directory by absolute path, so a Mac's long `TMPDIR`
  (`/var/folders/…/T/`) and a deep worktree failed it (2,642 bytes against 2,600) where CI passed.
  Each script is now measured besides those paths, against the earlier bound less the paths it
  held on CI, rounded down: the gate's three lock scripts under 2,300 bytes (1,981 today), its
  prompt under 7,700, the ship script under 9,350 and 6,100 fewer than inline, the seal under
  4,400. A 351-byte addition to the lock scripts, which the old bound let through on CI, fails it.

### Upgrading from 0.11.0
Nothing to change in `grimoire.config.json`: every new key is optional, and the loop reads none of
the `manager` block.
- Update the installed plugin (`/plugin update grimoire@grimoire`) and restart Claude Code. The
  engine copy (`.grimoire/engine-0.12.0/`) now holds `scripts/`, the journal writer and the ship
  lock, beside the briefs.
- Re-run `/grimoire:setup` to opt into the briefing. It shows one diff (the `manager` block, a
  `repos[].remote` per nested clone, the `gh` permission rules) and writes only what you
  approve; `.claude/settings.json` you apply yourself, with the command it prints. Once a
  schedule is set, re-run it after every `/plugin update`: the headless allow rules name the
  version-pinned plugin root.
- The guard now sees MCP calls. The plugin's scouts and `reviewer` are refused an MCP write and
  report it in their result for the main session to apply; the project's own agents, named in
  `repos` or `specialists`, are never blocked.
- `tracker-scout` inherits the session's tools, the claude.ai connectors included, minus Write,
  Edit, MultiEdit and NotebookEdit.
- A new `SessionStart` hook prints the briefing's headline. It prints nothing until the first
  `/grimoire:manager` run.
- `/grimoire:logs` reads 0.11.0 journals as they are: a chunk they lost is now counted, and a
  drained run whose last run.json write was lost no longer reads as `running`.

## 0.11.0 — trust and see

The code graph's first release on its roadmap: make the links worth trusting, then draw them so a
project of thousands of files still reads. Measured on a four-repository project (2,432 files):
before, 30.6% of call links were name guesses and the map was one spiral of 1,500 dots.

**Links worth trusting**
- On a receiver whose type the syntax does not state, a standard-library method name (`len`,
  `get`, `has`, `update`…, listed per language in `COMMON_METHODS`) is no longer linked by name to
  the one method the repository happens to define with that name. One `len` had collected 305
  false callers that way; it now has 2. `self.len()`, `Type::len(x)`, a typed receiver and
  `super().update()` still resolve.
- A method on a chain that starts in a dependency is the dependency's: a call chain whose path
  before its first call starts at a type the repository does not define
  (`UpdateItemOutput::builder().build()`, `new Intl.NumberFormat(..).format()`), or a Rust path
  rooted at a crate the repository does not have (`chrono::Utc::now()`, `std::env::var`). A type,
  namespace or module the index knows anywhere on that path, or a call heading it to the
  repository's own constructor or factory (`Order().total()`, `NewBuilder().Build()`), keeps the
  chain in the repository;
  SCREAMING_CASE heads are constants; a Rust crate counts as the repository's by its folder, an
  inline `mod` or its Cargo.toml package name; a turbofish or a call argument is not a path.
- A standard-library name on a receiver the syntax constructs from a repository type
  (`Store::new().len()`, `new Store().get()`, `Reg.getInstance().add()`, `Store.shared`) is that
  type's; `self.__class__` and `type(self)` count as `self`.
- Result on that project: call links 21,710 → 19,286, name guesses 30.6% → 22.7%. Some 170
  `import` and `same-file` links went too: the same `len`/`get` calls, matched within a file.
- Storybook stories, `mocks/`, `__mocks__/`, `fixtures/` and `__fixtures__/` count as test code
  (172 files there), so they no longer rank as the most connected production code.
- `.tf`, `.tfvars` and `.hcl` files are indexed by name (an infrastructure repository showed 0 of
  193 files); the infrastructure tools' cache folders and lock files never are.
- `graph_status` reports per repository how many call links are name guesses (`unique-name` and
  `ambiguous`; the README defines the term).
- Schema 3: an index built by an older version rebuilds once, on the next query or write, so it
  takes the new rules at once. It adds `churn`: how many of the last 400 non-merge commits touched
  each file, commits touching more than 25 indexed files left out. A repository dropped from the configuration
  drops its churn too.

**A page that groups before it draws**
- Map opens on a system map: one lane per repository drawing its 14 largest modules (folders of
  production code; a folder holding more than 35% of its repository splits into its
  subfolders, `lib/modules.mjs`), in the order code flows, each line a module using another, its
  width the file pairs linked by syntax. Modules in a cycle share a rank; links across repositories
  are drawn but rank nothing. It never shows test code or name guesses. Hover for links and
  counts; click a module for its files on the file map, fitted to it. That project reads as 52
  drawn modules of 83 instead of 1,500 dots.
- A symbol or a file opens beside the list as a neighbourhood: what uses it on the left, what it
  uses on the right; resolved links solid and first, unique-name dashed, ambiguous hidden; every
  hidden count said; the full lists one click away. A file link is as sure as its surest edge.
- Test code and ambiguous links stay hidden until their toggle is on, in the lists, the
  neighbourhoods and the file map, whose cap goes to production code first and whose ranking no
  name guess decides.
- Hotspots rank by links resolved by syntax, name guesses counted apart, and open on a treemap
  of the 400 largest files by size and churn, its legend giving each colour's real range.
- File labels carry their folder; tables wrap paths and keep their counts visible; views have
  plain anchors (`#sym-12`, `#file-3`, `#mod-4`, `#hotspots`). They hold for the index the page was
  rendered from: a re-parsed file gets new ids, and module numbers shift as modules change.
- Keyboard: every list row and link is a real link (`#sym-`, `#file-`, `#mod-`), drawn modules,
  neighbourhood items and treemap tiles are buttons (Enter or Space), focus moves to what opened,
  the header keeps focus across re-renders and the search keeps its caret.
- The CSP admits only the page's own script, by its SHA-256, instead of any inline script: a name
  that slipped past escaping could no longer run code. One did during this work (an `esc()` whose
  last two replacements a trailing comment had swallowed); a test now pins `esc()` itself.
- A generated 10,000-file index renders in about a second into a 3.3 MB page.

**Checks**
- `tools/graph/tests/graph.test.mjs`: 164 checks (84 before): false links and their legitimate
  look-alikes in Rust, TypeScript and Python; file classes; churn (and a sweep that counts for
  none); schema migration on a query; modules, ranks and cross-repository links; the fixture's
  exact system map; the page helpers (escaping, anchors, link sureness, churn bands, treemap,
  lane cap, defaults); the file map's ambiguous-only flag; the CSP hash; and the page's own script
  run against a stub DOM: every view renders, anchors open what they name, the test toggle changes
  what a neighbourhood hides. Each rule that keeps a chain in the repository has its own fixture,
  checked by mutation.
- Three independent reviews (engine, page, tests and docs) found one blocker, six majors and a
  dozen minors; a re-review of the fixes found one regression (a chain headed by the repository's
  own constructor was dropped) and a wrong claim about anchors. A third round on the whole release
  found constructed receivers losing standard-library names, list rows a keyboard could not reach, a
  search caret that jumped, per-repository co-change lost behind a global limit, and tests that a
  regression could pass. All are fixed in this release.
- New eval case `graph` #5.

## 0.10.0 — trust the learning

Three changes that turn promises the harness already made into checks, drawn from a comparison
with Anthropic's [AI-native SDLC playbook](https://claude.com/blog/the-ai-native-sdlc-playbook):
every gate trusts the tests, so a fix may not weaken them; what CI checks should fail before a
push, not after it, without any key; and the agent that wrote a lesson may not approve it.

**A fix must not weaken a test**
- Loosening the test that exposed a finding is the cheapest way to make the finding go away, and
  nothing caught it: the precheck only checks that tests moved with behaviour, and the
  whole-task diff a re-review reads shows a test the task added and a fix then weakened as one
  weak test, added. Every fix a review sends back (spec, quality and the terminal sweep) now gets
  a fact sheet built from the fix's own diff by one fixed command (no model, no per-repo
  configuration): the test files that existed before the fix and that it deleted, the assertions
  it removed from them, the skips or focus markers it added. The terminal sweep has no task
  range, so its fix range comes from the fix's own report, and its guard now reads the fix diff
  too instead of having to find the commits.
- The guard reads it and sends an unjustified weakening to the panel with a reason starting
  `test weakened:`. In a re-review round exactly one reviewer gets it (break-it, else the spec
  hawk, else the first lens), with the findings the fix answered, and raises it as a blocker
  unless one of them asked for that test change (`briefs/guard.md`, `briefs/review.md`). The
  verifier of that round is handed the fix diff too, since the whole range cannot show a removed
  line (`briefs/verify.md`). The interactive `review` skill applies the same rule.
- A removed assertion is cited by its line before the fix. Deletions of empty or binary test
  files are listed, renames are followed (a test moved and loosened shows under its new path),
  docs are never tests, and the sheet stops at 60 lines of 240 characters with a count of the rest.
- Tested for real against a temp git repo in bash, zsh and dash: a removed `expect()`, an added
  `it.skip`, an emptied Go `t.Errorf`, a deleted `test_*.py`, a Rust `#[ignore]`, a JUnit
  `@Disabled`, an NUnit `[Ignore]`, a Cypress `should()`, a `tests.py`, a path with a space, a
  renamed and loosened test; not code outside test paths, not docs, not tests the fix added;
  `(none)` for a clean fix and a plain failure line when git cannot read the range. The engine
  side covers the guard, one judge per re-review round (also on its retry), the verifier, and a
  second fix round reading the second fix (`workflows/tests/fix-test-integrity.test.mjs`).

**A pre-push check, no key**
- `.githooks/pre-push` (`npm run hooks` once per clone) runs the fast checks CI runs, the drift
  check and the generated `evals/` in sync with `skills/*/evals/evals.json`, on exactly the
  commit being pushed (a temporary worktree, so uncommitted edits never skew it), and blocks the
  push when one fails. No model, no API key, no sign-in; about a second per pushed commit. The
  full test suite (minutes) stays in CI. It never wedges a push on its own problems (no node, a
  commit it cannot check out), and `git push --no-verify` skips it (`scripts/pre-push.test.mjs`,
  through a real `git push`).
- Running the eval cases stays manual and paid: `claude plugin eval .`, which needs the
  command-line `claude` signed in. Nothing in grimoire needs an API key.
- New cases: `review` #5 (a fix that loosens an assertion and skips a test is not passed) and
  `crystallize` #5 (a clean crystallize PR is still not merged by its author).

**The re-flag count crystallize reads**
- `render-logs.mjs summary` counted any guard PASS in a repo whose terminal slot did not end
  PASS as "re-flagged by the terminal sweep". So a sweep that died, or whose reviewers were
  unavailable, counted as a re-flag, and a repair task that landed after the re-flag counted
  too. Meanwhile the real case was missed: a sweep that raised a blocker, fixed it and passed.
  Its reviews belong to `<repo>:final`, which mapped to no repo.
- It now counts per-task guard PASSes (the sweep's own guard can't re-flag itself) whose repo
  the sweep re-flagged after the pass. A re-flag is a blocking terminal review, even one a fix
  then cleared, or a FAIL verdict. The match is still per repo, not per finding, so read the
  number as an upper bound. On the new test's run it reads 1 of 4, where the old count read
  3 of 5 (`scripts/render-logs.test.mjs` §6). The figure `crystallize` uses to decide whether
  to tighten the guard brief no longer rests on harness failures.

**`crystallize` is not loaded before the PR exists**
- A pre-PR request ("capture the learnings now, before the PR") loaded the skill just to
  decline. Its description said "Never mid-implementation", but that wasn't enough for the
  model to skip loading it, so eval case `crystallize-2`, which expects the skill not to fire,
  failed. The description now says such a request is answered without the skill, by saying
  the PR and its review threads come first.
- In-session runs, judged by whether each transcript opened the skill: the negative case
  loaded it in 0 of 3 runs with the new description, against 2 of 3 with the old; the four
  positive cases still loaded it, 4 of 4. Every run still declined correctly and wrote nothing.

**A human merges every crystallize PR**
- The `crystallize` skill let the orchestrator merge a "clean" crystallize PR once a few had
  come back clean; its loop brief said never merge, and the engine never did. They now agree: a
  human merges, because the agent that wrote a lesson must not approve it. The clean checklist
  stays, as what the PR body reports so the merge is quick, and "evals green" says how they
  were run.

## 0.9.1 — the 0.9.0 follow-ups

The minor findings recorded from the last review rounds of 0.9.0 (issue #14). None blocked a run
in the common case; each is fixed and tested for real in bash, zsh and dash
(`workflows/tests/run-durability-followups.test.mjs`), and the whole suite now passes on Linux
too, where only the journal script had run before.

**Delivery and ship**
- **An unreadable PR is UNKNOWN, never a draft.** When `gh pr view` (or `gh pr list`) failed
  (a 502, a timeout), the ship script treated the PR as a draft and pushed to it and rewrote its
  description, though it may have been ready. It now prints `UNKNOWN`: nothing is pushed,
  rewritten or claimed (a halt posts no status comment there), the next ship retries, and the
  `ship` event says `skipped: 'unknown'`.
- **The integrate step's `headSha` is required with MERGED**, and one that leaves it out is asked
  once more, read-only, inside the repo's merge queue: the run branch's head, accepted only when
  it holds the reviewed lane tip. A landing without it was never shipped.
- **Nothing is dispatched once the workflow has returned.** A wedged gate's seal or a late halt
  ship could be dispatched after the body returned, and the runtime does not say what becomes of
  such a call: it is now skipped and logged, and a relaunch resumes from the PR and `run.json`.
- **Bounded steps under the lock.** The repo's `laneSetup` in the ship worktree runs under the
  script's time limits (at most 180 s), and the gate pushes through a script that renews its
  lock's age every 60 s while the push runs: a pre-push hook longer than 20 minutes no longer
  loses the lock to a ship.
- **Free text never closes an issue.** A closing keyword before an issue reference in a title,
  an implementer's summary or a halt reason ("… Closes #99") gets a zero-width space: the PR
  body closes only the issues the engine names.
- **The run branch key.** `SOC-2 …`, `GPT-4 …`, `COVID-19 …`, `AES-256 …`, `Q3-2026 …` (standards,
  models, periods, versions) no longer key a project; "Auth rewrite — PROJ-700" keys as
  `PROJ-700`; a GitHub project URL keys with its owner (`acme/projects/7`). A verified marker
  written for another wording of the same key is logged with that text. A run started before
  0.9.1 whose key changes (one of those texts, or a project URL) builds on a new run branch: pass
  `runBranch` with the old name to keep resuming it.

**Resume and state**
- **The reconcile** checks the checkpoint's tasks first (up to 250 per repo, named by
  12-character SHAs), then the marker's, once per task (a single-commit task's two lines never
  deduped), and shares what a repo's even share leaves to the repos that need more: one repo of
  three with 250 landed tasks gets about 215 checked, not 70.
- **The journal mutex** holds its holder's pid and is broken only when that pid is gone (a 5-s
  timer alone broke live ones: 4 of ~100 trials overlapped at 16 writers); the lock's pid is read
  again right before it is broken; `GRIMOIRE_LOCK_STALE` is at least 1; without `date +%s` the
  journal and ship locks count their sleeps (their waits had no end); a clock jump (the machine
  slept) ages no lock; `landed.jsonl`'s path reaches `awk` through the environment.
- **A replan's tasks** are listed in the PR marker (`replan`) and absorbed from it under the
  checkpoint's rules, so another machine no longer redoes them.
- **`trustNewerMarker: true`** takes the higher of each counter from a verified marker newer than
  `resumeState` (this machine's `run.json` behind another machine's run). Off by default: a PR body
  never sets the budgets on its own.
- **Every landed detail reaches `landed.jsonl`:** after the final chunk (8 details at most), one
  more per 8 follows (`landed.flush`) while each is confirmed.

**Not covered here**: a run against real GitHub and the real Claude Code Bash-tool output limit
(both need a real session; see issue #14).

## 0.9.0 — run durability

Fixes found in a real unattended run on 0.8.0: one static-site repo, ten issues in a strict
blocked-by chain, `maxPerRepo` 1. It ran about 29 hours (29.4 h of wall clock over three
attempts, plus about 9 hours waiting on the user), built seven slices and opened no PR. Its
agents' time, which overlaps wherever dispatches ran side by side, went to implementing
(12.7 h), reviewing (8.2 h), hydration (3.6 h), replans (2.2 h), prechecks (2.1 h) and journal
and ledger writes (1.3 h). About 16.6 of the 29 hours were a third-party PreToolUse Bash hook
timing out at 30 s on every call: 0.8.1's session probe (`maxToolLatencySec`) refuses such a
session, but the installed plugin was 0.8.0. About 9–10 hours were wasted on the failures
below. The run halted three times: on the replan budget, on a hydration timeout, and on a
locked 1Password commit signer; the Mac also hibernated on battery mid-run. Nothing reached the
remote until a human pushed it. All fixes are engine-, brief- and skill-level and
stack-agnostic.

- **A timeout makes a dispatch late, not dead** (`agentHardTimeoutMin`, default 180;
  `timeouts`). An agent cannot be cancelled, yet the run booked agents dead at 40 minutes while
  they kept working. In the first attempt a "dead" implementer was re-dispatched into the
  checkout it was still writing (about 4 hours of failures on the first slice); in the second,
  two implementers booked dead ran 78 and 115 minutes in all, committed their slices, and cost
  1.5 hours of replans that sent them back as "verify-only". `agentTimeoutMin` is now a soft
  limit: the dispatch is logged as late, still awaited, and its result accepted. At the hard
  limit a reader is given up on; a writer is marked wedged and fences its repo (nothing else is
  dispatched or requeued into that checkout) until it returns, and when only wedged work is
  left the run halts with `kind: 'wedged'`. A lane whose review passed while its repo was
  fenced settles `FENCED`, its worktree kept for the retry. A hydration that returns nothing is
  retried once and a late one is accepted (a 43-minute hydration halted the second attempt).
  Only quick deaths count toward the circuit breaker. Events `late`, `wedged`, `late-result`,
  `fence`; `telemetry.late` (each outcome `accepted`, `died`, `abandoned`, `wedged` or
  `pending`) and `telemetry.wedged`; `needsAttention` lists a still-running task as
  `STILL_RUNNING`.
- **A draft PR from the first landing, and the run's state in it** (`deliver`, default
  `'incremental'`; `shipOnHalt`; `draftPr`). After each landing, one haiku dispatch
  (`briefs/ship.md`), in its own worktree, pushes the exact landed SHA to the run branch
  (fast-forward, hooks run, never forced) and opens or updates the repo's draft PR with `gh`.
  Its body is the run's proof (each landed task with its title, head SHA and "passed spec and
  quality review", what is still open, and the exact resume instruction) and ends with a hidden
  state marker, `<!-- grimoire:state v1 <base64 JSON> -->`, rewritten on every landing: per
  repo, the run's counters and each landed task as `[id, headSha]` or `[id, headSha,
  firstSha]`, filling at most 8,000 characters of base64 (up to 100 tasks, about 80 when each
  has a first commit of its own: first commits are abbreviated, then landed tasks' fix rounds
  dropped, before the newest tasks are left out), with no titles, learnings or summaries. The
  terminal slot waits for the repo's pending ship, then the gate marks the PR ready and keeps
  the marker. On a halt (also a wedged one: only the last reviewed head is pushed) every repo
  pushes what landed, gets its draft PR if it has none, and gets a status comment: the reason,
  what to fix first, what landed, what is open, any agent still running, how to resume; a repo
  whose terminal slot is still running is left to that slot, and gets its halt ship if that slot
  ends without a green gate. A ship failure never halts or replans: two failed pushes in a row,
  or a pre-push hook that wants the gate, stop that repo's incremental pushes
  (`shipped.<repo>.disabled`), and a failed push asks for an environment check. New result
  fields `draftPrs` and `shipped`, event `ship`; `prs` still lists ready PRs only, one per repo
  (its latest gate).
- **A ready PR is the gate's, and a PR claims only what reached the remote.** A final
  adversarial review of incremental delivery proved, each with a repro, that a land ship pushed
  unswept work onto a PR its terminal slot had marked ready and replaced the gate's description
  with the draft banner (after a replan landed more work there, or on a resume), and that a
  failed push still rewrote the description over heads the remote never got. A PR out of draft
  now belongs to the gate: the engine knows it from the gate, every ship's receipt and the
  reconcile (every open PR, on a fresh start too), and the ship script reads
  `gh pr view --json isDraft,body` before anything moves, so a PR a person marked ready by hand
  is left alone too (`READY`; event `ship` with `skipped: 'ready'`). New work there waits for
  the repo's next terminal slot, whose gate pushes it after the sweep and rewrites the title and
  body over every task; the PR stays ready. A halt on a ready PR posts only its status comment.
  The description is rewritten only once the remote holds the pushed SHA: a failed land push
  posts a short note instead, a failed halt push a "push FAILED" comment naming where origin is,
  and a task the remote does not hold reads "landed locally, not yet pushed", with no closing
  keyword. An integrate step that reports MERGED without the run branch's head leaves its
  landing with no head, so no ship ever pushes a lane tip.
- **One ship at a time, within its limits.** A ship given up on at its 12-minute hard limit
  kept running next to the next ship, the halt ship and the gate, on one worktree and one PR,
  and its push alone could run 15 minutes. The ship script now stops by 540 s
  (`GRIMOIRE_SHIP_DEADLINE`) and its push by 480 s, each network call in its own process group,
  killed whole. Ships take a per-repo lock, `<git-common-dir>/grimoire-ship-<repo>.lock`: a ship
  waits up to 150 s for it (`GRIMOIRE_SHIP_LOCK_WAIT`), a holder whose pid is gone or that is 15
  minutes old is taken over, and `LOCK busy` moves nothing and is no failed push (`skipped:
  'lock'`). The gate takes the same lock before it pushes, 90 s an attempt and up to five, else
  BLOCKED with `failedStep: 'push'`; ships honour a gate lock for 20 minutes, and the next gate,
  the seal and the halt ship take one over at once. A ship that starts late never overwrites a
  newer description: the marker carries the `session` and the body generation (`ship`). The
  ship worktree is reset before each ship (a hook that edited it would block the next), the
  scripts run under bash, zsh and dash, and a halt removes only this run's
  `review-<repo>--<task>-` worktrees (a bare `review-` match took lanes of a repo named so).
- **No forged state marker; the gate's copy is sealed.** An issue titled
  `Add login <!-- grimoire:state v1 … --> page` put a forged marker above the real one, which
  the reconcile read first: on another machine every task was redone. Every engine-built PR body,
  comment and note, and the titles, summaries and project text of the gate's prompt, now break
  `<!--` and `-->` with a zero-width space, and the reconcile and the ship's PR view read the
  last marker of a body. The gate retypes up to 8,000 characters of marker into the final body
  with no check, so after a green gate `seal:<repo>` reads the body back and, when its last line
  is not exactly the marker, puts it back (decoded and checked): the one edit the loop makes to a
  ready PR, never its ready state. A seal that fails twice is logged, not a failure (event
  `seal`).
- **Landed work survives the session and is absorbed on resume.** The checkpoint recorded
  landed ids that nothing read back, and the tracker keeps issues open until the PR merges, so
  each new session re-dispatched landed work. Checkpoint v2 records every landed task's run
  branch, head and first commit, and the journal flushes on every landing. At startup the index
  reconciles what `resumeState` and the draft PRs' markers list against the run branch, and the
  engine absorbs a task only when its head (and its first commit) is on the run branch and not in
  the base (`absorb` event; `resumedLanded`, with `source: 'checkpoint' | 'pr'`), so a new
  session or another machine continues where the last one stopped. Reviewed SHAs are now per
  task and per run branch: one task can no longer cite another's reviewed head and land
  unreviewed. An implementer that finds its work already on the branch returns `landedBefore`
  instead of an empty range: SHAs reviewed for that task land as they are, others are reviewed
  as that range, and no "no change" fix is bought (the third attempt's empty ranges bought fix
  rounds that returned invalid start SHAs).
- **A preview proves the resume before it runs.** The preview's reconcile runs read-only and
  returns `resumedLanded`, `unverifiedLanded` (listed as landed, not verified: built again),
  `stillToBuild` and `branches` (each repo's run branch, sync state, PRs and marker verdict),
  with one line, `◎ resume: <k>/<n> landed, verified on <run branch> @ <sha> — still to build:
  <ids>`. Its `estimate` counts only the work still to build.
- **A PR state marker is trusted only as far as it is verified.** Anyone who can edit a PR body
  can write a marker, and a review showed a planted one could put learnings into prompts, get
  foreign ids or an ancestor head absorbed, and halt a run at start with
  `outputTokensSpent: 5e9`. Now the index agent's copy must match the length and `cksum` the
  script printed; the marker must name the same project (by key, unless the run branch is set
  explicitly), repo and run branch; only PRs from the same repository are read, never a fork's;
  only ids of this project's index are absorbed, and only with heads outside the base; the
  counters are clamped to what the project plausibly reaches (`attempt` at most 1,000, `lastSeq`
  at most 500 per issue plus 5,000: a planted marker once set them to 10,000 and 10⁷); and no
  marker text reaches a prompt (learnings come from the local checkpoint only). The last marker of
  a body is the one read, and one over 8,000 characters is reported by its length
  (`marker=toolong`), never printed: one of 441 KB overflowed the Bash output and cut the lines of
  the repos after it. The `resumeState` passed in goes through the same rules: a hostile one
  absorbed `#1337` (the PR would have closed it) and put an `rm -rf` learning into prompts. Only
  the project's issues are absorbed from it, plus a replan's own task when its record says
  `replan: true`, the checkpoint's `runId` (which it now records) is this launch's and the id
  cannot read as an issue reference; a record's ticket is its id; its counters are clamped like a
  marker's (its output tokens kept up to 10⁹: they are the run's own); its learnings are the last
  30, each up to 300 characters, and a `resumeState` shaped like a marker brings none. When a
  `resumeState` is passed, its counters win over every marker's, newer or not; without one, the
  newest verified marker carries them.
- **The reconcile runs under bash, zsh and dash, within 90 seconds.** The Bash tool runs the
  user's shell, and in zsh `"$3:refs"` is `$3` with the `:r` modifier: on a fresh clone the run
  branch was never fetched and every landed task ran again. The script is POSIX sh with every
  risky parameter braced, checks repos in parallel with a 30-second limit on each fetch and `gh`
  call and one 90-second deadline (sequential limits once took 181 s against the Bash tool's
  120), and prints `fetch=`, `inBase=`, `ahead=` and `WARN` lines the engine logs. It fetches
  the base as well as the run branch, so a branch merged upstream since never reads as unmerged
  work. Its output is capped at 28,000 characters, split evenly per repo: `BRANCH` and `PR` lines
  always print, `TASK` lines (at most 100 from the marker and 100 from the checkpoint per repo)
  stop at the repo's share, and a `WARN` line counts the tasks left unchecked. Without `perl` or
  `timeout`, each fetch and `gh` call runs in the background and is killed at its time limit,
  where a hung fetch used to outlive the script.
- **A run branch the run cannot build on refuses the launch.** For a repo with work left, a
  local run branch that diverged from origin refuses as `run_branch_diverged`; one behind origin
  that could not be fast-forwarded (uncommitted changes, or checked out in another worktree), or
  only on origin and not created, refuses as `run_branch_behind`. `problems` says what to run;
  the run never resets a branch. A failed fetch is a warning, and every sync state is logged:
  a silent `behind` or `missing` had looked like a fresh run.
- **Starting over is explicit** (`freshStart: true`): `resumeState` and every PR marker are
  ignored, nothing is absorbed, the budgets start at zero, and no branch is moved. Since its
  first push could not fast-forward an earlier run's branch, it refuses as `run_branch_exists`
  when origin holds the run branch with commits not in the base: pass a new `runBranch`, or
  remove the old branch and PR. Without it, a relaunch always resumes.
- **Environment checks** (`builtinEnvChecks`, default on; `environmentChecks`). The third
  attempt's implementer found the commit signer locked halfway through a task, and a replan
  spent about eight minutes diagnosing it before halting. Per repo, a signed commit in a scratch
  worktree (added without a checkout: it only proves the signer answers) and an `ls-remote` of
  the origin, plus the project's own checks, each under a portable time limit
  (`perl -e 'alarm …'`: stock macOS has no `timeout`, which the implement brief recommended for
  hang-prone commands such as the first attempt's Playwright WebKit runs). The checks run in
  parallel under one 90-second deadline (`GRIMOIRE_ENV_DEADLINE`), so the report fits in the Bash
  tool's 120-second default whatever hangs; a check still running then reports exit 142, and
  `environmentChecks[].timeoutSec` is capped at 85. At start a failure refuses the run
  (`environment_unavailable`); after a BLOCKED, DIED, ERROR or FENCED task, a late writer, or a
  failed push, a check runs in flight and before the next replan and the final wave. Its failure
  pauses new dispatches and is re-checked once (`env:recheck#n`, only the checks that failed): a
  re-check that passes was transient (`environment.transient`) and the run goes on, since one
  timed-out `ls-remote` is often a blip. Only a failing re-check halts, with
  `kind: 'environment'` and the fix, and no replan is spent; a later green check lifts a halt
  that is still pending. Start checks are not re-checked. On macOS a `power` check warns when
  the machine runs on battery (the Mac hibernated on battery at 1% and the run lost 49 minutes);
  it never refuses. The names `commit:<…>`, `remote:<…>` and `power` are the built-ins': a user
  check named so is refused with a warning. One haiku dispatch (`briefs/env.md`); event `env`
  (with `recheck` and `cleared`); result `environment`.
- **Replans are charged to the code only.** In the first attempt, two of the three replans
  answered agents booked dead at the time limit while they worked, and a browser engine that
  hung on that Mac; the run then halted on its exhausted budget. The replanner now names a
  `cause`: `code` spends a replan, `harness` (a dead or late agent, a lane that would not merge)
  is free up to `maxReplans` times and then charged, and `environment` halts the run with
  `kind: 'environment'` without requeuing anything. Every halt the loop itself causes carries
  `kind: 'harness'` (silent reviewers, hydration dying twice, three quick deaths, the replanner
  dying, a replanner HALT on a harness cause), a token-budget stop carries `kind: 'budget'`, and
  the halt `kind` is in the `halt` event and in `run.json`'s `summary.halt`.
- **A run branch named after the project's key** (`runBranch` overrides it, also per repo). The
  run's project text was a sentence ("acme/site#3 — GitHub parent issue #3; its slices are
  …"), so its branch was that sentence slugged and cut at 60 characters, and a relaunch worded
  differently would have built on another branch and missed its PR and saved state. The branch
  now takes the project's ticket reference, the first rule that matches winning: `owner/repo#N`;
  `#N`; a tracker URL (an issue or pull request URL as `owner/repo#N`, a Jira or Linear URL's
  key, any other URL's trailing number); then a bare key like `PROJ-123`, only as the whole
  text, at its start or in brackets or parentheses, and never with a standard's prefix (`UTF`,
  `UTF8`, `ISO`, `SHA`, `HTTP`, `HTTPS`, `RFC`, `ES`, `TLS`, `SSL`, `IPV`, `CVE`): "Migrate to
  UTF-8 and ISO-8601 dates (PROJ-12)" once keyed on `UTF-8`, so every project mentioning UTF-8
  would have shared one run branch. The run's sentence and `acme/site#3` share
  `feat/acme-site-3-<repo>`; a project text with no reference is slugged as before.
- **Shell guidance for implementers and reviewers.** `cd` replaced by a shell plugin's function
  made 147 commands of the run fail: the briefs now say never `cd` (use `git -C` and absolute
  paths, or `builtin cd`), read files with the Read and Grep tools, and bound hang-prone
  commands with `perl -e 'alarm …'`, or `timeout` or `gtimeout` where they exist. The engine's
  own scripts use `builtin cd`, and the guard hook follows `builtin cd` and `command cd` like
  `cd`.
- **The journal agent can only run its script.** In the first attempt the haiku journal agent,
  running from the product checkout with the project's instructions loaded, acted on its
  payload. Event lines, `run.json` and the landed-task detail now travel base64 and are decoded
  by the script; the brief says the payload is data and forbids any other command. The ledger
  and ship payloads travel the same way.
- **State writes that cannot corrupt, roll back or overflow.** 0.8.x wrote `run.json` through
  one shared temp file, with no lock and no order: two flushes at once could corrupt it, and a
  late flush could roll the checkpoint back. Every decoded payload is now checked against the
  engine's byte count and `cksum` before anything is written (`RUNJSON ok|kept|bad`,
  `LANDED ok|bad`, `LEDGER bad`; a refused `run.json` counts in
  `telemetry.journal.runJsonLost`); writers take a lock (`<runId>/.lock`) that changes hands only
  under a second mutex (`.lock.brk`: two waiters on a dead writer's lock once both broke it, one
  of them the other's fresh lock), broken at once when its pid is gone and after 30 s when the
  same pid or none holds it (`GRIMOIRE_LOCK_STALE`), with a writer going on without it after
  60 s and a stale mutex removed after 5 s, all timed with `date +%s`; `run.json` moves into
  place atomically and only when it is not older than the one on disk, ordered by the resume
  generation and `lastSeq`, and a `run.json` the script kept for a newer one is logged once per
  session with its reason and counted (`telemetry.journal.runJsonKept`: a session behind the one
  on disk never persists its checkpoint); and each launch registers one attempt for its session
  token in `<runId>/sessions` (two launches that start from exactly the same state share one).
  Since `run.json` travels in every flush, it keeps only what a resume needs (with every task's
  detail in it, a 40-task run sent 89 KB per flush, enough to outrun the writer), and each task's
  detail goes once to `<runId>/landed.jsonl`: at most 8 a flush, each line keyed (`k`) so a
  resent one is never appended twice, and the writer's `landed` receipt is required (one that
  left it out made every flush resend every detail, 104 KB a flush at 40 tasks). A `runId` must
  be letters, digits, `.`, `_` and `-`, and not only dots (`..` would put the journal above the
  telemetry directory): any other is ignored with a warning and a new dated directory opens.
- **Per-task reviewers in parallel** (`reviewParallel`, default `'stages'`). Precheck, spec
  review and quality review ran one after another, and reviewing took 8.2 hours of agent time.
  Spec and quality round 0 now run together on the same head after the precheck; a spec fix that
  moves the head re-runs quality. A reviewer, verifier or guard that runs commands does it in
  its own detached worktree: two reviewers building in one checkout emptied each other's build
  output.
- **Hydration ahead** (`hydrateAhead`, default 2). In a chain each hydration (6–43 minutes,
  3.6 hours in all) waited for its blocker to land. The next ready tasks are now hydrated while
  their blockers are in flight, and the implementer is told the code may have moved since.
- **Short limits and a hedge for mechanical dispatches.** Preflight, precheck, journal, ship
  and environment checks shared an implementer's 40-minute limit; a one-word preflight reply
  took 12 minutes, and prechecks took 5–13 minutes for about eight git commands (2.1 hours in
  all). They now have limits of their own (`timeouts`); preflight and precheck start one
  duplicate when the first is slow (`hedge`; `hedgeAfter` applies only to them and to hydration
  without claims); the preflight prompt asks for the reply and nothing else; the precheck runs
  one fact script in a single Bash call.
- **The skill resumes by state and says how long a run takes.** The third attempt was a
  `resumeFromRunId` relaunch with only `agentTimeoutMin` raised, on a stale checkpoint: the
  replay diverged at the first late result and redid three slices, 3.5 hours for two small
  commits. The preview now returns an `estimate` (critical path × minutes per task;
  `estimatePerTaskMin`), about 7–20 hours for that project, and the `orchestrate` skill prints
  it, says a draft PR appears after the first landing, and names the environment checks.
  Before an execute run it tells the user the duration, checks commit signing, push and the
  project's prerequisites, and warns that a message sent to the session while the run goes is
  relayed into its agents' prompts (in the real run a haiku probe then ran the build and the
  gate): instructions go in after the run, or the run is stopped first. Invoked on a project
  that already has a run, it finds the newest local `run.json`, passes its `runId` and a fresh
  `resumeState` to the preview and shows its resume line, then relaunches by state; the engine
  reads the draft PRs' markers itself. Starting from scratch takes an explicit request and
  `freshStart`. `resumeFromRunId` is kept for a byte-identical relaunch, the tracker alone never
  resumes a run, and after a halt the skill reads the PR's status comment first.
- **Late results land where they belong.** An adversarial review raced the engine's
  asynchronous paths against each other. A final wave no longer hangs when one slot wedges and
  another then returns. A wedged terminal slot is booked when it returns, even after the run
  has ended, and its gate is never run twice (a second push, a second PR); ship on halt leaves
  that repo to it. A prefetch that lands after a replan never replaces the task the replan
  revised. A writer that returns after the run stopped dispatching flows no further. A repo with
  a failed task is never gated, its PR never marked ready, while that failure stands; when the
  budget runs out with nothing else left, the halt names each task that did not land and its
  repo. A dead journal writer stops being queued instead of holding the end of the run for
  8 minutes per chunk (its chunks count in `telemetry.journal.lostEvents`). A prefetch's claims
  are handed back when the run halts before it returns.
- **Logs and eval cases.** `/grimoire:logs` summarizes the new events in words (each `absorb`
  source, `harness-routed`, `seal`, a `ship` skipped on a ready PR or a busy lock, which never
  reads as a failed push, and an `env` re-check, transient or failing again, or a halt a later
  check lifted), shows a halt's kind and a v2 checkpoint's landed tasks and heads,
  joins `landed.jsonl`, and counts discarded review rounds apart. `orchestrate` evals: resume by
  state after a halt, a knob change on resume, the preview's estimate, an environment halt, a
  new-session relaunch that finds the run, a message sent during a run, and starting over.

### Upgrading from 0.8.1
Nothing to change in `grimoire.config.json`.
- Update the installed plugin (`/plugin update grimoire@grimoire`) before the next run. The run
  behind this release ran 0.8.0 and so never had 0.8.1's session probe, which would have
  refused the hook that cost it about 16.6 hours.
- Draft PRs now appear after each repo's first landed task, and each landing pushes the run
  branch, which triggers its CI and previews. Set `deliver: 'end'` (run-wide, or per repo) to
  keep pushes for the end; `shipOnHalt: false` also skips the halt push and comment. The draft
  PR and its state marker go through `gh`: without it, pushes go on and the resume relies on the
  local `run.json`. A PR out of draft, marked ready by the gate or by hand, gets no more ships:
  new work in its repo waits for that repo's next terminal slot, whose gate pushes it.
- A run can now refuse to start with `environment_unavailable` when a signed commit or the
  remote does not answer: unlock the signing agent or fix the remote, or pass
  `builtinEnvChecks: false`. It also refuses a run branch it cannot build on:
  `run_branch_diverged` or `run_branch_behind` (fix the branch as `problems` says, then
  relaunch), and, with `freshStart`, `run_branch_exists`.
- The run branch is now named after the project's ticket reference. A run started on
  0.8.x whose project text held more than its key (a sentence) used another branch name: to
  continue it, pass `runBranch` with that name.
- `agentTimeoutMin` is now a soft limit: a late agent is awaited and its result accepted.
  `agentHardTimeoutMin` (180) is where the run stops waiting; `repos[].timeoutMin` still raises
  its repo's writers' limits.
- `maxReplans` now counts only replans whose cause is the code: a harness cause is free up to
  `maxReplans` times, then charged, and an environment cause halts the run instead of
  replanning. `replans` in the result counts the charged ones.
- Checkpoint v2 and the slimmer `run.json` are backward compatible: a 0.8.x `resumeState` still
  resumes its budgets (replans, fix rounds, spend, sequence), but it has no SHAs, so nothing is
  absorbed from it; each landed task runs again, finds its work on the run branch and is
  reviewed as it stands rather than rebuilt.
- Resume with the same `runId` and a fresh `resumeState` (`/grimoire:orchestrate` does it), not
  with `resumeFromRunId` and changed args. To start over on purpose, pass `freshStart: true`. A
  `runId` passed by hand must be letters, digits, `.`, `_` and `-`; any other is ignored and the
  journal opens a new directory.

## 0.8.1 — run efficiency and honest reporting

Fixes found in a real unattended run (six issues, one repo) that took 9 h 10 for about 2 h 45
of work. Its transcripts showed where the time went and its journal showed each defect. All are
engine-, brief- and skill-level and stack-agnostic.

- **Session probe** (`maxToolLatencySec`, default 15). Every Bash call of that run waited 30 s
  on a PreToolUse hook that hung until its timeout: 836 calls, 6.4 h, read by the run as slow
  builds. Execute runs now have the indexer time two back-to-back Bash calls; past the limit
  the run refuses to start as `slow_tool_calls` and names the likely cause; from 8 s it warns.
  The number is in `telemetry.toolLatencySec` and in every replan prompt. The `orchestrate`
  skill also times `git status` before launching.
- **A timed-out agent may still be running.** The backstop books the dispatch as died but
  cannot stop it, and that run's "dead" implementer committed three minutes later. The timeout
  log, the replanner's failure detail and the replan brief now say so and what to check
  (`git log`, `git status`, live processes) before requeuing; the dispatches are listed in
  `telemetry.timedOut`.
- **Learnings are measured.** The replan blamed slow tests and proposed raising
  `repos[].timeoutMin` to 75 — a key that only raises the backstop and was set below it, so it
  had never applied. The replan brief requires durations from measurement; the engine warns
  when a repo's `timeoutMin` is at or under the global backstop; crystallize checks each
  learning against the journal before keeping it.
- **`needsAttention` holds only open work.** A task that died, was requeued and landed was
  still reported there. It is now in `recovered`; `needsAttention` keeps the latest attempt of
  what never landed.
- **An honest note when crystallize does not finish.** The note said "no PR this run, so no
  crystallize" when a PR existed and crystallize had timed out. It now says crystallize did
  not finish and names the PRs to run it over by hand. Crystallize, the longest dispatch of a
  run, gets its own 90-minute allowance.
- **Harness findings stay out of the product PR.** A terminal-sweep blocker on the loop's own
  lane config bought a 37-minute fix round and three harness commits in the product PR. A
  terminal blocker/major on a harness file (`grimoire.config.json`, `.claude/`, `AGENTS.md`,
  memory, runs, `docs/crystallize/`) is now an advisory note tagged `harness`, listed in
  crystallize's header for the harness PR. A per-task review still gates a task's own change
  to such a file.
- **A PR that closes what it ships.** The gate opened a one-line PR that linked no issue. It is
  now handed every landed task (id, title, the implementer's report) and the gate brief sets
  the title and body: one closing keyword per issue, what changed, what the tasks recorded,
  how it was verified, what to check before merging, and no invented links, local paths or
  model co-authors. The gate runs on sonnet instead of opus.
- **Repo-relative paths in what the run publishes.** Reviewers' absolute paths, home directory
  included, went into the committed ledger. The probe reports each checkout's root and
  `$HOME`; the ledger, the gate's task reports and crystallize's header are rewritten
  repo-relative, with `~` for the home directory. Reviewers are asked for repo-relative paths.
- **The ledger branch starts from the default branch**, not from the run's base: cut from an
  unmerged base, the ledger's PR carried that base's commits. The ledger agent must not open a
  PR (it did); crystallize merges the run's unmerged PR heads into its branch before patching
  and says its PR merges after them.
- **Less work that was never used.** Hydration plans from reading and no longer runs builds or
  browsers (one spent twenty minutes probing whether two tasks could share a repo). Spec
  reviewers read instead of re-running the full suite; the quality stage and the gate run it.
- **`laneSetup` docs and setup** no longer suggest a symlinked `node_modules` without checking
  the bundler accepts one (Next.js 16's Turbopack does not); the setup skill proposes
  `timeoutMin` only above the 40-minute backstop.
- **The Reliability lens checks the gate from a fresh clone.** That run's gate type-checked
  before the build that writes the gitignored type declarations, so it passed only in a
  checkout an earlier build had left them in; no reviewer read the gate. The persona's scope
  now includes the gate command and the scripts it calls.
- **Eval cases** from these failures: `orchestrate` does not launch while a trivial command
  waits tens of seconds; `setup` proposes no no-op `timeoutMin` and no symlinked
  `node_modules` for a Next.js 16 app.

### Upgrading from 0.8.0
Nothing to change in `grimoire.config.json`. Drop a `repos[].timeoutMin` at or under 40 (the run
now warns that it has no effect). A session the probe refuses is a session to fix first: time
`git status`, find the slow PreToolUse hook, restart.

## 0.8.0 — loop integrity

Fixes found in a real unattended run whose journal showed each defect. All are engine- and
brief-level and stack-agnostic.

- **Direct tasks work on the run branch.** A task running alone in its repo used the tracker's
  per-issue branch, so it settled DONE without ever reaching the run branch its dependents,
  the sweep and the gate build on. It now always commits on the run branch, and the precheck
  verifies a direct task's head is an ancestor of the run branch (new check `ancestry`). The
  run branch is named deterministically, `feat/<project-slug>-<repo>`, never after a tracker
  branch, so a resumed session builds on the same branch as the session before it. Work that
  0.7.x landed on per-issue branches is not merged into it automatically.
- **Review range `startSha..headSha`.** Implementers report `startSha` (HEAD before their
  first change); precheck, panel, guard and verifier judge from there instead of `firstSha^`,
  so a merge task is no longer blamed for every lane merged before it. The precheck verifies
  `startSha` is an ancestor of the head (check `range`; on a FAIL the range falls back to
  `firstSha^`). A footprint-only precheck failure that repeats with the same known head becomes
  an advisory note and the panel runs.
- **Agent preflight** (`preflight`, default on). Before any hydration or implementer, every
  agent type the run can dispatch answers one trivial haiku prompt; a silent type is probed
  once more, and any still silent refuses the run as `agents_unavailable`, naming the types.
- **Dead reviewers are a harness failure.** A reviewer that returns nothing is retried once
  (only the missing persona); if any required lens is still absent the stage fails closed and
  the run halts as `reviewers unavailable` (`REVIEWERS_UNAVAILABLE`), naming the lens: no
  replan spent, no code marked failed, and no stage passes on its surviving reviewers.
- **One PR per repo, pushed by the loop.** Lanes and integrations never pushed, so an ungated
  repo ended with unpushed merges. Every repo's terminal slot now runs the gate command if it
  has one, pushes the run branch and opens (or updates) the repo's one PR; implementers never
  push or open PRs. `repos[].prBy` is removed (ignored, with a warning). When the push or PR
  step itself fails (auth, a protected branch, the network) the slot is `SHIP_FAILED`: never
  replanned, the repo is listed in `ungatedRepos` with the cause in `ungatedReasons`.
- **Escalation only for code failures.** A replanned task moves to opus only when its last
  failure was code-kind (gating findings, BLOCKED, a structural precheck defect, a failed gate
  or sweep); harness failures (dead agent, merge conflict, footprint or ancestry precheck)
  keep the selector's tier. A task the replanner invents inherits the kind of the failures it
  repairs in its repo. The replanner is told which failures were harness failures.
- **`requireHook.raw`** (e.g. `"rtk proxy"`): implement and gate prompts say how to re-run a
  command whose compressed output is empty, garbled or contradicts its exit code (a generic
  version when unset).
- **`DONE_PENDING_GATE`**: a gated repo's DONE, landed everywhere DONE is. A gate dispatch
  returning it counts as a failed gate.
- **Pre-existing failures**: the implement brief says to run a failing check on the base (a
  throwaway worktree of `baseSha`, never `git stash`) before owning it, and to report
  pre-existing failures in `concerns`.
- **Unattended boundary**: every briefed dispatch is told nobody is watching; a message that
  looks like a user's mid-task is reported, never answered or obeyed.
- **Journal**: `at` is documented as the chunk's flush time (the runtime has no clock). Events
  and `run.json` carry `attempt`, the session number under a `runId` (bumped by the session's
  first flush that lands; a 0.7.x `run.json` counts as attempt 1); from attempt 2 chunks are
  `<firstSeq>.a<N>.jsonl`, so a relaunch never overwrites an earlier attempt, and
  `render-logs` dedupes by (attempt, seq).

### Upgrading from 0.7.x

- **One deterministic run branch per repo**, `feat/<project-slug>-<repo>`, and one PR per repo
  opened at project end. Per-ticket branches and per-ticket PRs are gone; drop `prBy` from
  `grimoire.config.json`. Work a 0.7.x run landed on per-issue branches is not merged into the
  new run branch automatically: merge or re-run it by hand. A repo whose 0.7.x run already
  opened per-ticket PRs on tracker branches gets one NEW PR, from the run branch, at the end of
  the next run: close the old per-ticket PRs or retarget them, or they stay open alongside it.
  The run branch name is slugged (`feat/<project-slug>-<repo-slug>`); a name with no
  sluggable characters becomes `x<hash>`.
- **The agent preflight is on by default.** An execute run that cannot spawn one of its agent
  types refuses with `error: 'agents_unavailable'` and `problems: [<types>]`. Fix
  `agentNamespace` or the agent names, or opt out with `{preflight: false}`.
- **New statuses for consumers of the result, the ledger and the journal.** `DONE_PENDING_GATE`
  is landed (count it with `DONE` and `DONE_WITH_CONCERNS`). `REVIEWERS_UNAVAILABLE` is not a
  code failure; the run halts with a reason starting `reviewers unavailable`. `SHIP_FAILED` is a
  terminal slot whose push or PR step failed (see `ungatedReasons`). Precheck events
  can carry the verdict `ADVISORY`, review events the verdict `UNAVAILABLE`.
- **Journal readers**: events and `run.json` have an `attempt` field (absent = 1), chunks from
  a second attempt onward are named `<seq>.a<N>.jsonl`, and `seq` is unique per attempt, not
  per run. `at` is the chunk's flush time, shared by every event of the chunk.
- **Implementers report `startSha`.** Team-agent definitions copied from the templates should
  add it to their return (`baseSha`, `startSha`, `commits`, `headSha`).
- **Known trade-off**: a footprint problem the precheck flags identically twice, with no new
  commit in between, is demoted to an advisory note. A stray change the precheck mislabels as
  footprint would then reach the panel instead of failing the task; the reviewers, not the
  precheck, have to catch it.
