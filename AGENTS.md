# Repository Instructions

## npm release workflow

A GitHub push does not publish Pageleaf to npm. Publish each release explicitly:

1. Start from a clean, current `main` branch:

   ```bash
   git pull --ff-only
   npm test
   ```

2. Choose the Semantic Versioning bump:

   ```bash
   npm version patch  # bug fix: 0.1.0 -> 0.1.1
   npm version minor  # compatible feature: 0.1.0 -> 0.2.0
   npm version major  # breaking change: 0.1.0 -> 1.0.0
   ```

   Run only one of these commands. It updates `package.json` and `package-lock.json`, creates a version commit, and tags that commit.

3. Inspect the package without publishing it:

   ```bash
   npm publish --dry-run
   ```

4. Push the version commit and tag:

   ```bash
   git push origin main --follow-tags
   ```

5. Publish with a fresh two-factor authentication code:

   ```bash
   npm publish --access public
   ```

6. Verify the public release:

   ```bash
   npm view pageleaf dist-tags.latest
   npx --yes pageleaf@LATEST_VERSION --version
   ```

Never publish without explicit user authorization. Never ask the user to paste a password, access token, or one-time code into chat. npm versions are immutable: if published contents must change, create a new version instead of attempting to reuse the old one.
