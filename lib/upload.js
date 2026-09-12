import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PageleafError, UsageError } from './errors.js';

const LOGIN_HELP = 'Run "gh auth login --hostname github.com" (or "gh auth switch --hostname github.com" to select another account), then retry.';
const TARGET_HELP = 'Use --upload repo or --upload owner/repo, for example --upload my-org/my-docs. Supply a repository name, not a URL.';

export function parseUploadTarget(target) {
  const parts = typeof target === 'string' ? target.split('/') : [];
  const repo = parts.at(-1);
  const owner = parts.length === 2 ? parts[0] : undefined;
  if (parts.length < 1 || parts.length > 2 || !/^[A-Za-z0-9_.-]+$/.test(repo ?? '')
      || repo === '.' || repo === '..'
      || (owner !== undefined && !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(owner))) {
    throw new UsageError(`Invalid upload target "${target}". ${TARGET_HELP}`);
  }
  return { owner, repo };
}

// No shell interpolation, interactive prompts, or unbounded child processes.
export function executeUploadCommand(command, args, options = {}) {
  const { input, ...childOptions } = options;
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, {
      encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
      windowsHide: true, ...childOptions
    }, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    // A failed child can close stdin before consuming the HTML.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function errorDetail(error) {
  const detail = error.killed ? 'The command timed out after two minutes.'
    : String(error.stderr?.trim() || error.message || error);
  return detail.replace(/(?:gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+)/g, '[redacted]')
    .replace(/(https?:\/\/)[^\s/@]+@/g, '$1[redacted]@').slice(0, 2000);
}

function uploadEnvironment() {
  const env = { ...process.env };
  // Git may have launched Pageleaf from a hook or another worktree. Never inherit
  // those repository/index/object locations into the temporary repository.
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE',
    'GIT_SHALLOW_FILE', 'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT']) delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_LITERAL_PATHSPECS: '1', GH_PROMPT_DISABLED: '1', GH_HOST: 'github.com', GH_PAGER: 'cat' };
}

export async function uploadHtml(outputPath, target, { execute = executeUploadCommand, tempRoot = os.tmpdir() } = {}) {
  const { owner, repo } = parseUploadTarget(target);
  const env = uploadEnvironment();
  let temporary;
  let failure;
  let stage = 'prepare the upload';
  let nextSteps = 'Check local file permissions and available disk space, then retry.';

  async function command(binary, args, options = {}) {
    try {
      return await execute(binary, args, { cwd: temporary, env, ...options });
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new PageleafError(binary === 'gh'
          ? 'GitHub CLI (gh) was not found. Install it from https://cli.github.com/, ensure gh is on PATH, then run "gh auth login --hostname github.com".'
          : 'Git was not found. Install it from https://git-scm.com/downloads, ensure git is on PATH, and retry.');
      }
      throw error;
    }
  }

  async function json(args) {
    return JSON.parse((await command('gh', ['api', '--hostname', 'github.com', ...args])).stdout);
  }

  try {
    temporary = await mkdtemp(path.join(tempRoot, 'pageleaf-upload-'));
    await command('gh', ['--version']);
    await command('git', ['--version']);
    stage = 'identify the signed-in GitHub user';
    nextSteps = `${LOGIN_HELP} Check your network connection if GitHub cannot be reached.`;
    const user = await json(['user']);
    if (!/^[A-Za-z0-9-]+$/.test(user.login ?? '') || !Number.isSafeInteger(user.id) || user.id <= 0) {
      throw new Error('GitHub returned an invalid user profile.');
    }
    const requested = `${owner ?? user.login}/${repo}`;
    stage = `access GitHub repository "${requested}"`;
    nextSteps = `Check the repository name and your network connection. Run "gh repo view ${requested}" to verify access. If it does not exist, create it with "gh repo create ${requested} --private" (or --public), then retry. ${LOGIN_HELP}`;
    const repository = await json([`repos/${requested}`]);
    if (typeof repository.full_name !== 'string' || !parseUploadTarget(repository.full_name).owner
        || typeof repository.default_branch !== 'string' || !repository.default_branch) {
      throw new Error('GitHub returned invalid repository metadata. Update gh and retry.');
    }
    const fullName = repository.full_name;
    if (repository.archived || repository.disabled) {
      throw new PageleafError(`Repository "${fullName}" is archived or disabled. Ask its owner to restore write access, or choose another --upload repository.`);
    }
    if (repository.permissions?.push === false) {
      throw new PageleafError(`You do not have push access to "${fullName}". Ask its owner for write access and authorize your gh credentials for this repository (including organization SSO, if required), or choose another repository.`);
    }

    const gitOptions = ['-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=!gh auth git-credential',
      '-c', `core.hooksPath=${path.join(temporary, 'no-hooks')}`, '-c', 'commit.gpgSign=false'];
    const gitDirectory = path.join(temporary, 'repository.git');
    const git = (args, options) => command('git', [...gitOptions, `--git-dir=${gitDirectory}`, ...args], options);
    stage = `clone "${fullName}"`;
    nextSteps = `Check your network connection and repository access with "gh repo view ${fullName}". ${LOGIN_HELP}`;
    await command('git', [...gitOptions, 'clone', '--bare', '--depth=1', '--single-branch', '--',
      `https://github.com/${fullName}.git`, gitDirectory]);

    stage = 'prepare the HTML commit';
    nextSteps = 'Check that the generated HTML is still readable, and check available disk space and temporary-directory permissions. Update Git and gh, then retry.';
    let parent;
    try {
      parent = (await git(['rev-parse', '--verify', '--quiet', 'HEAD'])).stdout.trim();
    } catch (error) {
      if (error.code !== 1) throw error;
    }
    // An empty GitHub repository may not advertise HEAD; use its configured
    // default branch for the initial commit instead of the local Git default.
    const branch = parent ? (await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim() : repository.default_branch;
    await git(['check-ref-format', `refs/heads/${branch}`]);
    await git(parent ? ['read-tree', parent] : ['read-tree', '--empty']);
    const filename = path.basename(outputPath);
    if (parent && (await git(['ls-tree', '-z', parent, '--', filename])).stdout.startsWith('040000 tree ')) {
      throw new PageleafError(`Remote path "${filename}" is a directory. Rename the input file or folder to produce a different HTML filename, or choose another --upload repository.`);
    }
    const html = await readFile(outputPath);
    // Write the exact bytes directly into Git's index: no checkout, symlink
    // traversal, attributes/filters, or changes to any other repository file.
    const blob = (await git(['hash-object', '-w', '--stdin'], { input: html })).stdout.trim();
    await git(['update-index', '--add', '--cacheinfo', '100644', blob, filename]);
    const tree = (await git(['write-tree'])).stdout.trim();
    const previousTree = parent ? (await git(['rev-parse', `${parent}^{tree}`])).stdout.trim() : null;
    const url = `https://github.com/${fullName}/blob/${branch.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(filename)}`;
    if (tree === previousTree) return { changed: false, url, repository: fullName, branch };

    const identity = { ...env, GIT_AUTHOR_NAME: user.login, GIT_COMMITTER_NAME: user.login,
      GIT_AUTHOR_EMAIL: `${user.id}+${user.login}@users.noreply.github.com`,
      GIT_COMMITTER_EMAIL: `${user.id}+${user.login}@users.noreply.github.com` };
    const commit = (await git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Update ${filename} with Pageleaf`], { env: identity })).stdout.trim();
    stage = `push "${filename}" to "${fullName}" on branch "${branch}"`;
    nextSteps = 'Check your network, write permissions, token repository access, and organization SSO authorization. If branch protection requires a pull request, upload to a repository that permits direct pushes or commit the generated file through a pull request manually. If the branch changed during upload, retry to include its latest changes. If the connection was lost, check GitHub first: the push may already have succeeded.';
    await git(['push', 'origin', `${commit}:refs/heads/${branch}`]);
    return { changed: true, url, repository: fullName, branch };
  } catch (error) {
    failure = error instanceof PageleafError ? error : new PageleafError(`Could not ${stage}: ${errorDetail(error)}\n${nextSteps}`);
    throw failure;
  } finally {
    if (temporary) {
      try {
        await rm(temporary, { recursive: true, force: true });
      } catch (error) {
        const message = `Could not remove temporary upload directory "${temporary}": ${errorDetail(error)}. Remove this directory manually. The remote upload may already have completed; check GitHub before retrying.`;
        if (failure) failure.message += `\n${message}`;
        else throw new PageleafError(message);
      }
    }
  }
}
