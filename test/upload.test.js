import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import { parseCommandLine, UsageError } from '../lib/pageleaf.js';
import { executeUploadCommand, uploadHtml } from '../lib/upload.js';

const execFileAsync = promisify(execFile);
const executable = path.resolve(import.meta.dirname, '../bin/pageleaf.js');

async function fixture(t, { empty = false, branch = 'docs/current' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pageleaf-upload-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const temporary = path.join(root, 'temporary');
  const remote = path.join(root, 'remote.git');
  const seed = path.join(root, 'seed');
  const output = path.join(root, 'guide with spaces.html');
  await mkdir(temporary);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, 'no-global-config'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_COMMITTER_NAME: 'Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.test', GIT_COMMITTER_EMAIL: 'fixture@example.test',
    GIT_AUTHOR_DATE: '2026-09-12T10:00:00Z', GIT_COMMITTER_DATE: '2026-09-12T10:00:00Z' };
  const git = async (args, cwd = seed) => (await executeUploadCommand('git', args, { cwd, env })).stdout.trim();
  await git(['init', '--bare', `--initial-branch=${branch}`, remote], root);
  await git(['init', `--initial-branch=${branch}`, seed], root);
  await git(['remote', 'add', 'origin', remote]);
  if (!empty) {
    await writeFile(path.join(seed, 'keep.txt'), 'Keep this file unchanged.\n');
    // Uploads must bypass .gitignore and clean filters, preserving exact bytes.
    await writeFile(path.join(seed, '.gitignore'), '*.html\n');
    await writeFile(path.join(seed, '.gitattributes'), '*.html text eol=lf\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'Initial files']);
    await git(['push', 'origin', branch]);
  }
  await writeFile(output, '<html>First version\r\n</html>\r\n');
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === 'gh') {
      if (args[0] === '--version') return { stdout: 'gh version fixture', stderr: '' };
      if (args.at(-1) === 'user') return { stdout: JSON.stringify({ login: 'signed-in-user', id: 123 }), stderr: '' };
      return { stdout: JSON.stringify({ full_name: 'team/docs', default_branch: branch, permissions: { push: true } }), stderr: '' };
    }
    const rewritten = [...args];
    if (args.includes('clone')) rewritten[rewritten.length - 2] = pathToFileURL(remote).href;
    return executeUploadCommand(command, rewritten, { ...options, env: { ...options.env,
      GIT_CONFIG_GLOBAL: env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: '1' } });
  };
  const upload = (target = 'team/docs', executor = execute, file = output) => uploadHtml(file, target, { execute: executor, tempRoot: temporary });
  const remoteGit = (args) => git([`--git-dir=${remote}`, ...args], root);
  const count = async () => Number(await remoteGit(['rev-list', '--count', `refs/heads/${branch}`]));
  return { root, temporary, remote, seed, output, calls, execute, upload, git, remoteGit, count, branch };
}

test('upload target parsing accepts a repo or owner/repo and rejects malformed targets', () => {
  for (const target of ['docs', 'my-org/docs.site', 'user/repo_name']) {
    assert.equal(parseCommandLine(['guide.md', '--upload', target]).values.upload, target);
  }
  assert.equal(parseCommandLine(['guide.md', '--upload=-repo']).values.upload, '-repo');
  for (const target of ['', ' ', '.', '..', '/repo', 'owner/', 'a/b/c', 'https://github.com/a/b',
    'a b', 'a\\b', 'a/repo?x', 'a/repo#x', '-owner/repo', 'owner-/repo', '$(whoami)']) {
    assert.throws(() => parseCommandLine(['guide.md', `--upload=${target}`]), UsageError, target);
  }
  assert.throws(() => parseCommandLine(['guide.md', '--upload']), UsageError);
});

test('Git upload inserts, overwrites, and skips unchanged bytes while preserving other files', async (t) => {
  const f = await fixture(t);
  // Dirty local files and the local index must survive every upload.
  await writeFile(path.join(f.seed, 'keep.txt'), 'Local staged work');
  await f.git(['add', 'keep.txt']);
  const localStatus = await f.git(['status', '--porcelain']);
  const first = await f.upload('docs');
  assert.equal(first.changed, true);
  assert.equal(first.branch, 'docs/current');
  assert.match(first.url, /team\/docs\/blob\/docs\/current\/guide%20with%20spaces.html$/);
  assert.ok(f.calls.some(({ args }) => args.at(-1) === 'repos/signed-in-user/docs'));
  assert.equal(await f.count(), 2);
  assert.equal(await f.remoteGit(['show', 'HEAD:keep.txt']), 'Keep this file unchanged.');
  assert.equal(await f.remoteGit(['show', 'HEAD:guide with spaces.html']), '<html>First version\r\n</html>');
  assert.equal(await f.remoteGit(['log', '-1', '--format=%ae']), '123+signed-in-user@users.noreply.github.com');
  assert.equal(await f.remoteGit(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']), 'guide with spaces.html');
  assert.equal((await f.upload()).changed, false);
  assert.equal(await f.count(), 2);

  await writeFile(f.output, '<html>Replacement</html>');
  assert.equal((await f.upload()).changed, true);
  assert.equal(await f.remoteGit(['show', 'HEAD:guide with spaces.html']), '<html>Replacement</html>');
  assert.equal(await f.count(), 3);
  assert.equal(await f.git(['status', '--porcelain']), localStatus);
  assert.equal(await f.git(['show', ':keep.txt']), 'Local staged work');
  assert.deepEqual(await readdir(f.temporary), []);
  for (const { command, args, options } of f.calls) {
    assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
    assert.equal(options.env.GH_PROMPT_DISABLED, '1');
    if (command === 'git' && args.includes('push')) assert.ok(!args.includes('--force'));
  }
});

test('an existing empty repository receives an initial commit on its configured default branch', async (t) => {
  const f = await fixture(t, { empty: true, branch: 'site' });
  assert.equal((await f.upload()).branch, 'site');
  assert.equal(await f.count(), 1);
  assert.equal(await f.remoteGit(['ls-tree', '--name-only', 'refs/heads/site']), 'guide with spaces.html');
  assert.deepEqual(await readdir(f.temporary), []);
});

test('a remote symlink becomes a regular HTML file without changing its former target', async (t) => {
  const f = await fixture(t);
  const blob = (await executeUploadCommand('git', ['hash-object', '-w', '--stdin'], { cwd: f.seed, input: 'keep.txt' })).stdout.trim();
  await f.git(['update-index', '--add', '--cacheinfo', '120000', blob, 'guide with spaces.html']);
  await f.git(['commit', '-m', 'Add symlink']);
  await f.git(['push', 'origin', f.branch]);
  await f.upload();
  assert.match(await f.remoteGit(['ls-tree', 'HEAD', 'guide with spaces.html']), /^100644 blob/);
  assert.equal(await f.remoteGit(['show', 'HEAD:keep.txt']), 'Keep this file unchanged.');
});

test('concurrent remote commits cause a safe rejection; retry preserves the concurrent change', async (t) => {
  const f = await fixture(t);
  let concurrent = false;
  await assert.rejects(() => f.upload('team/docs', async (command, args, options) => {
    if (command === 'git' && args.includes('push') && !concurrent) {
      concurrent = true;
      await writeFile(path.join(f.seed, 'concurrent.txt'), 'Another contributor');
      await f.git(['add', 'concurrent.txt']);
      await f.git(['commit', '-m', 'Concurrent change']);
      await f.git(['push', 'origin', f.branch]);
    }
    return f.execute(command, args, options);
  }), /branch changed during upload, retry/);
  assert.equal(await f.count(), 2);
  assert.equal(await f.remoteGit(['show', 'HEAD:concurrent.txt']), 'Another contributor');
  await f.upload();
  assert.equal(await f.count(), 3);
  assert.equal(await f.remoteGit(['show', 'HEAD:concurrent.txt']), 'Another contributor');
  assert.deepEqual(await readdir(f.temporary), []);
});

test('a directory with the output filename is preserved and the error explains how to rename the output', async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.seed, 'guide with spaces.html'));
  await writeFile(path.join(f.seed, 'guide with spaces.html', 'keep.txt'), 'Keep this directory');
  await f.git(['add', '-f', 'guide with spaces.html/keep.txt']);
  await f.git(['commit', '-m', 'Directory at upload path']);
  await f.git(['push', 'origin', f.branch]);
  await assert.rejects(() => f.upload(), /is a directory.*Rename the input/);
  assert.equal(await f.count(), 2);
  assert.equal(await f.remoteGit(['show', 'HEAD:guide with spaces.html/keep.txt']), 'Keep this directory');
  assert.deepEqual(await readdir(f.temporary), []);
});

test('missing tools, auth, repositories, permissions, transport, and unexpected errors have next steps', async (t) => {
  const f = await fixture(t);
  const scenarios = [
    { match: (c, a) => c === 'gh' && a[0] === '--version', error: { code: 'ENOENT' }, expected: /GitHub CLI.*not found.*Install.*gh auth login/ },
    { match: (c, a) => c === 'git' && a[0] === '--version', error: { code: 'ENOENT' }, expected: /Git was not found.*Install.*PATH/ },
    { match: (c, a) => c === 'gh' && a.at(-1) === 'user', error: { code: 1, stderr: 'Bad credentials' }, expected: /identify.*Bad credentials[\s\S]*gh auth login/ },
    { match: (c, a) => c === 'gh' && a.at(-1)?.startsWith('repos/'), error: { code: 1, stderr: 'HTTP 404' }, expected: /HTTP 404[\s\S]*gh repo create team\/docs --private/ },
    { match: (c, a) => c === 'gh' && a.at(-1)?.startsWith('repos/'), json: { full_name: 'team/docs', default_branch: 'main', permissions: { push: false } }, expected: /do not have push access[\s\S]*write access/ },
    { match: (c, a) => c === 'gh' && a.at(-1)?.startsWith('repos/'), json: { full_name: 'team/docs', default_branch: 'main', archived: true }, expected: /archived or disabled.*restore write access/ },
    { match: (c, a) => c === 'git' && a.includes('clone'), error: { code: 128, stderr: 'Could not resolve host' }, expected: /clone.*Could not resolve host[\s\S]*network connection/ },
    { match: (c, a) => c === 'git' && a.includes('push'), error: { code: 1, stderr: 'GH013: Repository rule violations' }, expected: /GH013[\s\S]*branch protection.*pull request/ },
    { match: (c, a) => c === 'git' && a.includes('push'), error: { killed: true }, expected: /timed out[\s\S]*push may already have succeeded/ },
    { match: (c, a) => c === 'git' && a.includes('write-tree'), error: { stderr: 'disk full' }, expected: /disk full[\s\S]*disk space/ },
    { match: (c, a) => c === 'gh' && a.at(-1) === 'user', stdout: 'unexpected response', expected: /Could not identify[\s\S]*gh auth login/ }
  ];
  for (const scenario of scenarios) {
    await assert.rejects(() => f.upload('team/docs', (command, args, options) => {
      if (!scenario.match(command, args)) return f.execute(command, args, options);
      if (scenario.error) throw Object.assign(new Error('Test command failed'), scenario.error);
      return Promise.resolve({ stdout: scenario.stdout ?? JSON.stringify(scenario.json), stderr: '' });
    }), scenario.expected);
    assert.deepEqual(await readdir(f.temporary), []);
  }
  assert.equal(await f.count(), 1, 'failed uploads did not change the remote');
});

test('filesystem failures retain context and credentials are redacted from command errors', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => uploadHtml(f.output, 'team/docs', { tempRoot: path.join(f.root, 'missing') }), /prepare the upload[\s\S]*permissions/);
  await assert.rejects(() => f.upload('team/docs', f.execute, path.join(f.root, 'missing.html')), /prepare the HTML commit[\s\S]*permissions/);
  await assert.rejects(() => f.upload('team/docs', (command, args, options) => {
    if (args.includes('clone')) throw new Error('Failed https://secret@github.com/team/docs.git ghp_secret github_pat_secret');
    return f.execute(command, args, options);
  }), (error) => !error.message.includes('secret') && error.message.includes('[redacted]'));
  assert.deepEqual(await readdir(f.temporary), []);
});

test('the executable documents upload, validates usage, and preserves HTML after a missing-tool failure', async (t) => {
  const f = await fixture(t);
  const { stdout } = await execFileAsync(process.execPath, [executable, '--help']);
  assert.match(stdout, /--upload <\[owner\/\]repo>/);
  await assert.rejects(() => execFileAsync(process.execPath, [executable, 'missing.md', '--upload', 'a/b/c']),
    (error) => error.code === 2 && /Invalid upload target/.test(error.stderr));
  const input = path.join(f.root, 'guide.md');
  await writeFile(input, '# Guide\n\nHello.');
  const env = { ...process.env, PATH: f.temporary };
  // Windows environment keys are case insensitive.
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'PATH' && key !== 'PATH') delete env[key];
  await assert.rejects(() => execFileAsync(process.execPath, [executable, input, '--upload', 'docs'], { cwd: f.root, env }),
    (error) => error.code === 1 && /GitHub CLI.*not found/.test(error.stderr)
      && /Generated HTML remains/.test(error.stderr) && /--force/.test(error.stderr));
  assert.match(await readFile(path.join(f.root, 'guide.html'), 'utf8'), /# Guide/);
  // Normal generation must not require Git or gh.
  await execFileAsync(process.execPath, [executable, input, '--force'], { cwd: f.root, env });
});
