import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(root, 'index.html');
const outputPath = path.join(root, 'dist', 'template.html');
const opening = '<script id="markdown-source" type="text/plain">';
const source = await readFile(sourcePath, 'utf8');
const start = source.indexOf(opening);
const end = start < 0 ? -1 : source.indexOf('</script>', start + opening.length);

if (start < 0 || end < 0) throw new Error('index.html has no valid markdown-source block');

const placeholder = '# Pageleaf\n\nYour document is ready.';
const template = `${source.slice(0, start + opening.length)}${placeholder}${source.slice(end)}`;
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, template, 'utf8');
