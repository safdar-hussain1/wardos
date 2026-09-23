import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

/**
 * The page template (index.html) and the app entry point (src/app/main.tsx)
 * carry two things that must reach the published site intact: the
 * authorship marks and the SEO block (title, description, canonical URL,
 * Open Graph and Twitter tags, JSON-LD, one <h1>, og-image.png, sitemap.xml,
 * favicon). Each is asserted twice: in the source, and in docs/ — the
 * committed production build that GitHub Pages serves.
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

// -- SEO block -----------------------------------------------------------------

const SITE_URL = 'https://safdar-hussain1.github.io/wardos/'
const OG_IMAGE_URL = `${SITE_URL}og-image.png`
const SEARCH_CONSOLE_TOKEN = '0SIEfExLTSQj1qvnHWF5A5fY58KVl2lpIEnePP9CtI0'
const AUTHOR = {
  '@type': 'Person',
  name: 'Safdar Hussain',
  url: 'https://github.com/safdar-hussain1',
  sameAs: ['https://github.com/safdar-hussain1', 'https://www.linkedin.com/in/safdar-hussain-a8a61b248'],
}

/** name/property → content, first occurrence wins (as a crawler reads it). */
function metaTags(html: string): Map<string, string> {
  const tags = new Map<string, string>()
  for (const m of html.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*\/?>/g)) {
    if (!tags.has(m[1])) tags.set(m[1], m[2])
  }
  return tags
}

function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG signature').toBe(true)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

// The template's static files live in public/; the build copies them next to docs/index.html.
const PAGES = [
  { label: 'index.html (template)', page: ['index.html'], files: ['public'] },
  { label: 'docs/index.html (built)', page: ['docs', 'index.html'], files: ['docs'] },
]

describe.each(PAGES)('SEO block — $label', ({ page, files }) => {
  const html = () => read(...page)

  it('has lang="en", a title of at most 60 characters and a description of 120–160', () => {
    expect(html()).toMatch(/<html lang="en">/)
    const title = html().match(/<title>([^<]*)<\/title>/)?.[1] ?? ''
    expect(title.length).toBeGreaterThan(0)
    expect(title.length).toBeLessThanOrEqual(60)
    const description = metaTags(html()).get('description') ?? ''
    expect(description.length).toBeGreaterThanOrEqual(120)
    expect(description.length).toBeLessThanOrEqual(160)
  })

  it('has the author, the Search Console token, the canonical URL and a favicon that resolves', () => {
    const meta = metaTags(html())
    expect(meta.get('author')).toBe('Safdar Hussain')
    expect(meta.get('google-site-verification')).toBe(SEARCH_CONSOLE_TOKEN)
    expect([...html().matchAll(/<link rel="canonical" href="([^"]+)"/g)].map((m) => m[1])).toEqual([SITE_URL])
    const icon = html().match(/<link rel="icon" type="image\/svg\+xml" href="([^"]+)"/)?.[1]
    expect(icon, 'favicon link').toBeDefined()
    expect(existsSync(join(repoRoot, ...files, icon!.replace(/^\.?\//, ''))), `favicon ${icon} resolves`).toBe(true)
  })

  it('has the Open Graph and Twitter card tags, matching the title and description', () => {
    const meta = metaTags(html())
    const title = html().match(/<title>([^<]*)<\/title>/)?.[1]
    const description = meta.get('description')
    expect(meta.get('og:type')).toBe('website')
    expect(meta.get('og:site_name')).toBe('Safdar Hussain')
    expect(meta.get('og:url')).toBe(SITE_URL)
    expect(meta.get('og:image')).toBe(OG_IMAGE_URL)
    expect(meta.get('og:image:width')).toBe('1200')
    expect(meta.get('og:image:height')).toBe('630')
    expect(meta.get('twitter:card')).toBe('summary_large_image')
    expect(meta.get('twitter:image')).toBe(OG_IMAGE_URL)
    for (const key of ['og:title', 'twitter:title']) expect(meta.get(key), key).toBe(title)
    for (const key of ['og:description', 'twitter:description']) expect(meta.get(key), key).toBe(description)
    expect(meta.get('og:image:alt')?.length ?? 0, 'og:image:alt').toBeGreaterThan(0)
    expect(meta.get('twitter:image:alt'), 'twitter:image:alt').toBe(meta.get('og:image:alt'))
  })

  it('has one JSON-LD @graph: a WebApplication and a SoftwareSourceCode, each with the full author', () => {
    const blocks = [...html().matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    expect(blocks.length).toBe(1)
    const graph = JSON.parse(blocks[0][1])['@graph'] as Record<string, unknown>[]
    expect(graph.map((n) => n['@type'])).toEqual(['WebApplication', 'SoftwareSourceCode'])
    const [app, code] = graph
    expect(app.url).toBe(SITE_URL)
    expect(app.image).toBe(OG_IMAGE_URL)
    expect(app.description).toBe(metaTags(html()).get('description'))
    expect(code.codeRepository).toBe('https://github.com/safdar-hussain1/wardos')
    expect(code.license).toBe('https://opensource.org/licenses/MIT')
    for (const node of graph) expect(node.author, `${node['@type']} author`).toEqual(AUTHOR)
  })

  it('has exactly one <h1>', () => {
    expect(html().match(/<h1[\s>]/g) ?? []).toHaveLength(1)
  })

  it('ships og-image.png at 1200×630 and under 500 KB', () => {
    const bytes = readFileSync(join(repoRoot, ...files, 'og-image.png'))
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 })
    expect(bytes.length).toBeLessThan(500 * 1024)
  })

  it('ships sitemap.xml with the page URL and a literal lastmod date', () => {
    const sitemap = readFileSync(join(repoRoot, ...files, 'sitemap.xml'), 'utf8')
    expect(sitemap).toContain(`<loc>${SITE_URL}</loc>`)
    expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
  })
})

describe('docs/ carries the current static files', () => {
  it.each(['og-image.png', 'sitemap.xml', 'favicon.svg'])('docs/%s is byte-identical to its public/ source', (name) => {
    expect(readFileSync(join(repoRoot, 'docs', name)).equals(readFileSync(join(repoRoot, 'public', name)))).toBe(true)
  })
})
