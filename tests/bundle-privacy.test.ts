import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect, beforeAll } from 'vitest'

/**
 * Privacy claim (README "What this is not", DESIGN_CARD threat model): "no
 * network calls after asset load" — the
 * production bundle never issues a fetch to any non-relative (absolute)
 * origin. Patient/billing/payroll data lives entirely in a local sql.js
 * database persisted to IndexedDB; nothing about it should ever be able to
 * leave the device over the wire, and this is meant to be *tested*, not
 * merely promised.
 *
 * `npm run build` runs once in `beforeAll` (fresh `tsc -b && vite build`
 * into docs/) so this test always scans what would actually ship, not a
 * possibly-stale committed docs/ directory — generous timeout because a
 * full typecheck + build is slower than a unit test.
 *
 * Every `docs/assets/*.js` bundle, `docs/assets/*.css` stylesheet, and
 * `docs/index.html` is scanned for the literal substring `http://` or
 * `https://`. CSS is in scope because a `@font-face`/`@import`/`url(...)`
 * pointing at a CDN would be exactly the kind of leak this test exists to
 * catch — fonts here are self-hosted precisely so this stays empty. The
 * allowlist is intentionally
 * tiny and each entry is justified below — none of them is a value ever
 * passed to `fetch`/`XMLHttpRequest`/`WebSocket`; they are static text that
 * happens to look like a URL:
 *
 *   - `http://www.w3.org/…`         XML/SVG/MathML namespace identifiers
 *     (`xmlns="http://www.w3.org/2000/svg"` and siblings) that React's
 *     production runtime embeds as element-creation constants — these are
 *     namespace *names* per the XML spec, not network locations; nothing
 *     ever dereferences them.
 *   - `https://react.dev/errors/`   React's production build ships a
 *     minified-error decoder: a thrown Error's message is built as this
 *     string concatenated with a numeric code, for a developer to
 *     manually paste into a browser later. The app itself never fetches
 *     this URL.
 *   - `https://rolldown.rs/…`       Vite's rolldown bundler embeds this
 *     URL inside a thrown Error's message text for a CJS-interop edge
 *     case (a `require()` shim that can't resolve a module in-browser) —
 *     again, only ever human-read text inside an Error, never fetched.
 *
 * Any other absolute origin — an analytics script, a CDN font, a hardcoded
 * API endpoint — fails this test.
 *
 * One narrower allowance: the page credits its author, and those credits
 * carry the author's GitHub URLs. They are allowed as exact text in exactly
 * the places they belong (AUTHORSHIP_MARKS below), not as URLs: the HTML
 * comment and the footer link's opening tag in index.html, and the
 * console.info signature string in the JS bundle. The footer link is a
 * navigation the visitor may choose to follow; the comment and the console
 * line are text. None of them is ever passed to fetch/XMLHttpRequest/
 * WebSocket. Everything else stays as strict as before — the same URL
 * anywhere else (a fetch in the bundle, a <script src>, a <link href>), or
 * a different path on the same account, still fails. The page's other
 * personal URLs (the github.io canonical/og:url/og:image and the LinkedIn
 * profile in the JSON-LD author) sit inside the SEO metadata that
 * stripInertSeoMetadata removes, so they never reach the scan.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(repoRoot, 'docs')
const assetsDir = join(docsDir, 'assets')

const ALLOWED_PREFIXES = ['http://www.w3.org/', 'https://react.dev/errors/', 'https://rolldown.rs/']

const AUTHORSHIP_MARKS = [
  // index.html: the source comment
  '<!-- WardOS · built by Safdar Hussain · https://github.com/safdar-hussain1 -->',
  // index.html: the footer credit's opening tag
  '<a href="https://github.com/safdar-hussain1" rel="author">',
  // JS bundle: the console.info signature from src/app/main.tsx
  'WardOS — built by Safdar Hussain · https://github.com/safdar-hussain1/wardos',
]

function withoutAuthorshipMarks(text: string): string {
  return AUTHORSHIP_MARKS.reduce((t, mark) => t.split(mark).join(''), text)
}

const URL_PATTERN = /https?:\/\/[^\s"'`)]*/g

beforeAll(() => {
  // `build.emptyOutDir: false` (vite.config.ts) is deliberate — docs/demo.db
  // and the other public/-copied files must survive a fresh build — but it
  // means old hashed chunks never get swept away on their own. Clear
  // docs/assets before rebuilding so this test (and the committed docs/,
  // cleaned the same way before commit) only ever contains bundles the
  // *current* index.html actually references — never a stale chunk left
  // over from an earlier build.
  rmSync(assetsDir, { recursive: true, force: true })

  // Vitest itself runs with NODE_ENV=test, which a naive `execSync` would
  // inherit into the spawned `npm run build` — and Vite's production build
  // honors an already-set NODE_ENV rather than forcing 'production', which
  // ships React's *development* build (verbose react.dev/link/* warning
  // URLs baked in, several times larger, unminified) instead of the real
  // production bundle. Force NODE_ENV=production explicitly so this test
  // always builds — and therefore always scans — the same artifact that
  // actually gets deployed, not an accidental dev build.
  execSync('npm run build', { cwd: repoRoot, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } })
}, 180_000)

function findDisallowedUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN) ?? []
  return matches.filter((m) => !ALLOWED_PREFIXES.some((p) => m.startsWith(p)))
}

/**
 * SEO metadata in index.html is the same category as the allowlist above:
 * static text that happens to look like a URL, never dereferenced by the
 * browser. `<link rel="canonical">`, the `og:`/`twitter:` meta tags, and the
 * `application/ld+json` block exist for crawlers reading the document as
 * text; no browser ever issues a request to any URL inside them. Strip
 * exactly those regions before scanning so the scan still catches a real
 * leak — an analytics script, a CDN font, a hardcoded endpoint — anywhere
 * else in the page, including a URL smuggled into any *other* tag.
 */
function stripInertSeoMetadata(html: string): string {
  return html
    .replace(/<link\s+rel="canonical"[^>]*>/g, '')
    .replace(/<meta\s+(?:property="(?:og|twitter):|name="twitter:)[^>]*>/gs, '')
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, '')
}

function jsBundleFiles(): string[] {
  return readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(assetsDir, f))
}

function cssBundleFiles(): string[] {
  return readdirSync(assetsDir)
    .filter((f) => f.endsWith('.css'))
    .map((f) => join(assetsDir, f))
}

describe('production bundle privacy', () => {
  it('at least one JS bundle was produced (sanity: the scan below isn\'t vacuously passing)', () => {
    expect(jsBundleFiles().length).toBeGreaterThan(0)
  })

  it('no docs/assets/*.js bundle contains an absolute network origin outside the allowlist', () => {
    const offenders: string[] = []
    for (const file of jsBundleFiles()) {
      const text = withoutAuthorshipMarks(readFileSync(file, 'utf8'))
      for (const url of findDisallowedUrls(text)) {
        offenders.push(`${file}: ${url.slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('at least one CSS bundle was produced (sanity: the scan below isn\'t vacuously passing)', () => {
    expect(cssBundleFiles().length).toBeGreaterThan(0)
  })

  it('no docs/assets/*.css stylesheet contains an absolute network origin outside the allowlist (fonts are self-hosted)', () => {
    const offenders: string[] = []
    for (const file of cssBundleFiles()) {
      const text = readFileSync(file, 'utf8')
      for (const url of findDisallowedUrls(text)) {
        offenders.push(`${file}: ${url.slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('docs/index.html contains no absolute network origin outside inert SEO metadata', () => {
    const text = withoutAuthorshipMarks(stripInertSeoMetadata(readFileSync(join(docsDir, 'index.html'), 'utf8')))
    expect(findDisallowedUrls(text)).toEqual([])
  })

  it('docs/index.html loads its script/stylesheet from relative (same-origin) paths', () => {
    const text = withoutAuthorshipMarks(stripInertSeoMetadata(readFileSync(join(docsDir, 'index.html'), 'utf8')))
    const srcs = [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      expect(src.startsWith('http://')).toBe(false)
      expect(src.startsWith('https://')).toBe(false)
      expect(src.startsWith('//')).toBe(false)
    }
  })

  it('docs/demo.db and docs/sql-wasm.wasm exist — the app\'s two runtime fetches, both same-origin relative', () => {
    expect(existsSync(join(docsDir, 'demo.db'))).toBe(true)
    expect(existsSync(join(docsDir, 'sql-wasm.wasm'))).toBe(true)
  })
})
