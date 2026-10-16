// grimoire graph · Markdown for the page's Docs tab. Pure functions, no dependency: the page injects
// them as they are (render.mjs), so a note renders the same in the browser, in the tests and after
// an edit. Not a full CommonMark: the subset project docs use, plus what Obsidian adds:
//   blocks   front matter (shown as properties), ATX and setext headings, fenced and indented code,
//            block quotes and callouts (> [!note] Title, foldable with - or +), lists (nested,
//            ordered, task items), GFM tables, rules, HTML blocks
//   inline   code, **strong**, *em*, ~~del~~, ==highlight==, [links](…), [ref][links], <autolinks>,
//            bare URLs, [[wikilinks|alias]] and ![[embeds]], #tags, images (alt text only: the page
//            loads nothing), hard breaks
// Raw HTML is never passed through: an allowlist of plain tags (details, summary, kbd, sub, sup, br,
// b, i, em, strong, code, p, div, span, u, s, mark) is rebuilt WITHOUT attributes, and every other
// tag is dropped, its text kept. Every text is escaped. Links are not decided here: `link(ref)` is
// called for each one and says what it points to (a note, an indexed file, a missing note, a URL),
// so the same pass also collects a note's outgoing references and outline (`out`). Each function
// is self-contained (the page carries its source text, not this module).

// A heading's anchor, the way GitHub makes it: lower case, punctuation dropped, spaces to hyphens.
export function mdSlug(s) {
  return String(s).toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')
}

// '---\nkey: value\n---\nbody' → { props: [[key, value]], body, lines: lines the front matter took }
export function mdFront(src) {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src)
  if (!m) return { props: [], body: src, lines: 0 }
  const props = []
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w .-]*?):[ \t]*(.*)$/.exec(line)
    if (kv) props.push([kv[1], kv[2].trim().replace(/^(['"])(.*)\1$/, '$2')])
    else if (props.length && /^\s*-\s+|^\s+\S/.test(line)) { const last = props[props.length - 1]; last[1] = (last[1] ? last[1] + ', ' : '') + line.trim().replace(/^-\s+/, '') }
  }
  return { props, body: src.slice(m[0].length), lines: m[0].split('\n').length - 1 }
}

// Render a note. link(ref) → null | { doc, anchor } | { file, line } | { missing } | { url } | { anchor }
// where ref = { kind: 'wiki' | 'embed' | 'md' | 'url' | 'code', target, text }. out, when given,
// collects { headings: [{ level, text, slug }], refs: [ref + what link() answered] }.
export function mdToHtml(src, link, out) {
  const ALLOWED = new Set(['details', 'summary', 'kbd', 'sub', 'sup', 'br', 'b', 'i', 'em', 'strong', 'code', 'p', 'div', 'span', 'u', 's', 'mark', 'small', 'blockquote', 'ul', 'ol', 'li', 'hr'])
  const VOID = new Set(['br', 'hr'])
  const CALLOUTS = new Set(['note', 'info', 'tip', 'hint', 'important', 'success', 'check', 'done', 'question', 'help', 'faq', 'warning', 'caution', 'attention', 'failure', 'fail', 'missing', 'danger', 'error', 'bug', 'example', 'quote', 'cite', 'abstract', 'summary', 'tldr', 'todo'])
  const mdEsc = (x) => String(x).replace(/&/g, '&amp;').replace(/[<]/g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  out = out || {}
  out.headings = []; out.refs = []
  const slugs = new Map()
  const ask = (ref) => { const r = link ? link(ref) : null; out.refs.push({ ...ref, to: r }); return r }
  const body = mdFront(String(src)).body.replace(/\r\n?/g, '\n')
  // reference-style definitions: [label]: url "title" (never a footnote [^1]: …)
  const defs = new Map()
  const lines = body.split('\n').filter((l) => {
    const m = /^ {0,3}\[([^\]^][^\]]*)\]:\s*<?(\S+?)>?(?:\s+["'(].*["')])?\s*$/.exec(l)
    if (m) { defs.set(m[1].toLowerCase(), m[2]); return false }
    return true
  })

  const anchorOf = (text) => {
    const base = mdSlug(text.replace(/<[^>]*>/g, '')) || 'section'
    const n = slugs.get(base) || 0
    slugs.set(base, n + 1)
    return n ? `${base}-${n}` : base
  }
  const linkTag = (r, inner, title) => {
    if (!r) return null
    if (r.doc !== undefined) return `<a class="internal" href="#doc-${r.doc}" data-doc="${r.doc}"${r.anchor ? ` data-anchor="${mdEsc(r.anchor)}"` : ''}${title ? ` title="${mdEsc(title)}"` : ''}>${inner}</a>`
    if (r.file !== undefined) return `<a class="internal code-link" href="#file-${r.file}"${title ? ` title="${mdEsc(title)}"` : ''}>${inner}</a>`
    if (r.missing !== undefined) return `<a class="internal missing" href="#" data-new="${mdEsc(r.missing)}" title="${mdEsc(`No note “${r.missing}” yet`)}">${inner}</a>`
    if (r.url) return `<a class="external" href="${mdEsc(r.url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${mdEsc(title)}"` : ''}>${inner}</a>`
    if (r.anchor) return `<a class="internal" href="#" data-anchor="${mdEsc(r.anchor)}">${inner}</a>`
    return null
  }
  const safeUrl = (u) => /^(https?:|mailto:)/i.test(u) ? u : null

  // ── inline ── (sticky regexes from i: no slicing per character)
  const RX = {
    esc: /\\([!-/:-@[-`{-~])/y, brk: /\\\n/y, ticks: /`+/y,
    wiki: /(!?)\[\[([^\]\n]+?)\]\]/y,
    img: /!\[([^\]\n]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)/y,
    link: /\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\](?:\(\s*<?([^)\s>]*)>?(?:\s+"([^"]*)")?\s*\)|\[([^\]\n]*)\])/y,
    auto: /<((?:https?|mailto):[^\s<>]+)>/iy, comment: /<!--[\s\S]*?-->/y, tag: /<(\/?)([a-zA-Z][\w-]*)\b[^<>]*?(\/?)>/y,
    bare: /(?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]'"*_~]/iy, hard: / {2,}\n/y,
  }
  function inline(text) {
    text = String(text).replace(/\u0000/g, '')
    const keep = []
    const hold = (html) => `\u0000${keep.push(html) - 1}\u0000`
    let s = '', i = 0, m
    const at = (re) => { re.lastIndex = i; return re.exec(text) }
    while (i < text.length) {
      const c = text[i]
      if (c === '\\') {
        if ((m = at(RX.esc))) { s += hold(mdEsc(m[1])); i += 2; continue }
        if ((m = at(RX.brk))) { s += hold('<br>'); i += 2; continue }
      } else if (c === '`') {
        const run = at(RX.ticks)[0]
        const end = text.indexOf(run, i + run.length)
        if (end > 0 && text[end + run.length] !== '`') {
          let code = text.slice(i + run.length, end)
          if (/^ .* $/.test(code)) code = code.slice(1, -1)
          const plain = `<code>${mdEsc(code)}</code>`
          const r = /^[^\s`]{3,200}$/.test(code) && /[./]/.test(code) ? ask({ kind: 'code', target: code, text: code }) : null
          s += hold(r && (r.file !== undefined || r.doc !== undefined) ? linkTag(r, plain, code) : plain)
          i = end + run.length; continue
        }
        s += hold(mdEsc(run)); i += run.length; continue
      } else if (c === '[' || c === '!') {
        if ((m = at(RX.wiki))) {
          const [target, alias] = m[2].split('|')
          const label = (alias || target).trim()
          const r = ask({ kind: m[1] ? 'embed' : 'wiki', target: target.trim(), text: label })
          s += hold(linkTag(r, mdEsc(label), target.trim()) || `<span class="unresolved">${mdEsc(label)}</span>`)
          i += m[0].length; continue
        }
        if (c === '!' && (m = at(RX.img))) {
          const url = safeUrl(m[2]), alt = m[1] || m[2]
          s += hold(url ? `<a class="external img" href="${mdEsc(url)}" target="_blank" rel="noopener noreferrer" title="image (not loaded)">${mdEsc(alt)}</a>` : `<span class="img" title="${mdEsc(m[2])}">${mdEsc(alt)}</span>`)
          i += m[0].length; continue
        }
        if (c === '[' && (m = at(RX.link))) {
          const label = m[1]
          const href = m[2] !== undefined ? m[2] : defs.get((m[4] || label).toLowerCase())
          if (href !== undefined) {
            const r = ask({ kind: /^[a-z][a-z0-9+.-]*:/i.test(href) ? 'url' : 'md', target: href, text: label })
            const inner = inline(label)
            s += hold(linkTag(r, inner, m[3]) || (safeUrl(href) ? linkTag({ url: href }, inner, m[3]) : `<span class="unresolved" title="${mdEsc(href)}">${inner}</span>`))
            i += m[0].length; continue
          }
        }
      } else if (c === '<') {
        if ((m = at(RX.auto))) { s += hold(linkTag({ url: m[1] }, mdEsc(m[1]))); i += m[0].length; continue }
        if ((m = at(RX.comment))) { i += m[0].length; continue }
        if ((m = at(RX.tag))) {
          const tag = m[2].toLowerCase()
          if (ALLOWED.has(tag)) s += hold(m[1] ? (VOID.has(tag) ? '' : `</${tag}>`) : `<${tag}>`)
          i += m[0].length; continue
        }
      } else if ((c === 'h' || c === 'w' || c === 'H' || c === 'W') && !/[\p{L}\p{N}_/]/u.test(text[i - 1] || '') && (m = at(RX.bare))) {
        const url = /^www\./i.test(m[0]) ? `https:/${'/'}${m[0]}` : m[0] // (no literal URL in the page's script)
        s += hold(linkTag({ url }, mdEsc(m[0]))); i += m[0].length; continue
      } else if (c === ' ' && text[i + 1] === ' ' && (m = at(RX.hard))) { s += hold('<br>'); i += m[0].length; continue }
      s += c; i++
    }
    let e = mdEsc(s)
    e = e.replace(/\*\*\*(?=\S)([\s\S]*?\S)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^\p{L}\p{N}_])__(?=\S)([\s\S]*?\S)__(?![\p{L}\p{N}_])/gu, '$1<strong>$2</strong>')
      .replace(/\*(?=[^\s*])([\s\S]*?[^\s*])\*/g, '<em>$1</em>')
      .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])([\s\S]*?[^\s_])_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
      .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
      .replace(/==(?=\S)([\s\S]*?\S)==/g, '<mark>$1</mark>')
      .replace(/(^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu, '$1<span class="tag">#$2</span>')
    return e.replace(/\u0000(\d+)\u0000/g, (_, n) => keep[Number(n)])
  }

  // ── blocks ──
  const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/
  const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
  const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
  const QUOTE = /^ {0,3}> ?/
  const ITEM = /^( *)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*)|[ \t]*$)/
  const TDELIM = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
  const HTML = /^ {0,3}<\/?([a-zA-Z][\w-]*)(?:[\s>/]|$)|^ {0,3}<!--/
  const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/
  const indentOf = (l) => /^ */.exec(l.replace(/\t/g, '    '))[0].length
  const startsBlock = (l, next) => FENCE.test(l) || ATX.test(l) || HR.test(l) || QUOTE.test(l) || HTML.test(l) || (l.includes('|') && next !== undefined && TDELIM.test(next) && next.includes('-'))
  const cells = (row) => { let r = row.trim(); if (r.startsWith('|')) r = r.slice(1); if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1); return r.split(/(?<!\\)\|/).map((x) => x.trim().replace(/\\\|/g, '|')) }

  function heading(level, text) {
    const id = anchorOf(text)
    out.headings.push({ level, text: text.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/[*_`~=]/g, ''), slug: id })
    return `<h${level} id="h-${mdEsc(id)}">${inline(text)}</h${level}>`
  }

  function blocks(ls) {
    const html = []
    let i = 0
    while (i < ls.length) {
      const l = ls[i]
      if (!l.trim()) { i++; continue }
      let m
      if ((m = FENCE.exec(l))) {
        const [, ind, fence, lang] = m
        const body = []
        i++
        while (i < ls.length && !new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`).test(ls[i])) { body.push(ls[i].slice(Math.min(ind.length, indentOf(ls[i])))); i++ }
        i++
        html.push(`<pre><code${lang ? ` class="lang-${mdEsc(lang)}"` : ''}>${mdEsc(body.join('\n'))}</code></pre>`)
        continue
      }
      if ((m = ATX.exec(l))) { html.push(heading(m[1].length, m[2] || '')); i++; continue }
      if (HR.test(l)) { html.push('<hr>'); i++; continue }
      if (QUOTE.test(l)) {
        const q = []
        while (i < ls.length && ls[i].trim() && (QUOTE.test(ls[i]) || (q.length && !startsBlock(ls[i], ls[i + 1]) && !ITEM.test(ls[i])))) { q.push(ls[i].replace(QUOTE, '')); i++ }
        const c = /^\[!([\w-]+)\]([-+]?)[ \t]*(.*)$/.exec(q[0] || '')
        if (c) {
          const kind = CALLOUTS.has(c[1].toLowerCase()) ? c[1].toLowerCase() : 'note'
          const title = c[3] || c[1][0].toUpperCase() + c[1].slice(1).toLowerCase()
          const inner = blocks(q.slice(1))
          html.push(c[2] ? `<details class="callout callout-${kind}"${c[2] === '+' ? ' open' : ''}><summary class="callout-title">${inline(title)}</summary>${inner}</details>` : `<div class="callout callout-${kind}"><div class="callout-title">${inline(title)}</div>${inner}</div>`)
        } else html.push(`<blockquote>${blocks(q)}</blockquote>`)
        continue
      }
      if (l.includes('|') && i + 1 < ls.length && TDELIM.test(ls[i + 1]) && ls[i + 1].includes('-')) {
        const head = cells(l), align = cells(ls[i + 1]).map((d) => (/^:-+:$/.test(d) ? 'center' : /-:$/.test(d) ? 'right' : /^:/.test(d) ? 'left' : ''))
        const st = (k) => (align[k] ? ` style="text-align:${align[k]}"` : '')
        const rows = []
        i += 2
        while (i < ls.length && ls[i].trim() && ls[i].includes('|')) { rows.push(cells(ls[i])); i++ }
        html.push(`<div class="table"><table><thead><tr>${head.map((c, k) => `<th${st(k)}>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${head.map((_, k) => `<td${st(k)}>${inline(r[k] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`)
        continue
      }
      if ((m = ITEM.exec(l))) { i = list(ls, i, html); continue }
      if (HTML.test(l)) {
        const chunk = []
        while (i < ls.length && ls[i].trim()) { chunk.push(ls[i]); i++ }
        html.push(inline(chunk.join('\n'))) // unwrapped: an allowed <details> may open here and close blocks later
        continue
      }
      if (/^( {4}|\t)/.test(l)) {
        const code = []
        while (i < ls.length && (/^( {4}|\t)/.test(ls[i]) || !ls[i].trim())) { code.push(ls[i].replace(/^( {4}|\t)/, '')); i++ }
        while (code.length && !code[code.length - 1].trim()) code.pop()
        html.push(`<pre><code>${mdEsc(code.join('\n'))}</code></pre>`)
        continue
      }
      const para = [l]
      i++
      while (i < ls.length && ls[i].trim() && !startsBlock(ls[i], ls[i + 1]) && !(ITEM.test(ls[i]) && !/^ *\d/.test(ls[i])) && !(/^ *1[.)]\s/.test(ls[i]))) {
        if (SETEXT.test(ls[i])) break
        para.push(ls[i]); i++
      }
      if (i < ls.length && SETEXT.test(ls[i]) && ls[i].trim()) { html.push(heading(ls[i].trim()[0] === '=' ? 1 : 2, para.join(' ').trim())); i++; continue }
      html.push(`<p>${inline(para.join('\n').trim())}</p>`)
    }
    return html.join('\n')
  }

  // one list, from line i: items at the same indent and of the same kind; returns the next line
  function list(ls, i, html) {
    const first = ITEM.exec(ls[i])
    const ind = first[1].length, ordered = /\d/.test(first[2]), start = ordered ? parseInt(first[2], 10) : 1
    const items = []
    let loose = false
    while (i < ls.length) {
      const m = ITEM.exec(ls[i])
      if (!m || m[1].length !== ind || /\d/.test(m[2]) !== ordered) break
      const content = [m[3] || '']
      const col = ind + m[2].length + 1
      i++
      let sawBlank = false
      while (i < ls.length) {
        const l = ls[i]
        if (!l.trim()) { sawBlank = true; content.push(''); i++; continue }
        const d = indentOf(l)
        if (d >= Math.min(col, ind + 2)) { content.push(l.replace(/\t/g, '    ').slice(Math.min(d, col))); sawBlank = false; i++; continue }
        if (!sawBlank && !ITEM.test(l) && !startsBlock(l, ls[i + 1])) { content.push(l.trim()); i++; continue } // lazy continuation
        break
      }
      const sibling = (l) => { const x = ITEM.exec(l || ''); return !!x && x[1].length === ind && /\d/.test(x[2]) === ordered }
      while (content.length > 1 && !content[content.length - 1].trim()) { content.pop(); if (sibling(ls[i])) loose = true }
      if (content.slice(1).some((c, k) => !c.trim() && content[k + 2] !== undefined && !/^\s*([-*+]|\d+[.)])\s/.test(content[k + 2]))) loose = true
      items.push(content)
      while (i < ls.length && !ls[i].trim()) i++
      const nx = ITEM.exec(ls[i] || '')
      if (!nx || nx[1].length !== ind) break
    }
    const lis = items.map((content) => {
      let task = ''
      const t = /^\[([ xX])\][ \t]+/.exec(content[0])
      if (t) { task = `<input type="checkbox" disabled${t[1] !== ' ' ? ' checked' : ''}> `; content[0] = content[0].slice(t[0].length) }
      let inner = blocks(content)
      if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>/, '$1')
      return `<li${task ? ' class="task"' : ''}>${task}${inner}</li>`
    })
    html.push(ordered ? `<ol${start !== 1 ? ` start="${start}"` : ''}>${lis.join('')}</ol>` : `<ul>${lis.join('')}</ul>`)
    return i
  }

  return blocks(lines)
}
