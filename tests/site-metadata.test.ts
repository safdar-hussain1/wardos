import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * The page template (index.html) and the app entry point (src/app/main.tsx)
 * carry marks that must reach the published site intact. Each is asserted
 * twice: in the source, and in docs/ — the committed production build that
 * GitHub Pages serves.
 *
 * docs/ is read as it stands. tests/bundle-privacy.test.ts rebuilds it, and
 * vitest.config.ts runs the two files one after the other in a single
 * worker, so this file never reads a half-written build. A failure on the
 * docs/ side only means the committed build is stale: run `npm run build`
 * and commit docs/.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(...parts: string[]): string {
  return readFileSync(join(repoRoot, ...parts), 'utf8')
}

/**
 * The entry bundle docs/index.html actually loads — not every file in
 * docs/assets: the build never empties docs/ (vite.config.ts), so a stale
 * bundle from an earlier build could otherwise satisfy a check the current
 * one fails.
 */
function entryBundle(): string {
  const src = read('docs', 'index.html').match(/<script\b[^>]*\btype="module"[^>]*\bsrc="\.\/(assets\/[^"]+\.js)"/)?.[1]
  if (src === undefined) throw new Error('docs/index.html has no module entry script')
  return read('docs', src)
}

// -- authorship marks --------------------------------------------------------

const SOURCE_COMMENT = '<!-- WardOS · built by Safdar Hussain · https://github.com/safdar-hussain1 -->'
const META_AUTHOR = /<meta name="author" content="Safdar Hussain"\s*\/?>/
const FOOTER_CREDIT =
  /<footer class="site-credit">\s*Built by <a href="https:\/\/github\.com\/safdar-hussain1" rel="author">Safdar Hussain<\/a>\s*<\/footer>/
const SIGNATURE = 'WardOS — built by Safdar Hussain · https://github.com/safdar-hussain1/wardos'
// The minifier may change the quote style, never the text.
const CONSOLE_SIGNATURE = new RegExp(
  String.raw`console\.info\((['"\x60])` + SIGNATURE.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + String.raw`\1\)`,
)

function checkPageMarks(html: string, label: string): void {
  expect(html.includes(SOURCE_COMMENT), `${label}: source comment`).toBe(true)
  expect(META_AUTHOR.test(html), `${label}: <meta name="author">`).toBe(true)
  expect(FOOTER_CREDIT.test(html), `${label}: footer credit`).toBe(true)
  // The credit sits in <body>, after the React root, so it is visible on every screen.
  const body = html.slice(html.indexOf('<body>'))
  const root = body.indexOf('<div id="root">')
  expect(root, `${label}: React root inside <body>`).toBeGreaterThanOrEqual(0)
  expect(body.indexOf('<footer class="site-credit">'), `${label}: footer after the React root`).toBeGreaterThan(root)
}

describe('authorship marks', () => {
  it('the template (index.html) has the meta author, the source comment and the footer credit', () => {
    checkPageMarks(read('index.html'), 'index.html')
  })

  it('docs/index.html has the same three marks', () => {
    checkPageMarks(read('docs', 'index.html'), 'docs/index.html')
  })

  it('the app entry point prints the console signature', () => {
    expect(CONSOLE_SIGNATURE.test(read('src', 'app', 'main.tsx')), 'src/app/main.tsx: console signature').toBe(true)
  })

  it('the entry bundle docs/index.html loads prints the console signature', () => {
    expect(CONSOLE_SIGNATURE.test(entryBundle()), 'docs entry bundle: console signature').toBe(true)
  })
})
