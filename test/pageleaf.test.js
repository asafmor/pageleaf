import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import {
  buildFolderDocument,
  buildSingleDocument,
  embedDocument,
  generateSite,
  parseCommandLine,
  UsageError
} from '../lib/pageleaf.js';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, '..');
const templatePath = path.join(projectRoot, 'dist', 'template.html');
const themeNames = ['paper', 'midnight', 'grove', 'ocean', 'contrast'];

function themeTokens(template, theme) {
  const selector = theme === 'paper' ? ':root' : `[data-theme="${theme}"]`;
  const start = template.indexOf(`${selector}{`);
  assert.notEqual(start, -1, `missing ${theme} theme definition`);
  const end = template.indexOf('}', start);
  assert.notEqual(end, -1, `unterminated ${theme} theme definition`);
  return Object.fromEntries(
    template.slice(start + selector.length + 1, end)
      .split(';')
      .map((declaration) => declaration.trim().split(':'))
      .filter(([name, value]) => name?.startsWith('--') && value)
  );
}

async function withTemporaryDirectory(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pageleaf-test-'));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('single-file documents use the filename when H1 is missing', () => {
  assert.equal(buildSingleDocument('A plain note.\n', 'daily notes'), '# daily notes\n\nA plain note.\n');
  assert.equal(buildSingleDocument('# Original\n\nBody', 'ignored'), '# Original\n\nBody');
  assert.equal(buildSingleDocument('Original\n========\n\nBody', 'ignored', 'New # title'), '# New \\# title\n\nBody');
});

test('multi-file documents create one section per file and nest headings', () => {
  const markdown = buildFolderDocument([
    {
      title: '01-alpha',
      source: 'Intro before title.\n\n# Alpha\n\n## Page\n\n### Detail\n\n# Another root\n\n```md\n# Code heading\n```'
    },
    {
      title: '02-beta',
      source: 'Page name\n---------\n\nBody'
    }
  ], 'docs');

  assert.match(markdown, /^# docs/);
  assert.match(markdown, /## Alpha\n\nIntro before title\./);
  assert.match(markdown, /### Page/);
  assert.match(markdown, /#### Detail/);
  assert.match(markdown, /### Another root/);
  assert.match(markdown, /```md\n# Code heading\n```/);
  assert.match(markdown, /## 02\\-beta\n\n### Page name/);
});

test('a one-file folder uses single-file behavior', () => {
  const entry = { title: 'chapter', source: 'Text only' };
  assert.equal(
    buildFolderDocument([entry], 'folder-name'),
    buildSingleDocument(entry.source, entry.title)
  );
});

test('embedding selects a theme and protects the script boundary', () => {
  const template = '<html data-theme="paper"><script id="markdown-source" type="text/plain">old</script></html>';
  const html = embedDocument(template, '# Title\n\n</SCRIPT><p>', 'ocean');
  assert.match(html, /data-theme="ocean"/);
  assert.match(html, /&lt;\/script><p>/);
  assert.doesNotMatch(html, />old<\/script>/);
});

test('the generated template keeps five distinct, complete reading theme contracts', async () => {
  const template = await readFile(templatePath, 'utf8');
  const optionValues = [...template.matchAll(/<option value="([^"]+)"/g)].map((match) => match[1]);
  const requiredTokens = [
    '--bg', '--surface', '--text', '--muted', '--line', '--accent', '--soft', '--code',
    '--title-font', '--body-font', '--body-size', '--body-leading', '--radius',
    '--header-height', '--quote-rule', '--table-head', '--scroll-track', '--scroll-thumb'
  ];

  assert.deepEqual(optionValues, themeNames);
  const signatures = themeNames.map((theme) => {
    const tokens = themeTokens(template, theme);
    for (const token of requiredTokens) assert.ok(tokens[token], `${theme} defines ${token}`);
    return requiredTokens.map((token) => tokens[token]).join('|');
  });
  assert.equal(new Set(signatures).size, themeNames.length, 'each theme has a distinct visual contract');
  assert.match(template, /body\{[^}]*font:var\(--body-size\)\/var\(--body-leading\) var\(--body-font\)/);
  assert.match(template, /\.article blockquote\{[^}]*border-inline-start:var\(--quote-rule\)/);
  assert.match(template, /\.article th\{[^}]*background:var\(--table-head\)/);
});

test('the generated template preserves the selected palettes and hosted font pairings', async () => {
  const template = await readFile(templatePath, 'utf8');
  const expected = {
    paper: ['#f4efe6', 'Literata,Georgia,serif', '"Atkinson Hyperlegible",Arial,sans-serif', '#e7dbcb', '#9c7256', '#f8f1e7', '#e7d9c6'],
    midnight: ['#0b0d16', 'Chivo,Arial,sans-serif', '"IBM Plex Sans",Arial,sans-serif', '#191d2c', '#697899', '#0f1220', '#30374d'],
    grove: ['#f8faf4', 'Alegreya,Georgia,serif', '"Work Sans",Arial,sans-serif', '#dfe8da', '#6f896b', '#e6eee0', '#c4d1bf'],
    ocean: ['#fafcff', 'Archivo,Arial,sans-serif', 'Manrope,Arial,sans-serif', '#d7dfeb', '#607a9a', '#dfe8f5', '#c0cde0']
  };

  for (const [theme, values] of Object.entries(expected)) {
    const tokens = themeTokens(template, theme);
    assert.deepEqual(
      ['--bg', '--title-font', '--body-font', '--scroll-track', '--scroll-thumb', '--nav-scroll-track', '--nav-scroll-thumb'].map((token) => tokens[token]),
      values,
    );
  }
  assert.match(template, /fonts\.googleapis\.com\/css2\?family=Alegreya[^>]*family=Work\+Sans/);
});

test('the generated template uses theme-local colors for navigation scrollbars at every viewport width', async () => {
  const template = await readFile(templatePath, 'utf8');

  for (const theme of ['paper', 'midnight', 'grove', 'ocean', 'contrast']) {
    const selector = theme === 'paper' ? ':root' : `[data-theme="${theme}"]`;
    assert.match(template, new RegExp(`${selector.replace(/[\\[\\]]/g, '\\$&')}\\{[^}]*--bg:[^;]+;[^}]*--nav-scroll-track:[^;]+;[^}]*--nav-scroll-thumb:[^;]+;`));
  }
  assert.match(template, /\.primary\{[^}]*scrollbar-color:var\(--nav-scroll-thumb\) var\(--nav-scroll-track\)[^}]*\}/);
  assert.match(template, /\.primary::-webkit-scrollbar-track\{background:var\(--nav-scroll-track\)\}/);
  assert.match(template, /\.primary::-webkit-scrollbar-thumb\{background:var\(--nav-scroll-thumb\)[^}]*border:2px solid var\(--nav-scroll-track\)\}/);
  assert.doesNotMatch(template, /@media\(min-width:701px\)\{\.primary\{scrollbar-color/);
  assert.match(template, /\*\{scrollbar-color:var\(--scroll-thumb\) var\(--scroll-track\)\}/);
  assert.match(template, /\*::-webkit-scrollbar-track\{background:var\(--scroll-track\)\}/);
  assert.match(template, /\*::-webkit-scrollbar-thumb\{background:var\(--scroll-thumb\)[^}]*border:3px solid var\(--scroll-track\)/);
});

test('theme-specific navigation and corner treatments stay intentional', async () => {
  const template = await readFile(templatePath, 'utf8');

  assert.match(template, /\.primary\{align-items:flex-end\}/);
  assert.match(template, /\.primary a\{padding:9px 0\}/);
  assert.match(template, /\[data-theme="paper"\] \.header\{border-bottom:1px solid var\(--line\);box-shadow:none\}/);
  assert.match(template, /\[data-theme="paper"\] \.page-title\{font-style:normal\}/);
  assert.match(template, /\[data-theme="ocean"\] \.header\{border-bottom:1px solid var\(--line\)\}/);
  assert.match(template, /\[data-theme="grove"\] \.sidebar a\[aria-current\]\{box-shadow:none\}/);
  assert.match(
    template,
    /:is\(\[data-theme="midnight"\],\[data-theme="ocean"\]\) :is\([^}]*\.article blockquote[^}]*\.article table[^}]*\)\{border-radius:var\(--radius\)\}/,
  );
});

test('the generated template constrains header content to the site frame', async () => {
  const template = await readFile(templatePath, 'utf8');

  assert.match(template, /\.masthead,\.primary\{max-width:1600px;margin:auto\}/);
});

test('the generated header uses the linked document H1 as its only brand', async () => {
  const template = await readFile(templatePath, 'utf8');

  assert.match(template, /<h1 class="doc-title"><a id="document-title" href="#\/"><\/a><\/h1>/);
  assert.match(template, /const homePage=this\.model\.pages\[0\];\$\('document-title'\)\.textContent=this\.model\.title;\$\('document-title'\)\.href=homePage\.route;/);
  assert.doesNotMatch(template, /Pageleaf home|pageleaf<\/a>|class="leaf"|flaticon\.com/);
});

test('the generated theme selector is polished without a visible label', async () => {
  const template = await readFile(templatePath, 'utf8');

  assert.match(template, /<div class="theme-picker"><select id="theme" aria-label="Choose theme">/);
  assert.doesNotMatch(template, /<label[^>]*for="theme"[^>]*>Theme<\/label>/);
  assert.match(template, /\.theme-picker\{[^}]*position:relative[^}]*\}/);
  assert.doesNotMatch(template, /\.theme-picker::after\{[^}]*content:"⌄"/);
  assert.match(template, /\.theme-picker::after\{[^}]*content:""[^}]*width:7px[^}]*height:7px[^}]*border-right:2px solid var\(--accent\)[^}]*border-bottom:2px solid var\(--accent\)[^}]*transform:translateY\(-2px\) rotate\(45deg\)[^}]*pointer-events:none[^}]*\}/);
  assert.match(template, /\.theme-picker select\{[^}]*appearance:none[^}]*background:var\(--surface\)[^}]*border:1px solid var\(--line\)[^}]*box-shadow:var\(--shadow\)[^}]*\}/);
  assert.match(template, /\.theme-picker select:focus-visible\{[^}]*outline:3px solid var\(--accent\)[^}]*outline-offset:3px[^}]*\}/);
});

test('CLI parsing validates positionals, themes, layouts, and empty titles', () => {
  assert.equal(parseCommandLine(['guide.md', '--theme', 'grove']).values.theme, 'grove');
  assert.equal(parseCommandLine(['guide.md']).values.layout, 'standard');
  assert.equal(parseCommandLine(['guide.md', '--layout', 'sidebar']).values.layout, 'sidebar');
  assert.throws(() => parseCommandLine([]), UsageError);
  assert.throws(() => parseCommandLine(['a', 'b']), /exactly one input/);
  assert.throws(() => parseCommandLine(['a', '--theme', 'purple']), /Unknown theme/);
  assert.throws(() => parseCommandLine(['a', '--layout', 'stacked']), /Unknown layout "stacked"\. Choose one of: standard, sidebar/);
  assert.throws(() => parseCommandLine(['a', '--title', '   ']), /visible text/);
  assert.throws(() => parseCommandLine(['a', '--out', '   ']), /Output folder/);
});

test('the generated template supports standard and sidebar layouts', async () => {
  const template = await readFile(templatePath, 'utf8');
  const standard = embedDocument(template, '# Guide\n\n## Getting started\n\n### Install\n\nText.', 'paper', 'standard');
  const sidebar = embedDocument(template, '# Guide\n\n## Getting started\n\n### Install\n\nText.', 'paper', 'sidebar');

  assert.match(standard, /<html lang="en" data-theme="paper" data-layout="standard">/);
  assert.match(sidebar, /<html lang="en" data-theme="paper" data-layout="sidebar">/);
  assert.match(template, /data-layout="standard"/);
  assert.match(template, /dataset\.layout==='sidebar'/);
  assert.match(template, /\$\('primary'\)\.hidden=sidebarLayout;/);
  assert.match(template, /sidebar-group-title.*section\.title/);
  assert.match(template, /\.sidebar-group/);
  assert.match(template, /\.sidebar-group-title/);
  assert.match(template, /\.sidebar-layout \.sidebar/);
});

test('sidebar layout keeps section groups useful when they contain overview pages', async () => {
  const template = await readFile(templatePath, 'utf8');

  assert.match(template, /section\.pages\.map\(p=>this\.link\(p,p\.title,page\)\)\.join\(''\)/);
  assert.match(template, /section\.pages\.length>1\?section\.pages\.map/);
});

test('generation supports folders, sorting, filtering, output protection, and force', async () => {
  await withTemporaryDirectory(async (root) => {
    const input = path.join(root, 'manual');
    const output = path.join(root, 'site');
    await mkdir(path.join(input, 'nested'), { recursive: true });
    await writeFile(path.join(input, '10-last.txt'), '# Last\n\nFinal');
    await writeFile(path.join(input, '2-first.md'), '# First\n\nStart');
    await writeFile(path.join(input, '.hidden.md'), '# Hidden');
    await writeFile(path.join(input, 'binary.dat'), Buffer.from([0, 1, 2, 3]));
    await writeFile(path.join(input, 'nested', 'ignored.md'), '# Nested');

    const result = await generateSite(input, { out: output, theme: 'contrast', templatePath });
    assert.equal(result.outputPath, path.join(output, 'manual.html'));
    assert.ok(result.markdown.indexOf('## First') < result.markdown.indexOf('## Last'));
    assert.doesNotMatch(result.markdown, /Hidden|Nested/);
    assert.match(await readFile(result.outputPath, 'utf8'), /data-theme="contrast"/);

    await assert.rejects(() => generateSite(input, { out: output, templatePath }), /--force/);
    await generateSite(input, { out: output, force: true, templatePath });

    const insideInput = await generateSite(input, { out: input, templatePath });
    const regenerated = await generateSite(input, { out: input, force: true, templatePath });
    assert.equal(insideInput.markdown, regenerated.markdown);
    assert.doesNotMatch(regenerated.markdown, /## manual/);
  });
});

test('generation accepts absolute files and rejects binary direct input', async () => {
  await withTemporaryDirectory(async (root) => {
    const textPath = path.join(root, 'notes.txt');
    const binaryPath = path.join(root, 'data.bin');
    const output = path.join(root, 'output');
    await writeFile(textPath, 'Hello, world.');
    await writeFile(binaryPath, Buffer.from([65, 0, 66]));

    const result = await generateSite(textPath, { out: output, title: 'My notes', templatePath });
    assert.match(result.markdown, /^# My notes/);
    await assert.rejects(() => generateSite(binaryPath, { out: output, templatePath }), /not valid UTF-8 text/);
  });
});

test('the executable generates standard and sidebar layout HTML end to end', async () => {
  await withTemporaryDirectory(async (root) => {
    const input = path.join(root, 'guide.md');
    const executable = path.join(projectRoot, 'bin', 'pageleaf.js');
    await writeFile(input, '# Guide\n\n## Start\n\n### Install\n\nWelcome.');
    const { stdout } = await execFileAsync(process.execPath, [executable, input], { cwd: root });
    assert.match(stdout, /Created .*guide\.html/);
    assert.match(await readFile(path.join(root, 'guide.html'), 'utf8'), /data-layout="standard"/);

    const sidebarOutput = path.join(root, 'sidebar');
    await execFileAsync(process.execPath, [executable, input, '--layout', 'sidebar', '--out', sidebarOutput], { cwd: root });
    const sidebarHtml = await readFile(path.join(sidebarOutput, 'guide.html'), 'utf8');
    assert.match(sidebarHtml, /data-layout="sidebar"/);
    assert.match(sidebarHtml, /sidebar-group-title/);
  });
});

test('the executable reports the package version', async () => {
  const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [path.join(projectRoot, 'bin', 'pageleaf.js'), '--version']);

  assert.equal(stdout.trim(), packageMetadata.version);
});

test('the executable documents layouts and rejects invalid layout values', async () => {
  const executable = path.join(projectRoot, 'bin', 'pageleaf.js');
  const { stdout } = await execFileAsync(process.execPath, [executable, '--help']);
  assert.match(stdout, /--layout <name>\s+Navigation layout: standard, sidebar \(default: standard\)/);

  await assert.rejects(
    () => execFileAsync(process.execPath, [executable, 'guide.md', '--layout', 'stacked']),
    (error) => /Unknown layout "stacked"\. Choose one of: standard, sidebar\./.test(error.stderr)
      && /Run "pageleaf --help" for usage\./.test(error.stderr)
      && error.code === 2
  );
});
