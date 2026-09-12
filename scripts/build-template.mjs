import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'index.html');
const outputPath = path.join(root, 'dist', 'template.html');
const opening = '<script id="markdown-source" type="text/plain">';
const source = await readFile(sourcePath, 'utf8');
const bundle = await build({
  entryPoints: [path.join(root, 'src', 'geomap', 'index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'PageleafGeoMap',
  target: 'es2022',
  write: false
});
const geomapScript = bundle.outputFiles[0].text;
const geomapStyles = await readFile(path.join(root, 'src', 'geomap', 'geomap.css'), 'utf8');
const start = source.indexOf(opening);
const end = start < 0 ? -1 : source.indexOf('</script>', start + opening.length);

if (start < 0 || end < 0) throw new Error('index.html has no valid markdown-source block');

const placeholder = '# Pageleaf\n\nYour document is ready.';
const template = `${source.slice(0, start + opening.length)}${placeholder}${source.slice(end)}`
  .replace('<link rel="stylesheet" href="src/geomap/geomap.css">', () => `<style>\n${geomapStyles}</style>`)
  .replace('<script src="dist/geomap.js"></script>', () => `<script>\n${geomapScript}</script>`);
await mkdir(path.dirname(outputPath), { recursive: true });
// The editable source page uses a classic bundle so it also opens over file://.
await writeFile(path.join(root, 'dist', 'geomap.js'), geomapScript, 'utf8');
await writeFile(outputPath, template, 'utf8');
