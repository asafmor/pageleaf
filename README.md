# Pageleaf

Open **index.html** directly in a browser. That is the complete distributable: plain HTML, CSS, vanilla JavaScript, inline Markdown, and one pinned Markdown-it CDN dependency. No server, package installation, or build step is needed. Internet access is required to load Markdown-it; relative images resolve beside the HTML file.

## Replace the example

Find `<script id="markdown-source" type="text/plain">` in index.html and replace its contents with your Markdown. Keep the surrounding tags.

HTML script elements terminate at a literal closing script tag, even inside Markdown code fences. If your Markdown contains that sequence, write `&lt;/script` in its place; Pageleaf decodes it when reading the source. This encoding reserves that exact sequence. Other Markdown characters, including backticks and `${…}`, require no escaping.

## Structure and behavior

- The first top-level H1 becomes the document title; subsequent H1 headings remain content.
- Top-level H2 headings become section tabs. H3 headings become sidebar pages.
- H4–H6 remain in the article and populate its outline. If a page has none, short top-level bold topic labels provide fallback outline links; pages with neither show a link to the page beginning. The original Markdown is preserved.
- Document introductions and section introductions become Overview pages. Empty sections remain navigable. Missing heading levels receive a Document section or Overview page.
- Headings inside code, lists, and blockquotes do not split the document. Setext headings are supported.
- Duplicate heading names receive deterministic, collision-free suffixes. Unicode names are supported.
- Routes use `#/section/page` and `#/section/page/heading`. Standard Markdown heading links are resolved across pages; duplicate headings use document-order suffixes (`#name`, `#name-2`).
- Back/Forward, bookmarks, per-route scroll restoration, remembered section pages, and invalid-route recovery are included. Scroll positions last for the current browser session; a reload retains the route.
- Small screens use a full-hierarchy modal drawer. The page outline folds into a disclosure below 1200px.
- Printing renders the entire document on demand, then releases that extra content.

Markdown follows Markdown-it's default CommonMark-oriented syntax with tables, strikethrough, linkification, and typographic substitutions. Dialect-specific features such as front matter, task-list widgets, footnotes, and Mermaid are not interpreted. Raw HTML is escaped, and Markdown-it rejects unsafe link protocols. External images and links retain their normal browser behavior. The content enhancement pipeline is intentionally empty: no syntax highlighting, copy buttons, image zoom, or other transformations.

## Architecture and implementation plan

Implemented in four layers within the single file:

1. **DocumentParser** parses the complete Markdown once into tokens and a hierarchy. Keeping the shared parse environment preserves reference links declared elsewhere in the document. It assigns globally unique heading IDs and independent section/page slugs.
2. **MarkdownRenderer** renders only the current page's tokens and maps internal links to document routes. The empty `contentEnhancements` array is a future extension point.
3. **HashRouter / DocumentViewer** handle route resolution, navigation, responsive menus, scroll state, page outline, and printing. Article HTML is created only for the active page, except during printing.
4. **CSS tokens and components** keep appearance independent of the document model. Paper and Midnight change semantic variables on `html[data-theme]`. Shared layout, navigation, Markdown typography, responsive rules, and print rules consume these tokens. Theme selection persists when browser storage is available.

To redesign, start with the theme variables at the beginning of the stylesheet: colors, font families, radius, sidebar width, outline width, and article measure. System fonts keep the file dependency-light. To add a theme, define another token override, add its select option, and add its name to the saved-theme allowlist.

Markdown-it token-stream reference: https://github.com/markdown-it/markdown-it/blob/master/docs/architecture.md
