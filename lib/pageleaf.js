import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);

export const VERSION = require('../package.json').version;
export const THEMES = ['paper', 'midnight', 'grove', 'ocean', 'contrast'];

const MARKDOWN_OPEN = '<script id="markdown-source" type="text/plain">';
const filenameCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export class PageleafError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'PageleafError';
    this.exitCode = exitCode;
  }
}

export class UsageError extends PageleafError {
  constructor(message) {
    super(message, 2);
    this.name = 'UsageError';
  }
}

export const HELP = `Usage: pageleaf <file-or-folder> [options]

Turn one or more UTF-8 text files into a navigable HTML site.

Options:
  --title <text>    Override the site title
  --theme <name>    Initial theme: ${THEMES.join(', ')}
  --out <folder>    Output folder (default: current directory)
  --open            Open the generated site in the default browser
  --force           Replace an existing output file
  -h, --help        Show this help
  -v, --version     Show the version

Examples:
  pageleaf guide.md
  pageleaf ./docs --title "Project manual" --theme grove
  pageleaf notes.txt --out ./public --open`;

function cleanTitle(value, label = 'Title') {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new UsageError(`${label} must contain visible text.`);
  return title;
}

function escapeMarkdownText(value) {
  return value.replace(/([\\`*_[\]{}()#+.!<>|~-])/g, '\\$1');
}

function fileTitle(filePath) {
  const basename = path.basename(filePath);
  const extension = path.extname(basename);
  return cleanTitle(extension ? basename.slice(0, -extension.length) : basename, 'Input filename');
}

function outputBasename(inputPath, isDirectory) {
  const basename = path.basename(inputPath) || 'pageleaf';
  if (isDirectory) return `${basename}.html`;
  const extension = path.extname(basename);
  return `${extension ? basename.slice(0, -extension.length) : basename}.html`;
}

function scanHeadings(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const headings = [];
  let fence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (fence) {
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*$/);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = null;
      continue;
    }

    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(?:[^`~].*)?$/);
    if (opening) {
      fence = { character: opening[1][0], length: opening[1].length };
      continue;
    }

    const atx = line.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?)|[ \t]*)$/);
    if (atx) {
      const rawTitle = (atx[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim();
      headings.push({ start: index, end: index, level: atx[1].length, rawTitle });
      continue;
    }

    if (!line.trim() || index + 1 >= lines.length) continue;
    const setext = lines[index + 1].match(/^ {0,3}(=+|-+)[ \t]*$/);
    if (setext) {
      headings.push({ start: index, end: index + 1, level: setext[1][0] === '=' ? 1 : 2, rawTitle: line.trim() });
      index += 1;
    }
  }

  return { headings, lines };
}

function replaceHeading(lines, heading, replacement) {
  const result = [...lines];
  result.splice(heading.start, heading.end - heading.start + 1, replacement);
  return result.join('\n');
}

export function buildSingleDocument(source, fallbackTitle, titleOverride) {
  const { headings, lines } = scanHeadings(source);
  const firstH1 = headings.find((heading) => heading.level === 1);

  if (titleOverride !== undefined) {
    const title = escapeMarkdownText(cleanTitle(titleOverride));
    return firstH1 ? replaceHeading(lines, firstH1, `# ${title}`) : `# ${title}\n\n${lines.join('\n')}`;
  }

  if (firstH1) return lines.join('\n');
  return `# ${escapeMarkdownText(cleanTitle(fallbackTitle))}\n\n${lines.join('\n')}`;
}

function nestFileAsSection(source, fallbackTitle) {
  const { headings, lines } = scanHeadings(source);
  const firstH1 = headings.find((heading) => heading.level === 1);
  const sectionTitle = firstH1?.rawTitle || escapeMarkdownText(cleanTitle(fallbackTitle));
  const replacements = new Map();
  const skippedLines = new Set();

  for (const heading of headings) {
    if (heading === firstH1) {
      replacements.set(heading.start, '');
    } else {
      const level = Math.min(6, Math.max(3, heading.level + 1));
      replacements.set(heading.start, `${'#'.repeat(level)} ${heading.rawTitle || 'Untitled'}`);
    }
    for (let index = heading.start + 1; index <= heading.end; index += 1) skippedLines.add(index);
  }

  const body = lines
    .map((line, index) => replacements.has(index) ? replacements.get(index) : skippedLines.has(index) ? null : line)
    .filter((line) => line !== null)
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '');

  return `## ${sectionTitle}\n\n${body}`.trimEnd();
}

export function buildFolderDocument(entries, folderTitle, titleOverride) {
  if (entries.length === 1) {
    return buildSingleDocument(entries[0].source, entries[0].title, titleOverride);
  }

  const title = cleanTitle(titleOverride ?? folderTitle);
  const sections = entries.map((entry) => nestFileAsSection(entry.source, entry.title));
  return `# ${escapeMarkdownText(title)}\n\n${sections.join('\n\n')}`;
}

export function embedDocument(template, markdown, theme = 'paper') {
  if (!THEMES.includes(theme)) throw new UsageError(`Unknown theme "${theme}". Choose one of: ${THEMES.join(', ')}.`);
  const start = template.indexOf(MARKDOWN_OPEN);
  const end = start < 0 ? -1 : template.indexOf('</script>', start + MARKDOWN_OPEN.length);
  if (start < 0 || end < 0) throw new PageleafError('The packaged HTML template is invalid. Reinstall pageleaf and try again.');

  const escapedMarkdown = markdown.replace(/<\/script/gi, '&lt;/script');
  const withDocument = `${template.slice(0, start + MARKDOWN_OPEN.length)}${escapedMarkdown}${template.slice(end)}`;
  const withTheme = withDocument.replace(/(<html\b[^>]*\bdata-theme=")[^"]*(")/i, `$1${theme}$2`);
  if (withTheme === withDocument && theme !== 'paper') throw new PageleafError('The packaged HTML template has no default theme setting. Reinstall pageleaf and try again.');
  return withTheme;
}

function decodeText(buffer) {
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

async function readRequiredText(filePath) {
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    throw new PageleafError(`Could not read input file "${filePath}": ${error.message}`);
  }
  const source = decodeText(buffer);
  if (source === null) throw new PageleafError(`Input file "${filePath}" is not valid UTF-8 text. Convert it to UTF-8 and try again.`);
  return source;
}

async function readFolderEntries(folderPath, outputPath) {
  let dirents;
  try {
    dirents = await readdir(folderPath, { withFileTypes: true });
  } catch (error) {
    throw new PageleafError(`Could not read input folder "${folderPath}": ${error.message}`);
  }

  const files = dirents
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && path.join(folderPath, entry.name) !== outputPath)
    .sort((left, right) => filenameCollator.compare(left.name, right.name) || left.name.localeCompare(right.name));
  const entries = [];

  for (const file of files) {
    const filePath = path.join(folderPath, file.name);
    let buffer;
    try {
      buffer = await readFile(filePath);
    } catch (error) {
      throw new PageleafError(`Could not read file "${filePath}" while scanning the folder: ${error.message}`);
    }
    const source = decodeText(buffer);
    if (source !== null) entries.push({ path: filePath, source, title: fileTitle(file.name) });
  }

  if (!entries.length) {
    throw new PageleafError(`Folder "${folderPath}" contains no top-level, non-hidden UTF-8 text files.`);
  }
  return entries;
}

async function inputKind(inputPath) {
  try {
    const details = await stat(inputPath);
    if (details.isFile()) return 'file';
    if (details.isDirectory()) return 'directory';
    throw new PageleafError(`Input path "${inputPath}" must be a regular file or folder.`);
  } catch (error) {
    if (error instanceof PageleafError) throw error;
    if (error.code === 'ENOENT') throw new PageleafError(`Input path "${inputPath}" does not exist. Check the path and try again.`);
    throw new PageleafError(`Could not inspect input path "${inputPath}": ${error.message}`);
  }
}

export async function generateSite(input, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const inputPath = path.resolve(cwd, input);
  const kind = await inputKind(inputPath);
  const isDirectory = kind === 'directory';
  const outputFolder = path.resolve(cwd, options.out ?? '.');
  const outputPath = path.join(outputFolder, outputBasename(inputPath, isDirectory));

  if (!isDirectory && outputPath === inputPath) {
    throw new PageleafError('The output path would overwrite the input file. Choose another folder with --out.');
  }

  let markdown;
  if (isDirectory) {
    const entries = await readFolderEntries(inputPath, outputPath);
    markdown = buildFolderDocument(entries, path.basename(inputPath) || 'Pageleaf', options.title);
  } else {
    const source = await readRequiredText(inputPath);
    markdown = buildSingleDocument(source, fileTitle(inputPath), options.title);
  }

  const templatePath = options.templatePath ?? fileURLToPath(new URL('../dist/template.html', import.meta.url));
  let template;
  try {
    template = await readFile(templatePath, 'utf8');
  } catch (error) {
    throw new PageleafError(`Could not read the packaged HTML template: ${error.message}`);
  }
  const html = embedDocument(template, markdown, options.theme ?? 'paper');

  try {
    await mkdir(outputFolder, { recursive: true });
    await writeFile(outputPath, html, { encoding: 'utf8', flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new PageleafError(`Output file "${outputPath}" already exists. Pass --force to replace it.`);
    throw new PageleafError(`Could not write output file "${outputPath}": ${error.message}`);
  }

  return { inputPath, outputPath, markdown, html };
}

export function parseCommandLine(args) {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        title: { type: 'string' },
        theme: { type: 'string' },
        out: { type: 'string' },
        open: { type: 'boolean' },
        force: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' }
      }
    });
  } catch (error) {
    throw new UsageError(error.message);
  }

  if (parsed.values.help || parsed.values.version) return parsed;
  if (parsed.positionals.length !== 1) throw new UsageError('Provide exactly one input file or folder.');
  if (parsed.values.title !== undefined) cleanTitle(parsed.values.title);
  if (parsed.values.out !== undefined && !parsed.values.out.trim()) throw new UsageError('Output folder must contain visible text.');
  if (parsed.values.theme !== undefined && !THEMES.includes(parsed.values.theme)) {
    throw new UsageError(`Unknown theme "${parsed.values.theme}". Choose one of: ${THEMES.join(', ')}.`);
  }
  return parsed;
}

export async function openInBrowser(filePath, platform = process.platform) {
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd.exe' : 'xdg-open';
  const args = platform === 'win32' ? ['/d', '/s', '/c', 'start', '', filePath] : [filePath];

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with status ${code}`)));
  });
}

export async function run(args, io = console) {
  const parsed = parseCommandLine(args);
  if (parsed.values.help) {
    io.log(HELP);
    return null;
  }
  if (parsed.values.version) {
    io.log(VERSION);
    return null;
  }

  const result = await generateSite(parsed.positionals[0], parsed.values);
  io.log(`Created ${result.outputPath}`);
  if (parsed.values.open) {
    try {
      await openInBrowser(result.outputPath);
    } catch (error) {
      throw new PageleafError(`Created "${result.outputPath}", but could not open it: ${error.message}. Open the file manually.`);
    }
  }
  return result;
}

export function formatCliError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return `pageleaf: ${message}${error instanceof UsageError ? '\nRun "pageleaf --help" for usage.' : ''}`;
}
