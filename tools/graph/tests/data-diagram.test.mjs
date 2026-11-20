// ════════════════════════════════════════════════════════════════════════════
//  Tests — one data model diagram for every store kind (spec 2026-11-09, amended 2026-11-20):
//  the links no key states (lib/data/links.mjs) and how the Data tab draws them
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/data-diagram.test.mjs
//
//  1. the lead rule on names (idStems, tableStem, placeholders) and on hand-built models: one target per
//     stem or rivals, the same repository only, a logical table counted once, a table's own key no link,
//     a refined relation replacing a lead, links across stores on both sides
//  2. through call(), on an indexed project (fixtures/diagram: a SQLite store with un-keyed `*_id`
//     columns, a DynamoDB store with id-like attributes and two refined relations, a key space with
//     placeholders and a search index, one refined relation across stores): graph_data's leads and
//     links; the page: every diagram in one vocabulary (solid foreign keys, dashed refined, dotted
//     leads, thin extracted), DynamoDB opening as a diagram with its key card as passport, the Fields and
//     Cards switches, an overlay falling back to cards, the key space's Diagram mode, a stub opening the
//     other store on its entity, names escaped
//
//  Part 2 needs the parser runtime (the key space is read from code): without it, it is skipped.
import { mkdtempSync, cpSync, rmSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
process.env.GRIMOIRE_GRAPH_FRESH_MS = '0'

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${hay.split('\n').map((l) => '         ' + l).join('\n')}`}`)
const lacks = (hay, needle, m) => ok(!hay.includes(needle), `${m}${hay.includes(needle) ? `\n       did not expect: ${needle}` : ''}`)
const eq = (got, want, m) => { const g = JSON.stringify(got), w = JSON.stringify(want); ok(g === w, `${m}${g === w ? '' : `\n       want: ${w}\n       got:  ${g}`}`) }

const { idStems, tableStem, placeholders, modelLinks } = await import('../lib/data/links.mjs')

// ── 1 · the lead rule ──
console.log('\n1 · the lead rule (lib/data/links.mjs)')
eq(['orbit_id', 'orbitId', 'actor_user_id', 'ORBIT_ID', 'reactions[].user_id', 'id', 'name', 'identity', 'orbitIds'].map(idStems),
  [['orbit'], ['orbit'], ['actoruser', 'user'], ['orbit'], ['user'], [], [], [], []], 'a name ending in id gives its stems, longest first; `id` alone, `identity` and a plural are none')
eq(['users', 'Orbit', '{env}-{project}-orbit', 'chat_messages', 'categories', '{env}-{project}', 'user:{id}'].map(tableStem), ['user', 'orbit', 'orbit', 'chatmessage', 'category', null, null],
  'a table\'s stem: its name after the last unknown part, singular, no case nor separator; none when nothing literal follows')
eq(placeholders('{}orbit:{orbit_id}:members:{user_id}'), ['orbit_id', 'user_id'], 'a key template\'s placeholders, in order (a hash tag `{}` is none)')
{
  const T = (name, fields, keys = [], extra = {}) => ({ name, kind: 'table', fields: fields.map((n) => ({ name: n })), keys, relations: [], indexes: [], ...extra })
  const pk = (c) => ({ role: 'primary', parts: [c] })
  const model = { stores: [
    { id: 'api:db', repo: 'api', dialect: 'sqlite', entities: [T('users', ['id', 'email'], [pk('id')]), T('orders', ['id', 'user_id', 'coupon_id', 'shop_id'], [pk('id')], { relations: [{ columns: ['user_id'], to: 'users', toColumns: ['id'] }] }), T('shops', ['id'], [pk('id')]), T('shop', ['id'], [pk('id')])] },
    { id: 'api:dynamodb', repo: 'api', dialect: 'dynamodb', entities: [T('carts', ['userId', 'cartId', 'orderId'], [{ role: 'partition', parts: ['userId'] }, { role: 'sort', parts: ['cartId'] }])] },
    { id: 'api:local', repo: 'api', dialect: 'dynamodb', entities: [T('coupons', ['id'], [{ role: 'partition', parts: ['id'] }], { id: 'api:local/coupons', logical: { id: 'L:coupon' } })] },
    { id: 'api:prod', repo: 'api', dialect: 'dynamodb', entities: [T('{env}-coupons', ['id'], [{ role: 'partition', parts: ['id'] }], { id: 'api:prod/{env}-coupons', logical: { id: 'L:coupon' } })] },
    { id: 'web:db', repo: 'web', dialect: 'postgres', entities: [T('sessions', ['id', 'user_id', 'cart_id'], [pk('id')])] },
  ] }
  const L = modelLinks(model, [])
  eq(L.get('api:db').leads.map((x) => `${x.from}.${x.column}→${x.to}.${x.toColumn}`), [], 'a column a foreign key covers is no candidate; a stem two tables share (shop, shops) is no lead')
  eq(L.get('api:db').rivals.map((x) => [x.from, x.column, x.stem, x.targets]), [['orders', 'shop_id', 'shop', ['api:db/shop', 'api:db/shops']]], '… listed as rivals with both targets')
  eq(L.get('api:db').stubs.filter((x) => x.dir === 'out').map((x) => `${x.from}.${x.column}→${x.store}/${x.entity}.${x.toColumn}`), ['orders.coupon_id→api:local/coupons.id'],
    'a lead to another store of the same repository is a stub; a logical table\'s declarations count once (its own store\'s, else the first)')
  eq(L.get('api:dynamodb').stubs.filter((x) => x.dir === 'out').map((x) => `${x.from}.${x.column}→${x.store}/${x.entity}.${x.toColumn}`), ['carts.orderId→api:db/orders.id', 'carts.userId→api:db/users.id'],
    'a key-value attribute naming a SQL table: a stub, ending at its primary key; the table\'s own sort key named after it (`cartId`) is no link')
  eq(L.get('api:db').stubs.filter((x) => x.dir === 'in').map((x) => `${x.from}←${x.store}/${x.entity}.${x.toColumn}`), ['orders←api:dynamodb/carts.orderId', 'users←api:dynamodb/carts.userId'], '… and its stub on the other side')
  eq([L.get('web:db').leads, L.get('web:db').stubs], [[], []], 'never across repositories: web\'s user_id and cart_id name nothing in web')
  const R = modelLinks(model, [{ kind: 'relation', ok: true, from: 'api:db/orders', columns: ['coupon_id'], to: 'api:db/users', toColumns: ['id'], why: 'w' }, { kind: 'relation', ok: false, from: 'api:dynamodb/carts', columns: ['userId'], to: 'api:db/shops', toColumns: ['id'] }, { kind: 'lineage', ok: true, from: 'api:dynamodb/carts', to: 'web:db/sessions', fields: [{ from: 'cartId', to: 'cart_id' }], why: 'm' }])
  eq(R.get('api:db').stubs.filter((x) => x.dir === 'out').length, 0, 'a refined relation replaces the lead on its entity and column, whatever its target (here within the store: the store draws it)')
  eq(R.get('api:dynamodb').stubs.map((x) => `${x.kind}:${x.from}.${x.column}${x.dir === 'out' ? '→' : '←'}${x.store}/${x.entity}`), ['lead:carts.orderId→api:db/orders', 'lead:carts.userId→api:db/users', 'lineage:carts.cartId→web:db/sessions'],
    'a claim that does not hold changes nothing; a lineage claim across repositories is a stub (refined, not a name guess)')
  eq(R.get('web:db').stubs.map((x) => `${x.kind}:${x.from}.${x.column}←${x.store}/${x.entity}`), ['lineage:sessions.cart_id←api:dynamodb/carts'], '… on both sides')
}

// ── 2 · through call(), on fixtures/diagram ──
const deps = await import('../lib/deps.mjs')
if (!deps.findDeps()) {
  if (process.env.CI) { ok(false, 'parser runtime missing (run npm ci --prefix tools/graph)') } else console.log('   - part 2 skipped: parser runtime not installed (npm ci --prefix tools/graph)')
} else {
  const { call } = await import('../lib/commands.mjs')
  const { renderGraph } = await import('../lib/render.mjs')
  const { loadProject } = await import('../lib/project.mjs')
  const { dataOf, stubPage } = await import('./data-kit.mjs')
  const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-diagram-')))
  try {
    console.log('\n2 · fixtures/diagram through call(): graph_data, then the page')
    const P = path.join(SANDBOX, 'shop')
    cpSync(path.join(HERE, 'fixtures', 'diagram'), P, { recursive: true, filter: (s) => !s.split(path.sep).includes('.grimoire') })
    // a table whose name holds markup: escaped wherever it is drawn
    writeFileSync(path.join(P, 'shop/dynamodb/tables/evil.json'), JSON.stringify({ TableName: 'evil<b>x</b>', AttributeDefinitions: [{ AttributeName: 'product_id', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'product_id', KeyType: 'HASH' }] }))
    const q = (tool, args = {}) => call(`graph_${tool}`, args, { root: P })
    const idx = await q('index')
    ok(!/fail/.test(idx), `index: no extractor failure (${idx.replace(/\n/g, ' | ')})`)
    const db = await q('data', { store: 'shop:db' })
    has(db, 'Leads (3), from a name ending in id: a lead from the attribute\'s name, never checked: read the code before relying on it\n  audit_log(actor_user_id) → users(id)  lead: "actor_user_id" names user\n  audit_log(order_id) → orders(id)  lead: "order_id" names order\n  orders(coupon_id) → coupons(id)  lead: "coupon_id" names coupon',
      'graph_data, a SQL store: a column no foreign key covers, named like an id, is a lead (the longest stem first, `actor_user_id` → user); one a foreign key covers (`user_id`) is not')
    has(db, '  users(id) ← shop:dynamodb/reviews(ownerId)  refined: a review\'s owner is a user of the SQL store', 'graph_data: a refined relation from another store, on the referenced side')
    has(db, '  users(id) ← shop:redis/user:{userId}:session(userId)  lead: "userId" names user', 'graph_data: a key template\'s placeholder naming a table of another store')
    const kv = await q('data', { store: 'shop:dynamodb' })
    has(kv, 'Leads (2), from a name ending in id', 'graph_data, a DynamoDB store: its leads')
    has(kv, '  cart_items(productId) → products(id)  lead: "productId" names product', '… an attribute naming a table of the store')
    lacks(kv, 'cart_items(cartId) → carts', 'a refined relation replaces the lead on its column (cart_items.cartId)')
    lacks(kv, 'carts(cartId) → carts', 'a table\'s own key named after it is no link')
    has(kv, '  carts(userId) → shop:db/users(id)  lead: "userId" names user', 'a stub to the SQL store, ending at its primary key')
    has(kv, '  carts(cartId) ← shop:redis/cart:{cartId}(cartId)  refined: the cart cache is keyed by the cart\'s id', 'a refine claim may name a key template\'s placeholder as its column (D7): it holds, and replaces the lead')
    const ks = await q('data', { store: 'shop:redis' })
    has(ks, '  product:{productId}(productId) → shop:dynamodb/products(id)  lead: "productId" names product', 'graph_data, a key space: a placeholder naming a key-value table is a lead')
    has(await q('data'), '4 claims hold · 0 drifts', 'every claim holds, the one on a placeholder included')
    has(await q('data', { entity: 'shop:dynamodb/reviews' }), 'Links to other stores (1):\n  reviews(ownerId) → shop:db/users(id)  refined: a review\'s owner is a user of the SQL store', 'graph_data, an entity: its own links')

    const page = await renderGraph(loadProject(P))
    const D = dataOf(page).data
    const at = (id) => D.stores.findIndex((s) => s.id === id)
    const S = D.stores[at('shop:db')], K = D.stores[at('shop:dynamodb')], X = D.stores[at('shop:redis')]
    eq(S.tables.find((t) => t.name === 'orders').rels.map((r) => [r.columns[0], r.to, r.ld ? 'lead' : r.rf ? 'refined' : 'fk']), [['user_id', 'users', 'fk'], ['coupon_id', 'coupons', 'lead']], 'the SQL store packs a lead after its foreign keys, as a relation of its own kind')
    eq(S.tables.find((t) => t.name === 'orders').fields.find((f) => f.name === 'coupon_id').fk, 0, '… its column gets no FK mark: a lead is never a foreign key')
    eq(K.tables.find((t) => t.name === 'reviews').rels.map((r) => [r.columns[0], r.to, r.rf ? 'refined' : r.ld ? 'lead' : 'fk']), [['productRef', 'products', 'refined']], 'the DynamoDB store packs its refined relations as lines (they were only listed)')
    ok(K.links.st.every((x) => x.n === at(x.store)), 'every stub knows the index of the store it opens')
    lacks(page, 'evil<b>', 'a table name holding markup never reaches the page as markup')

    // the SQL ERD: one vocabulary, stubs at its right edge
    const sp = await stubPage(page, `#data-${at('shop:db')}`)
    const sql = sp.erd().html
    has(sql, 'class="fk ld', 'the SQL ERD: a lead is a dotted line')
    ok((sql.match(/data-stub="/g) || []).length === 3, `the SQL ERD: one stub per other entity a link reaches, two links to one entity sharing it (carts, reviews, user:{userId}:session: ${(sql.match(/data-stub="/g) || []).length})`)
    has(sp.text(), 'lead: from a name ending in id, never checked', 'the legend names the lead, beside the ERD\'s own')

    // DynamoDB: a diagram by default, the key card as passport, Fields and Cards
    const kp = await stubPage(page, `#data-${at('shop:dynamodb')}`)
    const kd = kp.erd()
    ok(!!kd && /DynamoDB/.test(kd.html), 'a DynamoDB store opens as a diagram: a box per table, its kind in the header')
    has(kd.html, 'class="mk msk"', '… its sort keys marked SK')
    has(kd.html, 'class="mk mttl"', '… its time to live marked TTL')
    has(kd.html, 'GSI ByOwner (ownerId) all', '… each GSI as a row with its keys and projection')
    has(kd.html, 'class="fk rf', '… a refined relation dashed')
    has(kd.html, 'class="fk ld', '… a lead dotted')
    has(kd.html, 'evil&lt;b&gt;x&lt;/b&gt;', '… a table name escaped')
    eq(kp.ctl('data-kv-compact').attrs['aria-pressed'], 'true', 'compact by default')
    kp.press('data-kv-fields')
    eq(kp.ctl('data-kv-fields').attrs['aria-pressed'], 'true', 'Fields draws every field')
    const ti = K.tables.findIndex((t) => t.name === 'reviews')
    kp.click(ti)
    ok(kp.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || '')).length === 1, 'a click on a table opens its key card beside the diagram')
    kp.press('data-kv-cards')
    ok(!kp.erd() && kp.all((n) => n.tagName === 'ARTICLE' && /\bkcard\b/.test(n.attrs.class || '')).length === K.tables.length, 'Cards draws a key card per table, as before')
    kp.press('data-kv-diagram')
    ok(!!kp.erd(), '… and Diagram back')
    // a stub opens the other store on its entity
    const k2 = await stubPage(page, `#data-${at('shop:dynamodb')}`)
    const box = k2.erd()
    const stubs = [...box.html.matchAll(/<g class="stub[^"]*" data-stub="(\d+)"[^>]*aria-label="([^"]*)"/g)].map((m) => [m[1], m[2]])
    const toUsers = stubs.find(([, l]) => l === 'shop:db: users')
    ok(!!toUsers, `a stub names the other store and entity (${stubs.map(([, l]) => l).join(' · ')})`)
    box.firstChild.on.click[0]({ target: { closest: (sel) => (/data-stub/.test(sel) ? { dataset: { stub: toUsers[0] } } : null) } })
    has(k2.text(), 'shop:db', 'a click on a stub opens the other store')
    ok(k2.all((n) => /\bpassport\b/.test((n.attrs && n.attrs.class) || '')).some((n) => /users/.test(k2.textOf(n))), '… on that entity, its passport open')

    // the key space: its tree by default, a Diagram mode
    const xp = await stubPage(page, `#data-${at('shop:redis')}`)
    ok(!xp.erd(), 'a key space opens as its prefix tree')
    xp.press('data-ks-diagram')
    const xd = xp.erd().html
    has(xd, 'class="mk mkey"', 'the key space\'s diagram: a template\'s placeholders marked KEY')
    has(xd, 'class="fk ex', '… a search index\'s PREFIX coverage a thin line')
    has(xd, 'shop:dynamodb', '… a placeholder naming a key-value table a stub')
    eq(X.links.st.filter((x) => x.dir === 'out').map((x) => `${x.from}(${x.column})→${x.store}/${x.entity}`), ['user:{userId}:session(userId)→shop:db/users', 'cart:{cartId}(cartId)→shop:dynamodb/carts', 'product:{productId}(productId)→shop:dynamodb/products'], 'its stubs, packed, by store then entity')

    // an overlay on a key-value store: its cards, with a note
    const { execFileSync } = await import('node:child_process')
    const g = (...a) => execFileSync('git', ['-C', P, ...a], { stdio: 'pipe' })
    g('init', '-q', '-b', 'main'); g('add', '-A'); g('-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
    writeFileSync(path.join(P, 'shop/dynamodb/tables/products.json'), JSON.stringify({ TableName: 'products', AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }, { AttributeName: 'sku', AttributeType: 'S' }], KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }], GlobalSecondaryIndexes: [{ IndexName: 'BySku', KeySchema: [{ AttributeName: 'sku', KeyType: 'HASH' }], Projection: { ProjectionType: 'ALL' } }] }))
    await q('index')
    const op = await stubPage(await renderGraph(loadProject(P), { base: 'main' }), `#data-${at('shop:dynamodb')}`)
    op.press('data-changes')
    ok(!op.erd() && !!op.ctl('data-kv-overlay'), 'with Changes on, a key-value store draws its cards and says the diagram draws no overlay yet')

    // a claim naming a placeholder the template does not have: drift, never drawn
    writeFileSync(path.join(P, 'docs/architecture/bad.data.json'), JSON.stringify({ schema: 1, title: 'bad', summary: 's', relations: [{ from: 'shop:redis/cart:{cartId}', columns: ['userId'], to: 'shop:db/users', toColumns: ['id'], why: 'w', sources: ['shop:src/cache.ts:4'] }] }, null, 2))
    has(await q('data'), 'the column userId is not in shop:redis/cart:{cartId}', 'a claim naming a placeholder the template lacks is drift')
  } finally { rmSync(SANDBOX, { recursive: true, force: true }) }
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
