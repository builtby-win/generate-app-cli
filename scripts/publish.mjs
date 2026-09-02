#!/usr/bin/env node
/**
 * publish.mjs — bump version, ensure npm auth, build & publish
 *
 * Usage:
 *   node scripts/publish.mjs [patch|minor|major|<x.y.z>] [--dry-run] [--no-push] [--no-git-checks]
 *   npm run release              # patch bump + publish
 *   npm run release:minor        # minor bump + publish
 *   npm run release:major        # major bump + publish
 *
 * Steps:
 *   1. git checks (clean working tree, on main/master)
 *   2. bump version (npm version --no-git-tag-version + manual commit/tag)
 *   3. ensure npm auth (whoami -> NPM_TOKEN -> npm login)
 *   4. build (npm run build)
 *   5. publish (npm publish --access public [--dry-run])
 *   6. push commit + tag
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CWD = join(import.meta.dirname ?? '.', '..')
const PKG_PATH = join(CWD, 'package.json')

// --- helpers ---
const $ = (cmd, opts = {}) =>
  execSync(cmd, { cwd: CWD, encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts })
const $$ = (cmd, opts = {}) => {
  try {
    return execSync(cmd, { cwd: CWD, encoding: 'utf8', stdio: 'pipe', ...opts }).trim()
  } catch (e) {
    return null
  }
}
const log = (m) => console.log(`\x1b[36m[publish]\x1b[0m ${m}`)
const ok = (m) => console.log(`\x1b[32m✔\x1b[0m ${m}`)
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`)
const fail = (m) => {
  console.error(`\x1b[31m✖\x1b[0m ${m}`)
  process.exit(1)
}
const hasFlag = (f) => process.argv.includes(f)
const isPnpm = existsSync(join(CWD, 'pnpm-lock.yaml'))

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(`publish.mjs — bump, auth, build, publish

Usage: node scripts/publish.mjs [patch|minor|major|x.y.z] [flags]
       npm run release            patch (default)
       npm run release:minor      minor
       npm run release:major      major
       npm run release:dry        dry-run (no publish/push)

Flags: --dry-run  build + npm publish --dry-run, revert version
       --no-push  skip git push
       --no-git-checks  skip clean-tree check
       --help, -h show this
Examples:
  node scripts/publish.mjs patch --dry-run --no-git-checks
  NPM_TOKEN=npm_xxx node scripts/publish.mjs minor
  node scripts/publish.mjs 0.2.0
`)
  process.exit(0)
}

// --- args ---
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const rawBump = (args[0] || 'patch').toLowerCase()
const VALID_BUMPS = new Set(['patch', 'minor', 'major', 'premajor', 'preminor', 'prepatch', 'prerelease'])
const isExplicitVersion = /^\d+\.\d+\.\d+(-.+)?$/.test(rawBump)
const bump = isExplicitVersion || VALID_BUMPS.has(rawBump) ? rawBump : fail(`Invalid bump: ${rawBump} (use patch|minor|major|x.y.z)`)
const DRY_RUN = hasFlag('--dry-run')
const NO_PUSH = hasFlag('--no-push')
const NO_GIT_CHECKS = hasFlag('--no-git-checks')

if (DRY_RUN) warn('DRY RUN — no publish, no push, version bump will be reverted')

// --- 1. git checks ---
if (!NO_GIT_CHECKS) {
  const porcelain = $$(`git status --porcelain`)
  if (porcelain) {
    console.error(porcelain)
    fail('Working tree not clean. Commit or stash first (or --no-git-checks to override).')
  }
  const branch = $$('git rev-parse --abbrev-ref HEAD')
  if (branch && !['main', 'master'].includes(branch)) {
    warn(`On branch "${branch}" (expected main/master). Continue anyway.`)
  }
} else {
  warn('Skipping git checks (--no-git-checks)')
}

// --- 2. bump version ---
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
const oldVersion = pkg.version
log(`Current version: ${oldVersion} → bump: ${bump}`)

let newVersion
if (isExplicitVersion) {
  newVersion = bump
} else {
  // use npm version to compute next without committing, then revert
  // npm version --no-git-tag-version mutates package.json in place
  try {
    $$(`npm version ${bump} --no-git-tag-version --allow-same-version`, { silent: false }) ??
      (() => { throw new Error('npm version failed') })()
    const next = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version
    newVersion = next
    // revert — we will commit manually so the commit message is consistent
    writeFileSync(PKG_PATH, JSON.stringify({ ...pkg, version: oldVersion }, null, 2) + '\n')
  } catch {
    // fallback: manual semver bump
    const parts = oldVersion.split('.').map(Number)
    if (bump === 'patch') parts[2]++
    else if (bump === 'minor') { parts[1]++; parts[2] = 0 }
    else if (bump === 'major') { parts[0]++; parts[1] = 0; parts[2] = 0 }
    newVersion = parts.join('.')
  }
}

if (!newVersion || newVersion === oldVersion) fail(`Failed to compute new version from ${oldVersion} + ${bump}`)

// write new version
pkg.version = newVersion
writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
ok(`Bumped ${oldVersion} → ${newVersion}`)

if (DRY_RUN) {
  // keep version bump for build test, but stash revert at end
}

// --- 3. ensure npm auth ---
function npmWhoami() {
  try {
    const out = execSync('npm whoami', { encoding: 'utf8', stdio: 'pipe' }).trim()
    return out || null
  } catch {
    return null
  }
}

function tryAuth() {
  let user = npmWhoami()
  if (user) {
    ok(`npm auth OK as "${user}"`)
    return true
  }

  warn('Not authenticated with npm (npm whoami failed)')

  // Try NPM_TOKEN env
  const token = process.env.NPM_TOKEN || process.env.NPM_AUTH_TOKEN
  if (token) {
    log('Found NPM_TOKEN in env — writing to ~/.npmrc')
    const npmrc = `${process.env.HOME}/.npmrc`
    const line = `//registry.npmjs.org/:_authToken=${token}\n`
    try {
      const existing = existsSync(npmrc) ? readFileSync(npmrc, 'utf8') : ''
      if (!existing.includes('_authToken=')) {
        writeFileSync(npmrc, existing + (existing.endsWith('\n') || !existing ? '' : '\n') + line, { mode: 0o600 })
      } else {
        // replace existing token line
        writeFileSync(npmrc, existing.replace(/\/\/registry\.npmjs\.org\/:_authToken=.*\n?/g, '') + line, { mode: 0o600 })
      }
      user = npmWhoami()
      if (user) {
        ok(`Authenticated via NPM_TOKEN as "${user}"`)
        return true
      }
    } catch (e) {
      warn(`Failed to write token to .npmrc: ${e.message}`)
    }
  }

  // Try `npm login` interactively (only if TTY)
  if (process.stdin.isTTY) {
    log('Running `npm login` — follow prompts (needs npm account + 2FA if enabled)')
    const r = spawnSync('npm', ['login'], { stdio: 'inherit', cwd: CWD })
    user = npmWhoami()
    if (r.status === 0 && user) {
      ok(`Authenticated via npm login as "${user}"`)
      return true
    }
  } else {
    warn('No TTY — cannot run npm login interactively')
  }

  // Last resort: npx-friendly hint
  console.error('')
  console.error('  Auth still failing. Fix with one of:')
  console.error('    export NPM_TOKEN=npm_xxx          # automation token from https://www.npmjs.com/settings/tokens')
  console.error('    npm login                         # interactive (requires TTY)')
  console.error('    npm token create --read-only      # if you need a new token')
  console.error('')
  return false
}

if (!DRY_RUN) {
  if (!tryAuth()) fail('npm auth required — aborting publish')
} else {
  const u = npmWhoami()
  if (u) ok(`[dry-run] npm auth OK as "${u}"`)
  else warn('[dry-run] no npm auth — would prompt for login on real publish')
}

// --- 4. build ---
log(`Building (${isPnpm ? 'pnpm' : 'npm'} run build)…`)
try {
  $(`${isPnpm ? 'pnpm' : 'npm'} run build`)
  ok('Build succeeded')
} catch {
  // revert version on build failure
  pkg.version = oldVersion
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
  fail('Build failed — version bump reverted')
}

// verify dist exists (prepublishOnly also builds, but double-check)
if (!existsSync(join(CWD, 'dist'))) {
  warn('No dist/ after build — package.files may be empty')
}

// --- 5. publish ---
const publishCmd = isPnpm ? 'pnpm publish --access public --no-git-checks' : 'npm publish --access public'
const finalCmd = DRY_RUN ? `${publishCmd} --dry-run` : publishCmd

log(`${DRY_RUN ? '[dry-run] ' : ''}Publishing ${newVersion}…  (${finalCmd})`)
try {
  $(finalCmd)
  ok(DRY_RUN ? `Dry-run OK — would have published ${newVersion}` : `Published ${newVersion} to npm`)
} catch {
  // revert version + don't commit
  if (!DRY_RUN) {
    pkg.version = oldVersion
    writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
  }
  fail('npm publish failed — version bump reverted (check 2FA / OTP: npm publish --otp=123456)')
}

if (DRY_RUN) {
  // revert version bump
  pkg.version = oldVersion
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + '\n')
  ok(`Dry-run: reverted version to ${oldVersion}`)
  process.exit(0)
}

// --- 6. git commit + tag + push ---
try {
  $('git add package.json')
  // pnpm-lock.yaml may have version? npm doesn't, but add if changed
  if (existsSync(join(CWD, 'pnpm-lock.yaml'))) {
    const lockDirty = $$('git status --porcelain -- pnpm-lock.yaml')
    if (lockDirty) $('git add pnpm-lock.yaml')
  }
  $(`git commit -m "chore: release v${newVersion}"`)
  $(`git tag v${newVersion}`)
  ok(`Committed and tagged v${newVersion}`)
} catch (e) {
  warn(`Git commit/tag failed: ${e.message} — publish succeeded, commit manually`)
}

if (!NO_PUSH) {
  log('Pushing commit + tag…')
  try {
    $('git push')
    $('git push --tags')
    ok('Pushed to origin')
  } catch (e) {
    warn(`git push failed: ${e.message} — run: git push && git push --tags`)
  }
} else {
  warn('Skipped push (--no-push). Run: git push && git push --tags')
}

ok(`Done — @builtby.win/cli@${newVersion} live 🚀`)
