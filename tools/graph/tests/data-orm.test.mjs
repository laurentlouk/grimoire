// ════════════════════════════════════════════════════════════════════════════
//  Tests — the data model map: the common ORMs (tools/graph/lib/data/extractors: rails.mjs,
//  code-migrations.mjs, django.mjs, sqlalchemy.mjs, typeorm.mjs, jpa.mjs, mongoose.mjs)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/data-orm.test.mjs
//
//  Part 1, on the fixtures of each ecosystem (tests/fixtures/orm/<ecosystem>) and inline variants, every
//  extractor run over a folder the way the index and a base run them (registry.mjs extractAll), then
//  reconciled (needs the parser runtime, but for section 1):
//   1. the names an ORM derives by convention: Active Record's inflections, snake_case, a glob's folder
//   2. Rails: db/schema.rb (an artifact) and the Active Record models (code) of one store: tables,
//      columns, keys, indexes, foreign keys, enums, the adapter of config/database.yml; associations no
//      foreign key states as relations declared by the ORM (never a foreign key), single-table
//      inheritance, a module's table_name_prefix, what is noted (polymorphic, a column the schema lacks);
//      MySQL's add_index and t.references, a dialect sniffed, adapters that disagree
//   3. SQL in migrations written as code: TypeORM's queryRunner.query and Knex's knex.raw, each statement
//      at its file line, only up(), in migration order; SQL code fills in noted; builder calls counted;
//      an order that cannot be decided
//   4. Django models: app labels, db_table, the implicit id from DEFAULT_AUTO_FIELD and an app's
//      default_auto_field, abstract and multi-table inheritance, a proxy, ForeignKey, OneToOneField,
//      ManyToManyField's join table, Meta constraints and indexes named as Django names them, the
//      user model from the settings, db_constraint=False; an engine the settings do not state literally
//   5. SQLAlchemy 2.0, 1.x Column, Table(), a mixin; SQLModel; Flask-SQLAlchemy
//   6. TypeORM entities beside their migrations: one store, the entity class cited beside each table, no
//      conflict while they agree; a column added to an entity with no migration: a conflict, both sides
//   7. JPA entities beside Flyway's migrations, Spring Boot's naming; without Spring Boot, names as written
//   8. Mongoose schemas: collections, paths, sub-documents, references declared by the ORM, indexes
//   9. canaries: no literal default, comment, help text, choice, password or where clause in any fact
//  10. the gaps: an ORM a store was read through is no gap; one no extractor reads still is
//  11. a base reads the same facts aside (readers/code-aside.mjs: Ruby and Java among its grammars)
//
//  Part 2, through call(), on the fixtures indexed as one project:
//  12. graph_data's stores and an entity's classes, no extractor failure, no ORM listed as a gap, no
//      canary (the planted passwords among them) in any answer or the page
//  13. a branch against its base: a column added to a schema.rb, a Django model, a JPA entity and a
//      Mongoose schema, each in graph_changes at its line (the base's files parsed aside)
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIX = path.join(HERE, 'fixtures', 'orm')
process.env.GRIMOIRE_GRAPH_FRESH_MS = '0'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }

console.log('\n1 · the names an ORM derives by convention (readers/inflect.mjs, readers/orm.mjs)')
{
  const I = await import('../lib/data/readers/inflect.mjs')
  const O = await import('../lib/data/readers/orm.mjs')
  eq(['post', 'person', 'category', 'address', 'status', 'child', 'mouse', 'fish', 'quiz', 'matrix', 'datum', 'wife', 'news', 'salesperson'].map(I.pluralize), ['posts', 'people', 'categories', 'addresses', 'statuses', 'children', 'mice', 'fish', 'quizzes', 'matrices', 'data', 'wives', 'news', 'salespeople'], 'Active Record\'s plurals: its rules, irregular and uncountable words')
  eq(['posts', 'people', 'categories', 'addresses', 'statuses', 'children', 'mice', 'data', 'movies', 'databases'].map(I.singularize), ['post', 'person', 'category', 'address', 'status', 'child', 'mouse', 'datum', 'movie', 'database'], '… and its singulars')
  eq([I.tableize('Blog::HTMLPost'), I.underscore('AdminUser'), I.camelize('admin/user_role'), I.demodulize('A::B::C'), I.snake('createdAt'), I.snake('HTTPCode')], ['html_posts', 'admin_user', 'Admin::UserRole', 'C', 'created_at', 'http_code'], 'a class\'s table: its last name underscored and pluralized; camelize, snake_case')
  eq([O.common(['a/b/c.py', 'a/b/d/e.py']), O.common(['x.py', 'a/y.py']), O.globDir('src/migration/*.ts'), O.globDir('dist/migrations/**/*{.ts,.js}'), O.globDir('db/m.ts')], ['a/b', '.', 'src/migration', 'dist/migrations', 'db'], 'the folder files share; the folder a glob names')
}

// ════ the parser runtime ════
const deps = await import('../lib/deps.mjs')
const RT = deps.findDeps() ? await deps.loadRuntime({ install: false }) : null
if (!RT) {
  if (process.env.CI) { FAIL++; console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)') } else console.log('\n   - sections 2 to 11 and part 2 skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  console.log(`\n${PASS} passed, ${FAIL} failed`)
  process.exit(FAIL ? 1 : 0)
}
const PS = {}
for (const l of ['ruby', 'python', 'typescript', 'tsx', 'javascript', 'java']) PS[l] = await RT.parserFor(l)
const { driver } = await import('../lib/store.mjs')
const { DatabaseSync } = await driver()
const CTX = { tree: (l, t) => PS[l].parse(t), DatabaseSync }
const { extractAll } = await import('../lib/data/registry.mjs')
const { reconcile, storeSummary, schemaDrift, elementsOf } = await import('../lib/data/reconcile.mjs')

// every file under a folder → Map(path → text)
const readTree = (dir, pre = '', out = new Map()) => { for (const f of readdirSync(dir)) { const p = path.join(dir, f); if (statSync(p).isDirectory()) readTree(p, `${pre}${f}/`, out); else out.set(`${pre}${f}`, readFileSync(p, 'utf8')) } return out }
const extract = (texts, ctx = CTX) => extractAll({ paths: [...texts.keys()], size: (p) => Buffer.byteLength(texts.get(p)), read: (p) => texts.get(p) }, { exclude: [] }, [], ctx)
const rowsOf = (texts, repo = 'app') => extract(texts).map((r) => ({ repo, ...r }))
const modelOf = (texts) => { const rows = rowsOf(texts); return { rows, model: reconcile(rows.filter((r) => r.facts)), errors: rows.filter((r) => r.error).map((r) => `${r.extractor} ${r.key}: ${r.error}`) } }
const fixture = (eco, patch = {}) => { const t = readTree(path.join(FIX, eco)); for (const [k, v] of Object.entries(patch)) { if (v === null) t.delete(k); else t.set(k, v) } return t }
// an element in brief
const base = (p) => p.split('/').pop()
const cites = (x) => x.sources.map((s) => `${base(s.path)}:${s.line}`).join(',')
const fields = (e) => e.fields.map((f) => `${f.name} ${f.type.raw}${f.nullable === false ? ' !' : ''}${f.default !== null && f.default !== undefined ? ` =${f.default}` : ''}${f.generated ? ` gen:${f.generated}` : ''}`)
const keys = (e) => e.keys.map((k) => `${k.role}(${k.parts.join(',')})`)
const idx = (e) => e.indexes.map((i) => `${i.name}${i.unique ? ' unique' : ''} (${i.columns.join(',')})${i.partial ? ' partial' : ''}`)
const rels = (e) => e.relations.map((r) => `(${r.columns.join(',')})->${r.to}(${r.toColumns.join(',')}) ${r.onDelete}${r.kind === 'client' ? ' [orm]' : ''} @${cites(r)}`)
const entity = (m, store, name) => m.stores.find((s) => s.id === store)?.entities.find((e) => e.name === name)
const conflictsOf = (st) => st.entities.flatMap((e) => elementsOf(e).flatMap(([label, x]) => x.conflicts.map((c) => `${label} ${c.attr}`)))

console.log('\n2 · Rails: db/schema.rb and the Active Record models, one store (fixtures/orm/rails)')
{
  const { model: m, errors } = modelOf(fixture('rails'))
  eq(errors, [], 'no extractor fails on a Rails application')
  const st = m.stores.find((s) => s.id === 'app:db')
  eq([m.stores.map((s) => s.id), st.dialect, st.dialectFrom, st.declarations.map((d) => `${d.kind} ${d.extractor} ${d.label}`)],
    [['app:db'], 'postgres', { how: 'stated', path: 'config/database.yml', line: 2 }, ['artifact rails@1 schema.rb, 7 tables', 'code rails@1 Active Record models, read 6 files: 6 classes mapped, 4 associations no foreign key states (6 a foreign key states)']],
    'one store, the schema file\'s folder: the schema an artifact, the models code; the dialect the adapter every database.yml entry states')
  eq(storeSummary(st), '7 tables · 4 foreign keys · 4 relations enforced by the client · 6 indexes · no conflicts', 'its summary: the associations no foreign key states counted apart from the foreign keys')
  const acc = entity(m, 'app:db', 'accounts')
  eq([fields(acc), keys(acc), cites(acc), acc.sources.map((s) => s.as || null)],
    [['id uuid ! =gen_random_uuid()', 'name string(80) !', "plan string ! ='…'", 'balance decimal(10,2) =0', 'active boolean ! =true', 'created_at datetime !', 'updated_at datetime !'], ['primary(id)'], 'schema.rb:9,account.rb:1', [null, 'class Account']],
    'a table: id: :uuid with its default a function of no argument, limit and precision in the type, a literal string default never kept; the class beside it at its line')
  eq(acc.fields.map((f) => `${f.name}:${f.sources[0].line}:${(f.unstated || []).join('+')}`).slice(0, 3), ['id:9:type', 'name:10:type', 'plan:11:type+default'], '… each column at its line, Rails\' types (and a string default) marked not compared')
  const users = entity(m, 'app:db', 'users')
  eq([fields(users), idx(users), rels(users), users.sources.map((s) => s.as || null)],
    [['id bigint !', 'account_id uuid !', 'email string !', 'roles string[] =(expression)', 'created_at datetime !', 'updated_at datetime !'], ['index_users_on_lower_email unique (lower((email)::text))', 'index_users_on_account_id (account_id)'], ['(account_id)->accounts(id) cascade @schema.rb:62'], [null, 'class User, Admin']],
    'the default bigint id, an array column, an expression index, add_foreign_key\'s column and action; a single-table-inheritance subclass beside its base class')
  const posts = entity(m, 'app:db', 'blog_posts')
  eq([fields(posts).slice(4, 6), idx(posts), rels(posts)],
    [["state post_state ! ='…'", 'slug string gen:stored'], ['index_blog_posts_on_author_id (author_id)', 'index_blog_posts_on_published_at (published_at) partial'], ['(author_id)->users(id) no action @schema.rb:63', '(editor_id)->users(id) set null [orm] @post.rb:6,user.rb:4']],
    'an enum column typed by its enum, a virtual column; a partial index (its where clause not kept); the editor association no foreign key states: declared by the ORM, cited at both models, has_many\'s dependent: :nullify its action')
  eq([rels(entity(m, 'app:db', 'comments')), rels(entity(m, 'app:db', 'blog_posts_tags'))],
    [['(post_id)->blog_posts(id) cascade @schema.rb:64', '(user_id)->users(id) no action [orm] @comment.rb:3,user.rb:5'], ['(post_id)->blog_posts(id) no action [orm] @post.rb:8,tag.rb:2', '(tag_id)->tags(id) no action [orm] @post.rb:8,tag.rb:2']],
    'a belongs_to and its has_many: one relation; a has_and_belongs_to_many\'s join table, both columns, from either side')
  eq(st.enums.map((e) => `${e.name} ${e.values.join('|')}`), ['post_state draft|published|archived'], 'create_enum: the store\'s enum')
  eq([entity(m, 'app:db', 'memberships') && keys(entity(m, 'app:db', 'memberships')), st.declarations[1].notes],
    [['primary(account_id,user_id)'], ['app/models/account.rb:3: has_many :memberships: its class Membership is no model mapped to a table of db/schema.rb', 'app/models/comment.rb:4: belongs_to :reviewer: comments has no column reviewer_id', 'app/models/user.rb:6: has_many :notes: polymorphic, its target named per row: no relation', 'app/models/user.rb:10: has_many :moderated: comments has no column admin_id']],
    'a composite primary key; what is not a relation, noted at its line: a class no model file defines, a column the schema lacks (a subclass\'s foreign key is its own name, admin_id), a polymorphic association')
  ok(entity(m, 'app:db', 'blog_posts').relations.every((r) => r.conflicts.length === 0) && conflictsOf(st).length === 0, 'a relation the ORM declares is no presence conflict against the schema that lacks its foreign key')

  // variants: MySQL, add_index and t.references; no database.yml (sniffed); adapters that disagree; a
  // module's table_name_prefix and an abstract class
  const my = new Map([
    ['config/database.yml', 'default: &default\n  adapter: mysql2\nproduction:\n  <<: *default\n  adapter: trilogy\n'],
    ['db/schema.rb', 'ActiveRecord::Schema.define(version: 20200101000000) do\n  create_table "shop_items", options: "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4", force: :cascade do |t|\n    t.references "owner", null: false, foreign_key: { to_table: :people, on_delete: :cascade }\n    t.references "subject", polymorphic: true, index: { unique: true }\n    t.timestamps\n  end\n  create_table "people", id: :integer do |t|\n    t.string "name"\n  end\n  add_index "people", ["name"], name: "by_name"\nend\n'],
    ['app/models/shop.rb', 'module Shop\n  def self.table_name_prefix\n    "shop_"\n  end\nend\n'],
    ['app/models/shop/item.rb', 'module Shop\n  class Item < ApplicationRecord\n    belongs_to :owner, class_name: "Person"\n  end\nend\n'],
    ['app/models/person.rb', 'class Person < ApplicationRecord\n  has_many :items, class_name: "Shop::Item", foreign_key: "owner_id"\nend\n'],
    ['app/models/application_record.rb', 'class ApplicationRecord < ActiveRecord::Base\n  self.abstract_class = true\nend\n'],
  ])
  const { model: mm } = modelOf(my)
  const ms = mm.stores[0]
  const items = ms.entities.find((e) => e.name === 'shop_items')
  eq([ms.dialect, fields(items), idx(items), keys(items), rels(items), items.sources.map((s) => s.as || null), fields(ms.entities.find((e) => e.name === 'people')), idx(ms.entities.find((e) => e.name === 'people'))],
    ['mysql', ['id bigint !', 'owner_id bigint !', 'subject_id bigint', 'subject_type string', 'created_at datetime !', 'updated_at datetime !'], ['index_shop_items_on_owner_id (owner_id)'], ['primary(id)', 'unique(subject_type,subject_id)'], ['(owner_id)->people(id) cascade @schema.rb:3'], [null, 'class Shop::Item'], ['id integer !', 'name string'], ['by_name (name)']],
    'MySQL (mysql2 and trilogy are one engine): t.references\' column, index and foreign key (to_table, on_delete), a polymorphic reference\'s two columns and its unique index (in MySQL the unique key it is); t.timestamps; add_index; a module\'s table_name_prefix (shop_items) and the foreign key both models\' associations then need not state')
  const { model: sn } = modelOf(new Map([['db/schema.rb', 'ActiveRecord::Schema[7.0].define(version: 1) do\n  enable_extension "plpgsql"\n  create_table "a", force: :cascade do |t|\n  end\nend\n']]))
  eq([sn.stores[0].dialect, sn.stores[0].dialectFrom], ['postgres', { how: 'sniffed', marker: 'enable_extension', path: 'db/schema.rb', line: 2 }], 'no database.yml: the dialect sniffed from what only one engine\'s schema says')
  const { model: dis } = modelOf(new Map([['db/schema.rb', 'ActiveRecord::Schema[7.0].define(version: 1) do\n  create_table "a" do |t|\n  end\nend\n'], ['config/database.yml', 'development:\n  adapter: sqlite3\nproduction:\n  adapter: <%= ENV["DB_ADAPTER"] %>\n']]))
  eq([dis.stores[0].dialect, dis.stores[0].declarations[0].notes], [null, ['config/database.yml: an adapter is not a literal: dialect unknown']], 'an adapter that is ERB, not a literal: dialect unknown, never guessed')
}

console.log('\n3 · SQL in migrations written as code: TypeORM and Knex (fixtures/orm/typeorm, fixtures/orm/knex)')
{
  const { model: tm, rows } = modelOf(fixture('typeorm'))
  const mig = rows.find((r) => r.extractor === 'code-migrations@1')
  const md = mig.facts.declarations[0]
  eq([md.store, md.dialect, md.dialectFrom, md.label, md.complete, md.clients, md.notes],
    ['src/migration', 'postgres', { how: 'stated', path: 'src/data-source.ts', line: 7 }, 'migrations as code, replayed 2 files, 5 statements (1 skipped)', false, ['typeorm'], ['src/migration/1700000500000-AddPostIndex.ts:10: SQL with a part code fills in: not read', 'skipped in src/migration/1700000500000-AddPostIndex.ts: 1 statement that does not shape the store (UPDATE 1)']],
    'a folder of TypeORM migrations: a store of kind migration, its dialect the data source\'s type, its up() SQL replayed; SQL with a part code fills in noted at its line (the replay then not complete), an UPDATE skipped and counted')
  const post = entity(tm, 'app:src/migration', 'post')
  eq(post.fields.map((f) => `${f.name} ${f.type.raw}@${f.sources.find((s) => s.kind === 'migration').path.split('-')[1]}:${f.sources.find((s) => s.kind === 'migration').line}`),
    ['id SERIAL@CreateUser.ts:9', 'title character varying@CreateUser.ts:10', 'authorId integer@CreateUser.ts:11', 'publishedAt TIMESTAMP WITH TIME ZONE@AddPostIndex.ts:8'],
    'each column at its line in the TypeScript file, a template literal\'s lines kept, a concatenation read whole; never down()')
  eq([idx(post), post.relations.map((r) => `(${r.columns})->${r.to} ${r.onDelete}`)], [['IDX_post_title (title)'], ['(authorId)->user cascade']], '… an index from a const of the file, a foreign key from an ALTER, in migration order')
  const { model: km, rows: krows } = modelOf(fixture('knex'))
  const kd = krows.find((r) => r.extractor === 'code-migrations@1').facts.declarations[0]
  const users = entity(km, 'app:migrations', 'users'), orders = entity(km, 'app:migrations', 'orders')
  eq([kd.dialect, kd.dialectFrom, kd.clients, kd.notes, fields(users), keys(users), idx(users), fields(orders), rels(orders)],
    ['sqlite', { how: 'stated', path: 'knexfile.js', line: 3 }, ['knex'], ['1 schema builder call (createTable, alterTable…): not read, only raw SQL is'], ['id INTEGER !', 'email TEXT !', "plan TEXT ! ='free'"], ['primary(id)', 'unique(email)'], ['users_plan (plan)'], ['id INTEGER !', 'user_id INTEGER !', 'total INTEGER'], ['(user_id)->users(id) cascade @20240212120000_orders.js:6']],
    'Knex: the knexfile\'s every client one engine (sqlite3, better-sqlite3), exports.up and an exported up, replayed into SQLite; knex.schema.raw of a concatenation; a builder call counted, not guessed')
  // no prefix: the order cannot be decided; an `up` nowhere
  const nop = extract(new Map([['db/a.ts', 'import { MigrationInterface, QueryRunner } from "typeorm"\nexport class A implements MigrationInterface { async up(q: QueryRunner) { await q.query(`CREATE TABLE a (id int)`) } }\n'], ['db/b.ts', 'import { MigrationInterface, QueryRunner } from "typeorm"\nexport class B implements MigrationInterface { async up(q: QueryRunner) { await q.query(`CREATE TABLE b (id int)`) } }\n']])).find((r) => r.extractor === 'code-migrations@1').facts.declarations[0]
  eq([nop.status, nop.label], ['not-read', 'dialect unknown (no config states it, and no dialect marker in the SQL)'], 'no config and no marker: listed, never replayed as a guessed dialect')
  const unordered = extract(new Map([['knexfile.js', "module.exports = { client: 'pg' }\n"], ['db/a.js', "exports.up = (knex) => knex.raw('CREATE TABLE a (id int)')\n"], ['db/b.js', "exports.up = (knex) => knex.raw('CREATE TABLE b (id int)')\n"]])).find((r) => r.extractor === 'code-migrations@1').facts.declarations[0]
  eq([unordered.status, unordered.label], ['not-read', 'order unknown (a.js has no numeric or timestamp prefix)'], 'names with no version prefix: the order unknown, the folder listed and not replayed')
  const { migrationLevel } = await import('../lib/data/extractors/code-migrations.mjs')
  eq([migrationLevel('src/db.js', "const pool = require('pg')\nmodule.exports = { init: () => pool.query('CREATE TABLE IF NOT EXISTS t (id int)') }\n"), migrationLevel('db/1_a.js', "module.exports = {\n  async up(knex) { await knex.raw('CREATE TABLE t (id int)') },\n}\n"), migrationLevel('db/1_a.d.ts', 'export function up(): void')],
    [0, 1024, 0], 'app code creating a table at startup is no migration; a CommonJS module exporting an up is one; a declaration file never')
}

console.log('\n4 · Django models (fixtures/orm/django)')
{
  const { model: m, errors } = modelOf(fixture('django'))
  eq(errors, [], 'no extractor fails on a Django project')
  const st = m.stores.find((s) => s.id === 'app:.')
  eq([st.dialect, st.dialectFrom, st.declarations.map((d) => d.label), st.declarations[0].notes, st.entities.map((e) => e.name)],
    ['postgres', { how: 'stated', path: 'shop/settings.py', line: 7 }, ['Django models, read 4 files: 6 models, 6 relations'], ["accounts/models.py:5: class User inherits AbstractUser, which the project does not define (or Django's, not read): its fields are stated in part", 'orders/models.py:14: 1 constraint of Order not modelled (checks, exclusions)'],
      ['accounts_user', 'catalog_product', 'catalog_product_tags', 'orders_giftorder', 'orders_order', 'orders_orderline', 'store_tag']],
    'one store, the folder of manage.py; the engine the settings state; a model per table (<app label>_<model>, a label apps.py states, db_table), a proxy none of its own; Django\'s abstract user noted, in part')
  const digest = (...a) => { const h = createHash('md5'); for (const x of a) h.update(x); return h.digest('hex').slice(0, 8) }
  const user = entity(m, 'app:.', 'accounts_user')
  eq([fields(user), keys(user), idx(user), rels(user), user.sources.map((s) => s.as)],
    [['id bigint !', 'nickname varchar(40) !', 'referred_by_id bigint'], ['primary(id)'], [`accounts_user_referred_by_id_${digest('accounts_user', 'referred_by_id')} (referred_by_id)`], ['(referred_by_id)->accounts_user(id) no action @models.py:7'], ['class User']],
    'the implicit id of DEFAULT_AUTO_FIELD (BigAutoField: bigint), a CharField\'s max_length, null=True nullable (blank is no nullability); a ForeignKey to "self": its _id column, its index named as Django names it, the database\'s action (on_delete is Django\'s, not the database\'s)')
  const prod = entity(m, 'app:.', 'catalog_product')
  eq([fields(prod), keys(prod), idx(prod), prod.fields.filter((f) => f.computed).map((f) => `${f.name}: ${f.computed}`)],
    [['id integer !', 'created_at timestamp with time zone !', 'updated_at timestamp with time zone !', 'sku varchar(32) !', 'title varchar(200) !', 'price numeric(10, 2) !', 'status varchar(10) !', 'stock integer ! =0'], ['primary(id)', 'unique(sku)'], ['product_recent_idx (created_at)'],
      ['created_at: auto_now_add', 'updated_at: auto_now', 'price: default=0', "status: default='…'"]],
    'an app\'s default_auto_field (AutoField: integer); an abstract model\'s fields first; unique a key; Meta.indexes by name; default the client\'s (computed, a string never kept), db_default the database\'s')
  const tags = entity(m, 'app:.', 'catalog_product_tags')
  eq([fields(tags), keys(tags), idx(tags), rels(tags)],
    [['id integer !', 'product_id integer !', 'tag_id integer !'], ['primary(id)', 'unique(product_id,tag_id)'], [`catalog_product_tags_product_id_${digest('catalog_product_tags', 'product_id')} (product_id)`, `catalog_product_tags_tag_id_${digest('catalog_product_tags', 'tag_id')} (tag_id)`], ['(product_id)->catalog_product(id) no action @product.py:15', '(tag_id)->store_tag(id) no action @product.py:15']],
    'a ManyToManyField\'s join table <table>_<field>: its id, both columns, their unique key, indexes and foreign keys (the target in the app labelled store)')
  const order = entity(m, 'app:.', 'orders_order'), line = entity(m, 'app:.', 'orders_orderline'), gift = entity(m, 'app:.', 'orders_giftorder')
  eq([fields(order).slice(2), keys(order), idx(order), rels(order)],
    [['id uuid !', 'customer_id bigint !', 'number varchar(20) !', 'note text'], ['primary(id)', 'unique(customer_id,number)'], [`orders_order_customer_id_${digest('orders_order', 'customer_id')} (customer_id)`, 'order_number_open unique (number) partial'], ['(customer_id)->accounts_user(id) no action @models.py:10']],
    'an explicit UUID key; settings.AUTH_USER_MODEL resolved through the settings; unique_together a key, a conditional UniqueConstraint a partial unique index')
  eq([fields(line), rels(line), fields(gift), keys(gift), rels(gift)],
    [['id bigint !', 'order_id uuid !', 'product_id integer !', 'quantity smallint !'], ['(order_id)->orders_order(id) no action @models.py:23', '(product_id)->catalog_product(id) no action [orm] @models.py:24'], ['order_ptr_id uuid !', 'message text !'], ['primary(order_ptr_id)'], ['(order_ptr_id)->orders_order(id) no action @models.py:28']],
    'a foreign key typed as the key it references, db_constraint=False a relation declared by the ORM ("store.Product" by its app label); multi-table inheritance: <parent>_ptr_id, the key and a foreign key to the parent')
  // an engine from the environment: unknown, the types Django's own field classes (not compared)
  const { model: env } = modelOf(fixture('django', { 'shop/settings.py': 'import os\nDATABASES = {"default": {"ENGINE": os.environ["DB_ENGINE"]}}\n' }))
  const es = env.stores[0]
  eq([es.dialect, es.declarations[0].notes[0], fields(es.entities.find((e) => e.name === 'store_tag')), es.entities.find((e) => e.name === 'store_tag').fields.map((f) => f.unstated?.join() || '')],
    [null, 'a database ENGINE in shop/settings.py is not a literal Django backend: dialect unknown', ['id AutoField !', 'slug SlugField(50) !'], ['type', 'type']],
    'an ENGINE the settings read from the environment: dialect unknown, never guessed; each column typed by its field class, not compared')
  const { model: lite } = modelOf(new Map([['app/settings.py', 'DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3"}}\n'], ['blog/models.py', 'from django.db import models\n\nclass Entry(models.Model):\n    body = models.TextField()\n    when = models.DateTimeField()\n    ok = models.BooleanField(default=False)\n\n    class Meta:\n        app_label = "journal"\n        index_together = [["when", "ok"]]\n']]))
  const entry = lite.stores[0].entities[0]
  eq([lite.stores[0].dialect, entry.name, fields(entry), idx(entry)], ['sqlite', 'journal_entry', ['id integer !', 'body text !', 'when datetime !', 'ok bool !'], [`journal_entry_when_ok_${digest('journal_entry', 'when', 'ok')}_idx (when,ok)`]],
    'SQLite\'s column types; no DEFAULT_AUTO_FIELD: AutoField, as Django picks it; Meta.app_label; index_together named as Django names it')
}

console.log('\n5 · SQLAlchemy and SQLModel (fixtures/orm/sqlalchemy, fixtures/orm/sqlmodel)')
{
  // the models alone first (the fixture's Alembic environment left out: section 5b reads them together)
  const noAlembic = { 'migrations/env.py': null, 'migrations/versions/1a2b3c4d5e6f_init.py': null, 'migrations/versions/2b3c4d5e6f7a_book_status.py': null }
  const { model: m, errors } = modelOf(fixture('sqlalchemy', noAlembic))
  eq(errors, [], 'no extractor fails on SQLAlchemy models')
  const st = m.stores[0]
  eq([st.id, st.dialect, st.dialectFrom, st.declarations[0].label, st.entities.map((e) => e.name)],
    ['app:library', 'postgres', { how: 'stated', path: 'alembic.ini', line: 3 }, 'SQLAlchemy models, read 1 file: 4 tables, 3 foreign keys (2 relationships, derived from them)', ['authors', 'book_authors', 'books', 'shelves']],
    'the models\' folder; the engine an URL\'s scheme states (nothing else of it kept); relationship() no relation of its own')
  const books = entity(m, 'app:library', 'books')
  eq([fields(books), keys(books), idx(books), rels(books), books.sources.map((s) => s.as)],
    [['created_at DateTime ! =now()', 'id Integer !', 'isbn String(13) !', 'title String !', 'year Integer', "price Numeric(10, 2) ='…'", 'status String(12) !', 'shelf Integer'], ['primary(id)', 'unique(isbn)'], ['ix_books_title_year (title,year)'], ['(shelf)->shelves(id) set null @models.py:47'], ['class Book']],
    'a mixin\'s column first; Mapped[T] not null, Optional and | None nullable, a Column nullable; a column named by its first argument; __table_args__\' unique constraint and index; ForeignKey\'s ondelete; server_default the database\'s (func.now() by its name, a string never kept)')
  const assoc = entity(m, 'app:library', 'book_authors'), authors = entity(m, 'app:library', 'authors'), shelves = entity(m, 'app:library', 'shelves')
  eq([fields(assoc), keys(assoc), rels(assoc), idx(authors), fields(shelves), keys(shelves)],
    [['book_id Integer !', 'author_id Integer !'], ['primary(book_id,author_id)'], ['(book_id)->books(id) cascade @models.py:19', '(author_id)->authors(id) no action @models.py:20'], ['ix_authors_name (name)'], ['id Integer !', 'label String(40) !'], ['primary(id)', 'unique(label)']],
    'Table(): an association table, its columns typed as the keys they reference; index=True named by SQLAlchemy\'s convention; 1.x Column(Integer, primary_key=True)')
  // 5b · beside Alembic's revisions: one store, every element cited at its revision and its model
  const { model: am, errors: aerr } = modelOf(fixture('sqlalchemy'))
  const as = am.stores.find((s) => s.id === 'app:migrations/versions')
  eq([aerr, am.stores.map((s) => s.id), as.declarations.map((d) => `${d.kind} ${d.extractor} ${d.label}`), as.declarations[0].notes, as.declarations[1].notes, storeSummary(as)],
    [[], ['app:migrations/versions'], ['migration alembic@1 Alembic revisions, replayed 2 files, 7 statements (1 skipped)', 'code sqlalchemy@1 SQLAlchemy models, read 1 file: 4 tables, 3 foreign keys (2 relationships, derived from them)'], ['operations that do not shape the store, or are not read: bulk_insert 1', 'skipped in migrations/versions/1a2b3c4d5e6f_init.py: 1 statement that does not shape the store (INSERT 1)'], ['the revisions of migrations/env.py (target_metadata): the models and those revisions are one store'], '4 tables · 3 foreign keys · 2 indexes · no conflicts'],
    'Alembic: its revisions replayed in revision order as the DDL each operation emits, a store of kind migration; the models its env.py autogenerates from, a declaration of the same store; they agree')
  const ab = entity(am, 'app:migrations/versions', 'books')
  eq([ab.fields.map((f) => `${f.name} ${f.type.raw} @${cites(f)}`), idx(ab).map((x, i) => `${x} @${cites(ab.indexes[i])}`), rels(ab), ab.sources.map((s) => s.as || s.kind)],
    [['id INTEGER @1a2b3c4d5e6f_init.py:34,models.py:41', 'isbn VARCHAR(13) @1a2b3c4d5e6f_init.py:35,models.py:42', 'title VARCHAR @1a2b3c4d5e6f_init.py:36,models.py:43', 'year INTEGER @1a2b3c4d5e6f_init.py:37,models.py:44', "price NUMERIC(10, 2) @1a2b3c4d5e6f_init.py:38,models.py:45", 'shelf INTEGER @1a2b3c4d5e6f_init.py:39,models.py:47', 'created_at TIMESTAMP WITHOUT TIME ZONE @1a2b3c4d5e6f_init.py:40,models.py:13', 'status VARCHAR(12) @2b3c4d5e6f7a_book_status.py:14,models.py:46'], ['ix_books_title_year (title,year) @2b3c4d5e6f7a_book_status.py:16,models.py:37'], ['(shelf)->shelves(id) set null @1a2b3c4d5e6f_init.py:41,models.py:47'], ['migration', 'class Book']],
    'each column at its sa.Column line in the revision and at its model; add_column in a later revision, an index a batch operation creates; the foreign key\'s ondelete')
  // a column added to a model and no revision generated; two heads
  const { model: a2 } = modelOf(fixture('sqlalchemy', { 'library/models.py': readFileSync(path.join(FIX, 'sqlalchemy/library/models.py'), 'utf8').replace('    label = Column(String(40), nullable=False, unique=True)', '    label = Column(String(40), nullable=False, unique=True)\n    floor = Column(Integer, nullable=False)') }))
  const floor = entity(a2, 'app:migrations/versions', 'shelves').fields.find((f) => f.name === 'floor')
  eq([floor.conflicts.map((c) => `${c.attr}: ${c.values.map((v) => `${v.value} ${v.sources.map((s) => `${s.kind} ${base(s.path)}:${s.line}`).join(',')}`).join(' | ')}`), schemaDrift(floor.conflicts[0])],
    [['presence: declared code models.py:56 | absent migration 1a2b3c4d5e6f_init.py:16'], true], 'a column added to a model and no revision generated: a conflict, both sides cited')
  const twoHeads = extract(fixture('sqlalchemy', { 'migrations/versions/3c_other.py': 'from alembic import op\nimport sqlalchemy as sa\nrevision = "3c"\ndown_revision = "1a2b3c4d5e6f"\n\ndef upgrade():\n    op.drop_table("tags")\n' })).find((r) => r.extractor === 'alembic@1').facts.declarations[0]
  eq([twoHeads.status, twoHeads.label], ['not-read', 'order unknown (2 heads: 2b3c4d5e6f7a, 3c)'], 'two heads no merge revision joins: the order unknown, never replayed in a guessed order')
  const lite = extract(new Map([['alembic.ini', '[alembic]\nsqlalchemy.url = sqlite:///app.db\n'], ['alembic/versions/a_init.py', 'from alembic import op\nimport sqlalchemy as sa\nrevision = "a"\ndown_revision = None\n\ndef upgrade():\n    op.create_table("notes", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("body", sa.Text()))\n    with op.batch_alter_table("notes") as b:\n        b.add_column(sa.Column("done", sa.Boolean(), nullable=False, server_default=sa.false()))\n        b.create_index("ix_notes_done", ["done"])\n']])).find((r) => r.extractor === 'alembic@1').facts.declarations[0]
  eq([lite.dialect, lite.status, lite.entities.map((e) => `${e.name}: ${e.fields.map((f) => `${f.name}${f.nullable ? '' : '!'}${f.default !== null ? `=${f.default}` : ''}@${f.line}`).join(' ')} · ${e.indexes.map((i) => i.name)}`)], ['sqlite', 'read', ["notes: id!@7 body@7 done!='…'@9 · ix_notes_done"]],
    'SQLite: replayed into node:sqlite, a batch operation\'s add_column and create_index on the batch\'s table; a default no literal of which is kept')

  const { model: sm } = modelOf(fixture('sqlmodel'))
  const hero = entity(sm, 'app:heroes', 'hero'), team = entity(sm, 'app:heroes', 'team')
  eq([sm.stores[0].dialect, fields(hero), keys(hero), idx(hero), rels(hero), fields(team), idx(team), sm.stores[0].entities.map((e) => e.name)],
    ['sqlite', ['name String !', 'secret_name String !', 'age Integer', 'id Integer !', 'team_id Integer'], ['primary(id)'], ['ix_hero_name (name)', 'ix_hero_age (age)'], ['(team_id)->team(id) cascade @models.py:21'], ['id Integer !', 'name String !', 'headquarters String !'], ['ix_team_name (name)'], ['hero', 'team']],
    'SQLModel: table=True classes, the table the class name in lower case, a base model\'s fields first, Field(foreign_key=, ondelete=), Relationship() none; a model with no table=True none')
  const { model: fm } = modelOf(new Map([['app/models.py', 'from flask_sqlalchemy import SQLAlchemy\n\ndb = SQLAlchemy()\n\nclass UserAccount(db.Model):\n    id = db.Column(db.Integer, primary_key=True)\n    email = db.Column(db.String(120), unique=True, nullable=False)\n\nclass Note(db.Model):\n    __tablename__ = "notes"\n    id = db.Column(db.Integer, primary_key=True)\n    owner_id = db.Column(db.Integer, db.ForeignKey("user_account.id"))\n']]))
  eq(fm.stores[0].entities.map((e) => `${e.name}: ${fields(e).join(', ')} ${rels(e).join(' ')}`.trim()), ['notes: id Integer !, owner_id Integer (owner_id)->user_account(id) no action @models.py:12', 'user_account: id Integer !, email String(120) !'],
    'Flask-SQLAlchemy: db.Model classes, a table named from its class when none is (user_account), db.Column and db.ForeignKey')
}

console.log('\n6 · TypeORM entities beside their migrations (fixtures/orm/typeorm)')
{
  const { model: m, errors } = modelOf(fixture('typeorm'))
  eq(errors, [], 'no extractor fails on a TypeORM project')
  const st = m.stores.find((s) => s.id === 'app:src/migration')
  eq([m.stores.map((s) => s.id), st.declarations.map((d) => `${d.kind} ${d.extractor}`), st.declarations[1].notes, storeSummary(st)],
    [['app:src/migration'], ['migration code-migrations@1', 'code typeorm@1'], ['the migrations of src/data-source.ts (src/migration/*.ts): the entities and those migrations are one store'], '4 tables · 3 foreign keys · 3 indexes · no conflicts'],
    'the entities and the migrations generated from them: one store, the folder the data source\'s migrations glob names')
  const user = entity(m, 'app:src/migration', 'user')
  eq([user.sources.map((s) => `${s.kind} ${base(s.path)}:${s.line}${s.as ? ` ${s.as}` : ''}`), user.fields.map((f) => `${f.name}:${cites(f)}`), keys(user), user.keys.map(cites)],
    [['migration 1700000000000-CreateUser.ts:7', 'code User.ts:5 class User'], ['id:1700000000000-CreateUser.ts:7,User.ts:6', 'email:1700000000000-CreateUser.ts:7,User.ts:9', 'displayName:1700000000000-CreateUser.ts:7,User.ts:12', 'role:1700000000000-CreateUser.ts:7,User.ts:15', 'createdAt:1700000000000-CreateUser.ts:7,User.ts:18'], ['primary(id)', 'unique(email)'], ['1700000000000-CreateUser.ts:7,User.ts:5', '1700000000000-CreateUser.ts:7,User.ts:9']],
    'a table cites the migration that creates it and the entity class mapping it (class User, at its line); each column and key both')
  const post = entity(m, 'app:src/migration', 'post')
  eq([idx(post).map((i) => `${i}@${cites(post.indexes[0])}`), rels(post), fields(entity(m, 'app:src/migration', 'post_tags_tags')), idx(entity(m, 'app:src/migration', 'post_tags_tags'))],
    [['IDX_post_title (title)@1700000500000-AddPostIndex.ts:3,Post.ts:10'], ['(authorId)->user(id) cascade @1700000000000-CreateUser.ts:14,Post.ts:17'], ['postId int !', 'tagsSlug varchar(40) !'], ['IDX_ba037b6fe8bd028a82b3638467 (postId)', 'IDX_592fff42460c3b6fbf4379d53a (tagsSlug)']],
    'a named index and a ManyToOne\'s join column authorId and its foreign key agree with the migrations; a ManyToMany\'s junction table, its columns and indexes named as TypeORM names them')
  const { tname } = await import('../lib/data/extractors/typeorm.mjs')
  eq([tname.unique('user', ['email']), tname.primary('user', ['id']), tname.primary('post', ['id'])], ['UQ_e12875dfb3b1d92d7d7c5377e22', 'PK_cace4a159ff9f2512dd42373760', 'PK_be5fda3aac270b134ff9c21cdee'], 'TypeORM\'s names for what it creates: the ones its generated migration in the fixture writes')
  // the migrations complete (no SQL code fills in), then a column added to an entity with no migration
  const done = { 'src/migration/1700000500000-AddPostIndex.ts': readFileSync(path.join(FIX, 'typeorm/src/migration/1700000500000-AddPostIndex.ts'), 'utf8').replace(/\n.*const table[^\n]*\n[^\n]*\$\{table\}[^\n]*/, '') }
  const { model: ok0 } = modelOf(fixture('typeorm', done))
  const s0 = ok0.stores[0]
  eq([s0.declarations[0].label, s0.declarations[0].notes, conflictsOf(s0)], ['migrations as code, replayed 2 files, 5 statements (1 skipped)', ['skipped in src/migration/1700000500000-AddPostIndex.ts: 1 statement that does not shape the store (UPDATE 1)'], ['post_tags_tags presence', 'tags presence']],
    'the migrations complete: the tables only the entities declare (a junction and a table no migration creates yet) are presence conflicts')
  const { model: m2 } = modelOf(fixture('typeorm', { ...done, 'src/entity/User.ts': readFileSync(path.join(FIX, 'typeorm/src/entity/User.ts'), 'utf8').replace('    @CreateDateColumn()', '    @Column({ nullable: true })\n    nickname: string\n\n    @CreateDateColumn()') }))
  const u2 = entity(m2, 'app:src/migration', 'user')
  const nick = u2.fields.find((f) => f.name === 'nickname')
  eq([nick.conflicts.map((c) => `${c.attr}: ${c.values.map((v) => `${v.value} ${v.sources.map((s) => `${s.kind} ${base(s.path)}:${s.line}`).join(',')}`).join(' | ')}`), schemaDrift(nick.conflicts[0])],
    [['presence: declared code User.ts:18 | absent migration 1700000000000-CreateUser.ts:7'], true],
    'a column added to an entity and no migration generated: a conflict, both sides cited, named as the schema edited without a migration')
}

console.log('\n7 · JPA entities beside Flyway\'s migrations (fixtures/orm/jpa)')
{
  const { model: m, errors } = modelOf(fixture('jpa'))
  eq(errors, [], 'no extractor fails on a Spring Boot project')
  const st = m.stores.find((s) => s.id === 'app:src/main/resources/db/migration')
  eq([m.stores.map((s) => s.id), st.dialect, st.declarations.map((d) => `${d.kind} ${d.extractor}`), st.declarations[1].notes, storeSummary(st)],
    [['app:src/main/resources/db/migration'], 'postgres', ['migration sql-migrations@2', 'code jpa@1'], ["names in snake_case: Spring Boot's default physical naming strategy (pom.xml)", 'the migrations in src/main/resources/db/migration, where Flyway looks by default: the entities and those migrations are one store'], '4 tables · 3 foreign keys · 1 index · no conflicts'],
    'the entities and Flyway\'s migrations at its default location: one store; Spring Boot\'s naming')
  const order = entity(m, 'app:src/main/resources/db/migration', 'purchase_order')
  eq([order.sources.map((s) => `${s.kind} ${base(s.path)}:${s.line}${s.as ? ` ${s.as}` : ''}`), order.fields.map((f) => `${f.name}:${f.sources.map((s) => s.kind).join('+')}`), rels(order), idx(order)],
    [['migration V1__init.sql:8', 'code PurchaseOrder.java:7 class PurchaseOrder'], ['id:migration+code', 'order_number:migration+code', 'customer_id:migration+code', 'total:migration+code', 'created_at:migration+code', 'gift:code'], ['(customer_id)->customer(id) no action @V1__init.sql:11,PurchaseOrder.java:17'], ['ux_order_number unique (order_number)']],
    'each table at its migration and its entity class; camelCase fields in snake_case, a @MappedSuperclass\'s column, a @ManyToOne\'s join column <field>_<key>, a named @Index')
  const cust = entity(m, 'app:src/main/resources/db/migration', 'customer')
  eq([cust.fields.map((f) => `${f.name} ${f.nullable === false ? '!' : '?'} ${(f.sources.find((s) => s.kind === 'code') && (f.unstated || []).includes('nullable')) ? 'unsaid' : ''}`.trim()), fields(entity(m, 'app:src/main/resources/db/migration', 'order_tag')), fields(entity(m, 'app:src/main/resources/db/migration', 'label'))],
    [['id !', 'email !', 'display_name ?', 'created_at !'], ['order_id Long !', 'tag_id String !'], ['code String !']],
    'a field JPA says nothing of the nullability of: compared with nothing (no conflict with the migration\'s column); @Transient and mappedBy none; a @JoinTable; @Entity(name) the table')
  const { model: plain } = modelOf(fixture('jpa', { 'pom.xml': '<project><artifactId>shop</artifactId></project>\n', 'src/main/resources/db/migration/V1__init.sql': null }))
  eq(plain.stores.map((s) => `${s.id}: ${s.entities.map((e) => e.name).join(', ')}`), ['app:.: Customer, Label, PurchaseOrder, order_tag'], 'without Spring Boot, names as written (a class\'s name, the entity\'s name, a join table\'s); without migrations, the module\'s own store')
  const { model: cf } = modelOf(fixture('jpa', { 'src/main/resources/db/migration/V1__init.sql': readFileSync(path.join(FIX, 'jpa/src/main/resources/db/migration/V1__init.sql'), 'utf8').replace('order_number VARCHAR(32) NOT NULL', 'order_number VARCHAR(32)') }))
  const on = entity(cf, 'app:src/main/resources/db/migration', 'purchase_order').fields.find((f) => f.name === 'order_number')
  eq(on.conflicts.map((c) => `${c.attr}: ${c.values.map((v) => `${v.value} ${v.sources.map((s) => s.kind).join('+')}`).join(' | ')}`), ['nullable: true migration | false code'], 'nullable = false where the migration allows null: a conflict, each side kept')
}

console.log('\n8 · Mongoose schemas (fixtures/orm/mongoose)')
{
  const { model: m, errors } = modelOf(fixture('mongoose'))
  eq(errors, [], 'no extractor fails on Mongoose models')
  const st = m.stores[0]
  eq([st.id, st.dialect, storeSummary(st), st.entities.map((e) => `${e.name} ${e.kind} ${e.sources[0].as}`), st.declarations[0].notes],
    ['app:src/models', 'mongodb', '3 collections · 3 references · 3 indexes · no conflicts', ['posts collection model Post', 'taxonomy collection model Category', 'users collection model User'], ['src/models/user.ts:3: schema addressSchema has no model built from it here (a sub-document): not a collection']],
    'a document store: a collection per model (Mongoose\'s plural of its name, or the schema\'s collection option), a schema no model is built from noted')
  const users = entity(m, 'app:src/models', 'users'), posts = entity(m, 'app:src/models', 'posts')
  eq([fields(users), idx(users), fields(posts), rels(posts)],
    [['_id ObjectId !', 'email String !', 'name String', "role String ='…'", 'karma Number =0', 'address subdocument', 'address.street String', 'address.city String !', 'profile.bio String', 'profile.links [String]', 'createdAt Date', 'updatedAt Date'], ['email_1 unique (email)', 'name_1_karma_-1 (name,karma)'],
      ['_id ObjectId !', 'title String !', 'author ObjectId !', 'tags [ObjectId]', 'comments []', 'comments[].body String', 'comments[].by ObjectId'], ['(author)->users(_id) no action [orm] @post.js:5', '(tags)->taxonomy(_id) no action [orm] @post.js:6', '(comments[].by)->users(_id) no action [orm] @post.js:7']],
    'paths by dotted name, a sub-document\'s paths under it, timestamps; unique and compound indexes; each ref a relation declared by the ORM, never a foreign key')
}

// secrets planted at run time (no credential-shaped literal sits in the repository): a password in an
// engine URL, in Spring's configuration, in Django's settings
const secret = (what) => ['CANARY', what, 'PASSWORD'].join('-')
const fixText = (eco, p) => readFileSync(path.join(FIX, eco, p), 'utf8')
const PLANT = {
  sqlalchemy: { 'alembic.ini': fixText('sqlalchemy', 'alembic.ini').replace('postgresql+psycopg://db.internal', `postgresql+psycopg://app:${secret('SA')}@db.internal`) },
  jpa: { 'src/main/resources/application.properties': `${fixText('jpa', 'src/main/resources/application.properties')}spring.datasource.password=${secret('JPA')}\n` },
  django: { 'shop/settings.py': fixText('django', 'shop/settings.py').replace('"NAME": "shop",', `"NAME": "shop",\n        "PASSWORD": "${secret('DJANGO')}",`) },
}

console.log('\n9 · canaries: no literal value of a model, a schema or a configuration in any fact')
{
  const mine = /^(?:rails|code-migrations|django|sqlalchemy|alembic|typeorm|jpa|mongoose)@/
  const planted = ['sqlalchemy', 'jpa', 'django'].map((e) => fixture(e, PLANT[e]))
  ok(planted.every((t, i) => [...t.values()].join('\n').includes(secret(['SA', 'JPA', 'DJANGO'][i]))), 'the secrets are planted in the files the extractors read')
  const all = ['rails', 'typeorm', 'knex', 'django', 'sqlalchemy', 'sqlmodel', 'jpa', 'mongoose'].map((e) => JSON.stringify(rowsOf(fixture(e, PLANT[e] || {})).filter((r) => mine.test(r.extractor)))).join('\n')
  const left = [...new Set(all.match(/CANARY-[A-Z-]+/g) || [])]
  eq(left, [], 'every CANARY planted in a fixture (a string default, a comment, help text, a verbose name, choices, an enum\'s values, a where clause, a password in a URL or the settings, a column definition, an UPDATE\'s value) is in no fact')
}

console.log('\n10 · the gaps: an ORM a store was read through is no gap')
{
  const { gapsOf } = await import('../lib/data/check.mjs')
  const { model: m } = modelOf(fixture('django'))
  const im = (source, p = 'x/views.py') => ({ repo: 'app', path: p, source })
  eq(gapsOf(m, [], [im('django.db'), im('django.db.models')]), [], 'django.db imported where the Django models were read: no gap')
  const { model: k } = modelOf(fixture('knex'))
  eq(gapsOf(k, [], [im('knex', 'src/db.js')]).map((g) => g.id), [], 'knex imported where its migrations\' SQL was read: no gap')
  // (a store of a known dialect covers every ORM import: the rule before these extractors; so, a store whose engine is unknown)
  const { model: u } = modelOf(fixture('django', { 'shop/settings.py': 'import os\nDATABASES = {"default": {"ENGINE": os.environ["DB_ENGINE"]}}\n' }))
  eq([u.stores[0].dialect, gapsOf(u, [], [im('django.db')]).map((g) => g.id), gapsOf(u, [], [im('sequelize', 'src/db.js')]).map((g) => `${g.id} ${g.sources}`)], [null, [], ['sql-db sequelize']], 'the Django models read, their engine unknown: django.db no gap, an ORM no extractor reads (Sequelize) still one')
  const { model: mg } = modelOf(fixture('mongoose'))
  eq(gapsOf(mg, [], [im('mongoose', 'src/app.js')]).map((g) => g.id), [], 'mongoose imported, its schemas read: no gap')
}

console.log('\n11 · a base reads the same facts aside (readers/code-aside.mjs)')
{
  const { extractAside } = await import('../lib/data/readers/code-aside.mjs')
  const { ASIDE, asideOf } = await import('../lib/data/registry.mjs')
  const sameAside = (eco) => {
    const texts = fixture(eco)
    const items = [...texts].flatMap(([p, t]) => asideOf(p, t).map((ex) => ({ id: ex.id, path: p, text: t, key: `${ex.id}\0${p}` })))
    const facts = extractAside(items)
    const aside = (id, p) => { const v = facts.get(`${id}\0${p}`); if (v instanceof Error) throw v; return v }
    // (a base reads neither access patterns nor the SQL code sends: those extractors' rows are left aside)
    const strip = (rows) => JSON.stringify(rows.filter((r) => ASIDE.some((ex) => r.extractor === `${ex.id}@${ex.version}`)).map((r) => ({ e: r.extractor, k: r.key, f: r.facts, err: r.error })))
    return strip(extract(texts, { DatabaseSync, aside })) === strip(extract(texts))
  }
  const ids = ['rails', 'code-migrations', 'django', 'sqlalchemy', 'alembic', 'typeorm', 'jpa', 'mongoose']
  ok(ids.every((id) => ASIDE.some((ex) => ex.id === id)), 'every ORM extractor reads a base aside')
  for (const eco of ['rails', 'typeorm', 'django', 'sqlalchemy', 'jpa', 'mongoose']) ok(sameAside(eco), `${eco}: the facts read aside, through the child process\'s grammars, are the facts read in process`)
}

// ════ Part 2 · through call(), the fixtures indexed as one project ════
{
  const { call } = await import('../lib/commands.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { loadProject } = await import('../lib/project.mjs')
  const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-orm-')))
  try {
    console.log('\n12 · the ORMs of eight repositories through call(): graph_data, the classes beside the tables, no gap, no canary')
    const ROOT = path.join(SANDBOX, 'orm')
    cpSync(FIX, ROOT, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
    for (const [eco, files] of Object.entries(PLANT)) for (const [p, t] of Object.entries(files)) writeFileSync(path.join(ROOT, eco, p), t)
    mkdirSync(path.join(ROOT, 'knex/src'), { recursive: true })
    writeFileSync(path.join(ROOT, 'knex/src/db.js'), "const knex = require('knex')\nmodule.exports = knex({ client: 'sqlite3' })\n")
    const repos = ['rails', 'typeorm', 'knex', 'django', 'sqlalchemy', 'sqlmodel', 'jpa', 'mongoose']
    writeFileSync(path.join(ROOT, 'grimoire.config.json'), JSON.stringify({ repos: repos.map((r) => ({ name: r, path: r })), graph: { dir: '.grimoire/graph' } }))
    const q = async (tool, args = {}) => (await call(`graph_${tool}`, args, { root: ROOT })).replace(/\n\nLeads, not facts:[^\n]*$/, '')
    const idx = await q('index')
    ok(!idx.includes('failure'), `index: every repository, no extractor failure (${idx.replace(/\n/g, ' | ')})`)
    const list = await q('data')
    for (const line of [
      'rails:db  postgres  7 tables · 4 foreign keys · 4 relations enforced by the client · 6 indexes · no conflicts',
      'typeorm:src/migration  postgres  4 tables · 3 foreign keys · 3 indexes · no conflicts',
      'knex:migrations  sqlite  2 tables · 1 foreign key · 1 index (+1 implicit, for keys) · no conflicts',
      'django:.  postgres  7 tables · 6 foreign keys · 1 relation enforced by the client · 8 indexes · no conflicts',
      'sqlalchemy:migrations/versions  postgres  4 tables · 3 foreign keys · 2 indexes · no conflicts',
      'sqlmodel:heroes  sqlite  2 tables · 1 foreign key · 3 indexes · no conflicts',
      'jpa:src/main/resources/db/migration  postgres  4 tables · 3 foreign keys · 1 index · no conflicts',
      'mongoose:src/models  mongodb  3 collections · 3 references · 3 indexes · no conflicts',
    ]) has(list, line, `graph_data lists ${line.split('  ')[0]}`)
    ok(!/Gaps \(/.test(list), `no ORM listed as a gap: each was read (${(list.match(/Gaps[^\n]*\n(?:  [^\n]*\n?)*/) || [''])[0].trim()})`)
    has(await q('data', { store: 'typeorm:src/migration' }), '  user  table  5 fields · primary (id)  typeorm/src/migration/1700000000000-CreateUser.ts:7 · typeorm/src/entity/User.ts:5\n    class User  typeorm/src/entity/User.ts:5', 'a store\'s table, the entity class mapping it beside it at its line')
    has(await q('data', { entity: 'jpa:src/main/resources/db/migration/purchase_order' }), '  declared at jpa/src/main/resources/db/migration/V1__init.sql:8 [migration sql-migrations@2] · jpa/src/main/java/com/example/shop/model/PurchaseOrder.java:7 [code jpa@1, class PurchaseOrder]', 'an entity: its migration and its class, each with its extractor')
    has(await q('data', { store: 'rails:db' }), '    class User, Admin  rails/app/models/user.rb:1', 'Rails: the model classes beside their table')
    const outs = [list, ...(await Promise.all(repos.map((r) => q('data', { store: (list.match(new RegExp(`^${r}:[^ ]+`, 'm')) || [r])[0] })))), await q('status'), await renderGraph(loadProject(ROOT))]
    const left = [...new Set(outs.join('\n').match(/CANARY-[A-Z-]+/g) || [])]
    eq(left, [], 'no canary in any graph_data answer, graph_status or the page (the planted passwords among them)')

    console.log('\n13 · a branch against its base (graph_changes): the base\'s models, schemas and migrations read aside')
    const vcs = (...a) => spawnSync('git', ['-C', ROOT, ...a], { encoding: 'utf8' })
    const commit = (m) => { vcs('add', '-A'); vcs('-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', m) }
    vcs('init', '-q', '-b', 'main')
    commit('base')
    vcs('switch', '-q', '-c', 'feat')
    const change = (p, from, to) => { const f = path.join(ROOT, p); const t = readFileSync(f, 'utf8'); if (!t.includes(from)) throw new Error(`fixture edit: ${p}`); writeFileSync(f, t.replace(from, to)) }
    change('rails/db/schema.rb', '    t.text "body"\n', '    t.text "body"\n    t.integer "score", default: 0, null: false\n')
    change('django/orders/models.py', '    quantity = models.PositiveSmallIntegerField(default=1)\n', '    quantity = models.PositiveSmallIntegerField(default=1)\n    gift_wrap = models.BooleanField(default=False)\n')
    change('jpa/src/main/java/com/example/shop/model/Customer.java', '    private String displayName;\n', '    private String displayName;\n\n    @Column(nullable = false)\n    private String locale;\n')
    change('mongoose/src/models/post.js', "  title: { type: String, required: [true, 'CANARY-MONGOOSE-MESSAGE'] },\n", "  title: { type: String, required: [true, 'CANARY-MONGOOSE-MESSAGE'] },\n  pinned: Boolean,\n")
    commit('branch')
    await q('index')
    const changes = await q('changes')
    for (const line of [
      '  + comments.score  column integer, not null, default 0  — rails/db/schema.rb:43',
      '  + orders_orderline.gift_wrap  column boolean, not null  — django/orders/models.py:26',
      '  + customer.locale  column String, not null  — jpa/src/main/java/com/example/shop/model/Customer.java:17',
      '  + posts.pinned  column Boolean, nullable  — mongoose/src/models/post.js:5',
    ]) has(changes, line, `graph_changes: ${line.trim().split('  ')[0]} added, at its line on the branch`)
    ok(!/CANARY-/.test(changes), 'no canary in graph_changes either')
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

// ════ the end ════
console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
