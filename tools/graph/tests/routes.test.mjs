// ════════════════════════════════════════════════════════════════════════════
//  Tests — routes in the code graph (tools/graph: lib/routes.mjs, lib/route-graph.mjs)
// ════════════════════════════════════════════════════════════════════════════
//
//  Run:  node tools/graph/tests/routes.test.mjs
//
//  1. the pieces: a URL as code names it (hashed, its host, credentials and query dropped), templates,
//     matching, joining prefixes
//  2. fixtures/routes, one repository per framework (Express, NestJS, FastAPI, Spring, gin, Rails,
//     Django, Next.js, Expo Router, React Navigation): each route with its composed path, its handler
//     and its callers in code and tests, through the same call() the MCP server uses
//  3. graph_impact, graph_symbol, graph_overview and graph_diff use them: a test calling a route is a
//     test on its handler's path
//  4. incremental: a route added in one repository links a caller in another whose file did not change;
//     a caller removed leaves; no literal's text in any answer or in the index
//
//  Needs the parser runtime (npm ci --prefix tools/graph); skipped without it, except under CI.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, cpSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

if (!process.execArgv.includes('--liftoff-only')) {
  const r = spawnSync(process.execPath, ['--no-warnings', '--liftoff-only', fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, GRIMOIRE_GRAPH_FRESH_MS: '0' } })
  process.exit(r.status ?? 1)
}
const { findDeps } = await import('../lib/deps.mjs')
if (!findDeps()) {
  if (process.env.CI) { console.log('   ✗ FAIL: parser runtime missing (run npm ci --prefix tools/graph)'); process.exit(1) }
  console.log('   - skipped: parser runtime not installed (npm ci --prefix tools/graph)')
  process.exit(0)
}
const { call } = await import('../lib/commands.mjs')
const { urlPattern, hashSeg, joinPath, UNKNOWN } = await import('../lib/routes.mjs')
const { templateSegs, matchSegs } = await import('../lib/route-graph.mjs')

let PASS = 0, FAIL = 0
const ok = (c, m) => { if (c) { PASS++; console.log(`   ✓ ${m}`) } else { FAIL++; console.log(`   ✗ FAIL: ${m}`) } }
const show = (hay) => hay.split('\n').map((l) => '         ' + l).join('\n')
const has = (hay, needle, m) => ok(hay.includes(needle), `${m}${hay.includes(needle) ? '' : `\n       expected to find: ${needle}\n       in:\n${show(hay)}`}`)
const lacks = (hay, needle, m) => ok(!hay.includes(needle), `${m}${hay.includes(needle) ? `\n       did not expect: ${needle}\n       in:\n${show(hay)}` : ''}`)
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' })

// ── 1 · the pieces ──
console.log('\n1 · URLs, templates, matching')
{
  const u = urlPattern('https://admin:secret@books.example.com/api/books?key=k#top')
  ok(u && !u.lead && u.toks.length === 2 && u.toks[0] === hashSeg('api') && u.toks[1] === hashSeg('books'), 'a full URL: its scheme, host, credentials, query and fragment dropped; its segments hashed')
  ok(!JSON.stringify(u).includes('books'), '… no segment\'s text in what is kept')
  const t = urlPattern('/api/books/\0/cover')
  ok(t && t.toks[2] === '*' && !t.lead, 'a part the code fills in is one unknown segment')
  ok(urlPattern('\0/users/me')?.lead === true, 'a leading part the code fills in is an unknown prefix')
  ok(urlPattern('users/me') === null && urlPattern('users/me', { inCall: true })?.lead === true, 'a relative path only as a client call\'s URL, and then with an unknown prefix')
  ok(urlPattern('/') === null && urlPattern('/42') === null && urlPattern('hello world') === null && urlPattern('/a b') === null && urlPattern('ftp://x/a') === null, 'no letter, a space or another scheme: no URL')
  ok(urlPattern('/post/[id]').toks[1] === '*' && urlPattern('/users/{id}').toks[1] === '*' && urlPattern('/a/:id').toks[1] === '*' && urlPattern('/a/%s').toks[1] === '*', 'a template\'s parameter in a call (`[id]`, `{id}`, `:id`, `%s`) is one unknown segment')
  const segs = (p) => templateSegs(p).map((s) => s.t).join('')
  ok(segs('/a/:id') === 'LP' && segs('/a/{id}') === 'LP' && segs('/a/[id]') === 'LP' && segs('/a/<int:pk>/') === 'LP' && segs(`${UNKNOWN}/a`) === 'ML' && segs('/a/[...rest]') === 'LM' && segs('/a/*') === 'LM' && segs('/files/{path...}') === 'LM', 'templates: literals, parameters, and what takes any number of segments')
  const m = (route, url, lead = false) => matchSegs(templateSegs(route), urlPattern(url, {}).toks, lead || urlPattern(url).lead)
  ok(m('/api/books/:id', '/api/books/7')?.params === 1, 'a literal fills a parameter')
  ok(m('/api/books/:id', '/api/books') === null && m('/api/books', '/api/books/7') === null, 'segment counts must agree')
  ok(m(`${UNKNOWN}/users/me`, '/api/v1/users/me')?.lits === 2, 'an unknown prefix of the route absorbs the call\'s leading segments')
  ok(m('/api/v1/users/me', '\0/users/me')?.lits === 2, 'an unknown prefix of the call absorbs the route\'s')
  ok(m('/articles/feed', '/articles/\0') === null, 'a part the code fills in never stands for a literal of the route')
  ok(joinPath('/api', '/') === '/api/' && joinPath('', '') === '/' && joinPath('/api/', 'users') === '/api/users' && joinPath(UNKNOWN, '/me') === `${UNKNOWN}/me`, 'prefixes join with one slash')
}

// ── 1b · one file's declarations, for the frameworks no fixture repository holds ──
console.log('\n1b · declarations, file by file')
{
  const { loadRuntime } = await import('../lib/deps.mjs')
  const { extract } = await import('../lib/extract.mjs')
  const { extractRoutes } = await import('../lib/routes.mjs')
  const rt = await loadRuntime({ install: false })
  const read = async (lang, rel, src) => { const p = await rt.parserFor(lang); const t = p.parse(src); try { const r = extract(t, lang, false); return extractRoutes(t, lang, rel, r) || { routes: [], refs: [], scopes: [], mounts: [] } } finally { t.delete() } }
  const rows = (f) => f.routes.map((r) => `${r.method} ${r.path} ${r.handler ? `${r.handler.qual ? r.handler.qual + '.' : ''}${r.handler.name}` : '-'}${r.middleware.length ? ` [${r.middleware.join(',')}]` : ''}`)
  const koa = await read('javascript', 'src/r.js', "const Router = require('@koa/router')\nconst router = new Router({ prefix: '/api' })\nrouter.get('/users', auth, list)\n")
  ok(rows(koa).includes('GET /users list [auth]') && koa.scopes.some((x) => x.prefix === '/api'), `koa: new Router({ prefix }), its prefix the router's (${rows(koa)})`)
  ok(koa.scopes[0]?.factory === 'router', 'koa: … a router nothing mounts here (its prefix composed later, under {…} when nothing mounts it)')
  const hono = await read('typescript', 'src/h.ts', "import { Hono } from 'hono'\nconst app = new Hono()\nconst books = new Hono()\nbooks.get('/:id', (c) => c.json({}))\napp.route('/books', books)\n")
  ok(rows(hono).includes('GET /:id -') && hono.mounts.some((m) => m.prefix === '/books' && m.child.var), `hono: a sub-app and app.route('/books', sub) as a mount (${rows(hono)})`)
  const fst = await read('javascript', 'src/f.js', "const fastify = require('fastify')()\nfastify.route({ method: ['GET', 'HEAD'], url: '/items/:id', preHandler: [auth], handler: getItem })\nfastify.register(require('./admin'), { prefix: '/admin' })\n")
  ok(rows(fst).includes('GET,HEAD /items/:id getItem [auth]'), `fastify: the object form (${rows(fst)})`)
  const express = await read('javascript', 'src/e.js', "const express = require('express')\nconst app = express()\napp.use(express.json())\napp.get(['/a', '/b'], h)\n")
  ok(rows(express).includes('GET /a h [express.json(…)]') && rows(express).includes('GET /b h [express.json(…)]'), `express: an array of paths, the app's use() before them as middleware (${rows(express)})`)
  const chi = await read('go', 'main.go', 'package main\nimport "github.com/go-chi/chi/v5"\nfunc routes() {\n\tr := chi.NewRouter()\n\tr.Use(Logger)\n\tr.Route("/articles", func(r chi.Router) {\n\t\tr.With(Paginate).Get("/", ListArticles)\n\t\tr.Post("/", CreateArticle)\n\t})\n}\n')
  ok(rows(chi).includes('GET / ListArticles [Logger,Paginate]') && rows(chi).includes('POST / CreateArticle [Logger]'), `chi: r.Route's closure, r.With(mw), the router's Use(mw) before them (${rows(chi)})`)
  ok(chi.scopes.some((s) => s.prefix === '/articles' && s.key.startsWith('p:')), 'chi: … the closure\'s router under /articles')
  const gorilla = await read('go', 'main.go', 'package main\nimport "github.com/gorilla/mux"\nfunc routes() {\n\tr := mux.NewRouter()\n\ts := r.PathPrefix("/api").Subrouter()\n\ts.HandleFunc("/users/{id}", GetUser).Methods("GET", "PUT")\n}\n')
  ok(rows(gorilla).includes('GET,PUT /users/{id} GetUser') && gorilla.scopes.some((x) => x.prefix === '/api'), `gorilla: .Methods(…), PathPrefix(…).Subrouter() (${rows(gorilla)})`)
  const nethttp = await read('go', 'main.go', 'package main\nimport "net/http"\nfunc routes() {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("GET /items/{id}", getItem)\n\thttp.HandleFunc("/health", health)\n}\n')
  ok(rows(nethttp).includes('GET /items/{id} getItem') && rows(nethttp).includes('ANY /health health'), `net/http: a method in the pattern, the default mux (${rows(nethttp)})`)
  const echo = await read('go', 'main.go', 'package main\nimport "github.com/labstack/echo/v4"\nfunc routes() {\n\te := echo.New()\n\tg := e.Group("/admin")\n\tg.GET("/users", listUsers, requireAdmin)\n}\n')
  ok(rows(echo).includes('GET /users listUsers [requireAdmin]') && echo.scopes.some((x) => x.prefix === '/admin'), `echo: its middleware after the handler, a group (${rows(echo)})`)
  const client = await read('go', 'client.go', 'package main\nimport "net/http"\nfunc load() {\n\thttp.Get("/api/items")\n}\n')
  ok(!client.routes.length && client.refs.length === 1 && client.refs[0].method === 'GET', 'go: http.Get(url) is a call site, not a route')
  const flask = await read('python', 'app.py', "from flask import Flask, Blueprint\napp = Flask(__name__)\nbp = Blueprint('admin', __name__, url_prefix='/admin')\n\n@bp.route('/users', methods=['GET', 'POST'])\n@login_required\ndef users():\n    pass\n\napp.register_blueprint(bp)\n")
  ok(rows(flask).includes('GET,POST /users users [login_required]') && flask.scopes.some((s) => s.prefix === '/admin'), `flask: a blueprint's url_prefix, methods=, another decorator as middleware (${rows(flask)})`)
  const drf = await read('python', 'api/urls.py', "from rest_framework.routers import DefaultRouter\nrouter = DefaultRouter()\nrouter.register(r'articles', ArticleViewSet)\nurlpatterns = [path('api/', include(router.urls))]\n")
  ok(rows(drf).includes('ANY /articles/ ArticleViewSet') && rows(drf).includes('ANY /articles/{pk}/ ArticleViewSet') && drf.mounts.some((m) => m.prefix === '/api/'), `django rest framework: a viewset's list and detail routes, included (${rows(drf)})`)
  const axios = await read('typescript', 'src/api.ts', "import axios from 'axios'\nexport const add = (data) => axios.post('/api/items', data)\n")
  ok(!axios.routes.length && axios.refs[0]?.method === 'POST', 'a client call with data is a call site, not a route')
  const nav = await read('tsx', 'src/x.tsx', "export function A({ navigation }) { return <Link screen=\"Profile\" /> }\n")
  ok(nav.refs.some((r) => r.named && r.kind === 'screen'), '<Link screen="X"> names a screen')
  // a declaration's path is its template only: no scheme, host, credentials, query or fragment; a
  // segment shaped like a credential is {…}; a Rails `to:` that is a URL is no handler
  const { routePath } = await import('../lib/routes.mjs')
  const rp = ['https://u:canary-route-50@h.example.com/new?x=canary-route-51', '/users/:id?', '/users/:id?/x', '/x?token=canary-route-52', '/a#canary-route-53', '//cdn.example.com/x', 'u:canary-route-54@host/x', '/hooks/AbCdEf1234567890XyZw12/x', '/k/sk_live_canary', '/api/{…}/x', '/@me', '/'].map(routePath)
  ok(JSON.stringify(rp) === JSON.stringify(['/new', '/users/:id?', '/users/:id?/x', '/x', '/a', '/x', '/x', '/hooks/{…}/x', '/k/{…}', '/api/{…}/x', '/@me', '/']), `routePath: the path template only, an optional parameter kept (${rp.join(' ')})`)
  const urls = await read('javascript', 'src/u.js', "const express = require('express')\nconst app = express()\nconst r = express.Router()\napp.get('https://admin:canary-route-55@api.example.com/v1/items?key=canary-route-56#canary-route-57', h)\napp.use('http://canary-route-58.example.com/mnt?k=canary-route-59', r)\nr.get('/webhook/ZxCvBnM1234567890QwErTy', w)\n")
  ok(rows(urls).includes('GET /v1/items h') && rows(urls).includes('GET /webhook/{…} w') && urls.mounts.some((m) => m.prefix === '/mnt') && !/canary-route|example\.com|ZxCvBnM/.test(JSON.stringify(urls)), `express: a route or a mount written as a URL keeps its path alone; a credential-shaped segment is {…} (${rows(urls)})`)
  const rails = await read('ruby', 'config/routes.rb', "Rails.application.routes.draw do\n  get '/old', to: redirect('https://u:canary-route-60@h/new?x=canary-route-61')\n  get '/p', to: 'https://u:canary-route-62@h/#canary'\n  get '/q', to: 'posts#show'\n  get 'https://canary-route-63.example.com/r?x=1', to: 'admin/posts#index'\nend\n")
  ok(rows(rails).includes('GET /p -') && rows(rails).includes('GET /q posts.show') && rows(rails).includes('GET /r admin/posts.index') && !/canary/.test(JSON.stringify(rails.routes)), `rails: a \`to:\` that is a URL is no handler; a path written as a URL keeps its path (${rows(rails)})`)
}

// ── 2 · the fixtures ──
console.log('\n2 · fixtures/routes: one repository per framework')
const SANDBOX = realpathSync(mkdtempSync(path.join(tmpdir(), 'grimoire-routes-')))
const P = path.join(SANDBOX, 'routes')
cpSync(path.join(HERE, 'fixtures', 'routes'), P, { recursive: true, filter: (src) => !src.split(path.sep).includes('.grimoire') })
for (const repo of ['express', 'nest', 'fastapi', 'spring', 'gin', 'rails', 'django', 'next', 'expo', 'rnav']) {
  const d = path.join(P, repo)
  git(d, 'init', '-q', '-b', 'main'); git(d, 'add', '-A'); git(d, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'init')
}
const q = (tool, args = {}) => call(`graph_${tool}`, args, { root: P })
const answers = []
const ask = async (tool, args) => { const a = await q(tool, args); answers.push(a); return a }
await q('index')
const all = await ask('routes')
has(all, 'Routes (47: 41 http, 6 screen)', 'graph_routes: every route, by kind')

// Express: a mounted router, a `.route()` chain, middleware, a test and a client by URL
has(all, 'GET /api/books/  → listBooks  express/src/controllers/books.js:3', 'express: a router mounted at a prefix (`app.use(\'/api/books\', router)`, the router from another file), its handler imported')
has(all, 'PUT /api/books/:id/cover  → updateCover', 'express: a `.route(\'/x\').put(…)` chain')
has(all, 'GET /health  → inline', 'express: an inline handler is no definition, said so')
const cover = await ask('routes', { query: 'PUT /api/books/:id/cover' })
has(cover, 'middleware (where the syntax shows it): auth.required', 'express: the middleware before the handler')
has(cover, 'express/test/books.test.js:11  in testCover  (template)  test', 'express: a test reaching the route by a concatenated URL')
const one = await ask('routes', { query: '/api/books/:id', method: 'GET' })
has(one, 'express/src/client.js:2  in fetchBook  (template)', 'express: a client\'s template literal URL, with the method its options state')
const list = await ask('routes', { query: 'GET /api/books/' })
has(list, 'express/test/books.test.js:6  at file level  (exact)  test', 'express: supertest\'s `request(app).get(\'/api/books\')` (trailing slash aside)')

// NestJS: the controller's prefix, each method's decorator, the global prefix, guards
has(all, 'GET /api/cats/:id  → CatsController.findOne  nest/src/cats/cats.controller.ts:15', 'nest: @Controller + @Get(\':id\') under setGlobalPrefix(\'api\'), the decorated method its handler')
const nestPost = await ask('routes', { query: 'POST /api/cats' })
has(nestPost, 'middleware (where the syntax shows it): AuthGuard', 'nest: @UseGuards on the method')
has(await ask('routes', { query: '/api/cats/:id' }), 'nest/test/cats.e2e-spec.ts:5  at file level  (template)  test', 'nest: an e2e test by URL')

// FastAPI: APIRouter(prefix=…), include_router(…, prefix=a constant) as {…}, a test and a generated client
const me = await ask('routes', { query: '/users/me', method: 'GET' })
has(me, `GET ${UNKNOWN}/users/me  (http, python)`, 'fastapi: the router\'s prefix, under a prefix the code computes (settings.API_V1_STR) kept as {…}')
has(me, 'fastapi/backend/tests/api/routes/test_users.py:5  in test_get_users_me  (exact)  test', 'fastapi: a test\'s f-string URL, its leading constant an unknown prefix')
has(me, 'fastapi/frontend/src/client/sdk.gen.ts:5  in UsersService.readUserMe  (prefix unknown)', 'fastapi: a generated client\'s `{ method, url }`')
const patch = await ask('routes', { query: '/users/me', method: 'PATCH' })
lacks(patch, 'sdk.gen.ts', 'fastapi: a client call stating GET does not reach the PATCH route')
has(patch, 'middleware (where the syntax shows it): get_current_user', 'fastapi: dependencies=[Depends(x)]')
has(all, `GET ${UNKNOWN}/items/  → read_items`, 'fastapi: include_router(items.router, prefix="/items")')

// Spring: class @RequestMapping + method mappings
has(all, 'GET /api/owners/{ownerId}  → OwnerController.show', 'spring: @RequestMapping on the class + @GetMapping("/{ownerId}")')
has(all, 'POST /api/owners/{ownerId}/pets  → OwnerController.addPet', 'spring: @RequestMapping(value, method = RequestMethod.POST)')
const owner = await ask('routes', { query: 'GET /api/owners/{ownerId}' })
has(owner, 'spring/src/test/java/org/clinic/owner/OwnerControllerTests.java:8  in OwnerControllerTests.showOwner  (template)  test', 'spring: MockMvc\'s get("/api/owners/{id}", 1)')
has(await ask('routes', { query: 'POST /api/owners' }), 'middleware (where the syntax shows it): PreAuthorize', 'spring: an annotation beside the mapping')

// gin: groups passed to a register function in another package
has(all, 'GET /api/articles/  → ArticleList  gin/articles/routers.go:10', 'gin: r.Group("/api") → v1.Group("/articles") passed to a register function: the route composes through the call')
has(all, 'POST /api/users/login  → UsersLogin', 'gin: … in another package too')
const art = await ask('routes', { query: 'GET /api/articles/' })
has(art, 'gin/articles/unit_test.go:14  in TestArticleListEndpoint  (exact)  test', 'gin: the test hitting the URL with http.NewRequest')
has(await ask('routes', { query: 'POST /api/users/login' }), 'middleware (where the syntax shows it): AuthRequired', 'gin: a handler before the last is middleware')

// Rails: resources, nesting, member, namespace, root, a request spec
for (const [line, what] of [['GET /posts  → PostsController.index', 'index'], ['POST /posts  → PostsController.create', 'create'], ['GET /posts/new  → PostsController.new', 'new'], ['GET /posts/:id/edit  → PostsController.edit', 'edit'], ['GET /posts/:id  → PostsController.show', 'show'], ['PATCH,PUT /posts/:id  → PostsController.update', 'update'], ['DELETE /posts/:id  → PostsController.destroy', 'destroy']]) has(all, line, `rails: resources :posts → ${what}`)
has(all, 'POST /posts/:post_id/comments  → CommentsController.create', 'rails: nested resources, only:')
lacks(all, 'GET /posts/:post_id/comments  ', 'rails: … only the actions listed')
has(all, 'POST /posts/:id/publish  → PostsController.publish', 'rails: a member route')
has(all, 'GET /admin/photos/:id  → Admin.PhotosController.show', 'rails: a namespace, its controller in the module')
has(all, 'GET /  → PagesController.home', 'rails: root')
has(await ask('routes', { query: 'POST /posts/:id/publish' }), 'rails/spec/requests/posts_spec.rb:9  at file level  (template)  test', 'rails: a request spec\'s interpolated URL')

// Django, Next.js
has(all, '* /blog/<int:pk>/  → PostDetail  django/blog/views.py:5', 'django: include("blog.urls") under ROOT_URLCONF, a class view\'s as_view()')
has(await ask('routes', { query: '/blog/<int:pk>/' }), 'django/blog/test_views.py:2  in test_detail  (template)  test', 'django: a test client\'s URL')
has(all, 'GET /api/users  → GET  next/app/api/users/route.ts:1', 'next: an App Router route file\'s exported GET')
has(all, '* /api/hello  → handler  next/pages/api/hello.ts:1', 'next: pages/api, its default export')
lacks(all, 'next/app/page.tsx', 'next: a page is no route of this model, and no screen (no expo-router in that package)')
has(await ask('routes', { query: 'POST /api/users', repo: 'next' }), 'next/src/users.ts:7  in addUser  (exact)', 'next: fetch with { method: \'POST\' } reaches the POST route only')

// Expo Router: files are screens; groups, index, layouts, +not-found; API routes
has(all, 'SCREEN /  → Home  expo/app/(tabs)/index.tsx:3', 'expo: (tabs)/index.tsx is /')
has(all, 'SCREEN /post/[id]  → PostScreen  expo/app/post/[id].tsx:3', 'expo: [id] is a parameter, the default export the screen')
lacks(all, 'RootLayout', 'expo: _layout is a layout, not a route')
lacks(all, 'NotFound', 'expo: +not-found is no route')
const post = await ask('routes', { query: '/post/[id]' })
has(post, 'expo/app/(tabs)/index.tsx:5  in Home  (template)', 'expo: <Link href={{ pathname: \'/post/[id]\' }}>')
has(post, 'expo/__tests__/home.test.tsx:4  at file level  (template)  test', 'expo: router.push(\'/post/42\') in a test')
has(await ask('routes', { query: '/profile/[user]' }), 'in openProfile  (template)', 'expo: router.push(`/profile/${user}`)')
const hello = await ask('routes', { query: '/api/hello', repo: 'expo' })
has(hello, 'GET /api/hello  (http, expo-router)', 'expo: an +api file is an HTTP route')
has(hello, 'expo/components/HelloButton.tsx:2  in HelloButton.load', 'expo: fetch(\'/api/hello\') reaches it')
lacks(await ask('routes', { query: '/api/hello', repo: 'next' }), 'HelloButton', 'a tie between repositories goes to the caller\'s own')

// React Navigation: screens by name, callers by name
has(all, 'SCREEN Demo  → DemoScreen  rnav/screens/DemoScreen.tsx:3', 'react-navigation: <Stack.Screen name component>')
has(all, 'SCREEN Settings  → SettingsScreen', 'react-navigation: a static config\'s screens')
const demo = await ask('routes', { query: 'Demo', kind: 'screen' })
has(demo, 'rnav/screens/WelcomeScreen.tsx:3  in WelcomeScreen.goNext  (name)', 'react-navigation: navigation.navigate(\'Demo\')')
has(demo, 'rnav/__tests__/navigation.test.tsx:4  at file level  (name)  test', 'react-navigation: … from a test')
has(await ask('routes', { query: 'Settings', kind: 'screen' }), 'rnav/screens/DemoScreen.tsx:5  in DemoScreen.back  (name)', 'react-navigation: a nested { screen: \'Settings\' }')

// ── 3 · the other tools use them ──
console.log('\n3 · impact, symbol, overview, diff')
const imp = await ask('impact', { target: 'read_user_me' })
has(imp, 'UsersService.readUserMe:4  d1 [route]', 'impact: the client calling the route reaches its handler')
has(imp, 'Routes it handles (1', 'impact: the route it handles')
has(imp, 'test_get_users_me  function test  fastapi/backend/tests/api/routes/test_users.py:4  d1', 'impact: a test calling the route is a test on the path')
const scr = await ask('impact', { target: 'expo/app/post/[id].tsx' })
has(scr, 'Home:3  d1 [route]', 'impact on a screen file: the code navigating to it')
has(scr, 'SCREEN /post/[id]', 'impact on a screen file: its route')
const dm = await ask('impact', { target: 'DemoScreen' })
lacks(dm, 'rnav/App.tsx  :13', 'impact: the route\'s declaration naming the screen is no unexplained mention')
const sym = await ask('symbol', { symbol: 'ArticleList' })
has(sym, 'routes: GET /api/articles/', 'symbol: the routes it handles')
has(sym, 'tests reaching it 1', 'symbol: the test reaching it by URL counts')
const ov = await ask('overview', { repo: 'gin' })
has(ov, 'routes: 4 http · top prefixes /api/articles (2), /api/users (2)', 'overview: route count and top prefixes')
has(ov, 'Route handlers and screens', 'overview: route handlers listed as entry points through HTTP')
const entries = ov.split('Entry points')[1].split('Route handlers')[0]
ok(!entries.includes('ArticleList'), 'overview: a handler is not among the plain entry points')
has(await ask('overview', { repo: 'gin' }), 'articles  1 file(s) · tests reach 100%', 'overview: a test reaching a handler by URL counts in test reach (with the handlers it passes as values, all of them)')

// graph_diff: the handler changed, its test reaches it only by URL
{
  const f = path.join(P, 'gin/articles/routers.go')
  writeFileSync(f, readFileSync(f, 'utf8').replace('gin.H{"articles": []string{}}', 'gin.H{"articles": []string{}, "count": 0}'))
  const d = await ask('diff', { base: 'HEAD', repo: 'gin' })
  has(d, '~ ArticleList  function  gin/articles/routers.go:10  body', 'diff: the handler changed')
  has(d, 'Routes these changes handle (1)', 'diff: the routes it handles')
  has(d, 'gin/articles/unit_test.go  (distance 1)', 'diff: the test calling its URL is a test to run')
  lacks(d.split('Changed code no test reaches')[1] || '', 'ArticleList', 'diff: … and the handler is not "no test reaches"')
  git(path.join(P, 'gin'), 'checkout', '-q', '--', '.')
}

// ── 4 · incremental, and no literal ──
console.log('\n4 · incremental, literals')
{
  // a route added in one repository links a caller elsewhere whose file did not change
  const before = await q('routes', { query: '/api/books/:id/reviews' })
  has(before, 'No route matches', 'no reviews route yet')
  writeFileSync(path.join(P, 'express/src/client.js'), readFileSync(path.join(P, 'express/src/client.js'), 'utf8') + "\nasync function reviews(id) {\n  return fetch(`/api/books/${id}/reviews`)\n}\n")
  await q('index')
  const r = path.join(P, 'express/src/routes/books.js')
  writeFileSync(r, readFileSync(r, 'utf8').replace("router.get('/:id', getBook)", "router.get('/:id', getBook)\nrouter.get('/:id/reviews', getBook)"))
  const after = await q('routes', { query: '/api/books/:id/reviews' })
  has(after, 'express/src/client.js:9  in reviews  (template)', 'a new route links a caller in a file that did not change')
  const t = path.join(P, 'express/test/books.test.js')
  writeFileSync(t, readFileSync(t, 'utf8').replace("request(app).get('/api/books')", 'request(app).get(listUrl)'))
  lacks(await q('routes', { query: 'GET /api/books/' }), 'books.test.js:6', 'a caller removed is gone on the next query')
  const sql = await q('sql', { sql: "SELECT count(*) AS n FROM edges WHERE kind = 'ROUTES_TO'" })
  ok(/\b\d+\b/.test(sql) && !/\b0\b/.test(sql.split('\n')[1] || ''), `graph_sql sees the ROUTES_TO edges (${sql.split('\n')[1]})`)
}
const leaked = answers.flatMap((a) => a.match(/canary-route-\d|books\.example\.com|admin:/g) || [])
ok(!leaked.length, `no answer quotes a call's host, credentials or query (${leaked.length ? [...new Set(leaked)].join(', ') : 'none'})`)
const db = readFileSync(path.join(P, '.grimoire/graph/graph.db')).toString('latin1') + (() => { try { return readFileSync(path.join(P, '.grimoire/graph/graph.db-wal')).toString('latin1') } catch { return '' } })()
ok(!/canary-route-\d|books\.example\.com/.test(db), 'the index holds no call\'s host, credentials or query')

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
