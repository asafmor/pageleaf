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
  assert.match(template, /\.theme-picker::after\{[^}]*content:"⌄"[^}]*pointer-events:none[^}]*\}/);
  assert.match(template, /\.theme-picker select\{[^}]*appearance:none[^}]*background:var\(--surface\)[^}]*border:1px solid var\(--line\)[^}]*box-shadow:var\(--shadow\)[^}]*\}/);
  assert.match(template, /\.theme-picker select:focus-visible\{[^}]*outline:3px solid var\(--accent\)[^}]*outline-offset:3px[^}]*\}/);
});

test('CLI parsing validates positionals, themes, and empty titles', () => {
  assert.equal(parseCommandLine(['guide.md', '--theme', 'grove']).values.theme, 'grove');
  assert.throws(() => parseCommandLine([]), UsageError);
  assert.throws(() => parseCommandLine(['a', 'b']), /exactly one input/);
  assert.throws(() => parseCommandLine(['a', '--theme', 'purple']), /Unknown theme/);
  assert.throws(() => parseCommandLine(['a', '--title', '   ']), /visible text/);
  assert.throws(() => parseCommandLine(['a', '--out', '   ']), /Output folder/);
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

test('the executable generates HTML end to end', async () => {
  await withTemporaryDirectory(async (root) => {
    const input = path.join(root, 'guide.md');
    await writeFile(input, '# Guide\n\n## Start\n\nWelcome.');
    const { stdout } = await execFileAsync(process.execPath, [path.join(projectRoot, 'bin', 'pageleaf.js'), input], { cwd: root });
    assert.match(stdout, /Created .*guide\.html/);
    assert.match(await readFile(path.join(root, 'guide.html'), 'utf8'), /# Guide/);
  });
});

test('the executable reports the package version', async () => {
  const packageMetadata = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  const { stdout } = await execFileAsync(process.execPath, [path.join(projectRoot, 'bin', 'pageleaf.js'), '--version']);

  assert.equal(stdout.trim(), packageMetadata.version);
});
