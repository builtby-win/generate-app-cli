#!/usr/bin/env node

import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import pc from 'picocolors'
import prompts from 'prompts'
import tiged from 'tiged'

const PURCHASE_URL = 'https://buy.polar.sh/polar_cl_roG7nfaMGE2RfMg9LKoPFZCzrz6XGuDxYlhag1f56kM'

// Template definitions
interface Template {
  name: string
  description: string
  repo: string
  prompts: prompts.PromptObject[]
  transform: (projectDir: string, answers: Record<string, string>) => void
}

// Utility functions
function toKebabCase(str: string): string {
  return str
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/(^-|-$)/g, '')
    .toLowerCase()
}

function toSnakeCase(str: string): string {
  return toKebabCase(str).replace(/-/g, '_')
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceInFile(filePath: string, replacements: Array<{ from: string; to: string }>) {
  if (!fs.existsSync(filePath)) {
    return
  }

  let content = fs.readFileSync(filePath, 'utf-8')
  let modified = false

  for (const { from, to } of replacements) {
    const regex = new RegExp(escapeRegex(from), 'g')
    if (regex.test(content)) {
      content = content.replace(new RegExp(escapeRegex(from), 'g'), to)
      modified = true
    }
  }

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf-8')
    console.log(`  ${pc.green('✓')} ${path.relative(process.cwd(), filePath)}`)
  }
}

function getRunCommand(packageManager: string): string {
  return packageManager === 'npm' ? 'npm run' : packageManager
}

function rewritePackageManagerCommands(projectDir: string, packageManager: string): void {
  const runCommand = getRunCommand(packageManager)
  const replacements = [
    { from: 'pnpm dev', to: `${runCommand} dev` },
    { from: 'pnpm setup', to: `${runCommand} setup` },
    { from: 'pnpm setup:complete', to: `${runCommand} setup:complete` },
    { from: 'pnpm setup:cloudflare', to: `${runCommand} setup:cloudflare` },
    { from: 'pnpm setup:polar', to: `${runCommand} setup:polar` },
    { from: 'pnpm setup:deploy', to: `${runCommand} setup:deploy` },
  ]
  const files = [
    'README.md',
    'CUSTOMIZATION.md',
    '.env.example',
    'src/lib/setup-status.ts',
    'src/components/islands/setup-widget.tsx',
    'src/content/docs/docs/setup.mdx',
  ]

  for (const file of files) {
    replaceInFile(path.join(projectDir, file), replacements)
  }
}

function escapeSingleQuotes(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function getStringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'string' ? property : undefined
}

function getNumberProperty(value: unknown, key: string): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const property = (value as Record<string, unknown>)[key]
  return typeof property === 'number' ? property : undefined
}

function getErrorText(error: unknown): string {
  const parts = [
    error instanceof Error ? error.message : undefined,
    getStringProperty(error, 'message'),
    getStringProperty(error, 'shortMessage'),
    getStringProperty(error, 'stderr'),
    getStringProperty(error, 'stdout'),
  ]

  return parts.filter((part): part is string => Boolean(part)).join('\n')
}

function isTemplateAccessError(error: unknown): boolean {
  const text = getErrorText(error).toLowerCase()

  return [
    'could not find commit',
    'repository not found',
    'could not read from remote repository',
    'authentication failed',
    'permission denied',
    'could not read username',
  ].some((message) => text.includes(message))
}

function updateWebSiteConfig(
  projectDir: string,
  updates: { productName: string; description: string; domain: string },
): void {
  const configPath = path.join(projectDir, 'config/site-config.ts')
  if (!fs.existsSync(configPath)) {
    return
  }

  let content = fs.readFileSync(configPath, 'utf-8')

  const setProp = (key: string, value: string) => {
    const escaped = escapeSingleQuotes(value)
    const regex = new RegExp(`${key}:\\s*['"][^'"]*['"]`)
    content = content.replace(regex, `${key}: '${escaped}'`)
  }

  setProp('name', updates.productName)
  setProp('description', updates.description)
  setProp('url', `https://${updates.domain}`)
  setProp('twitter', '')
  setProp('github', '')
  setProp('databaseId', '')

  content = content.replace(
    /href:\s*'https:\/\/builtby\.win\/ston'/,
    `href: 'https://${updates.domain}/about'`,
  )

  fs.writeFileSync(configPath, content, 'utf-8')
  console.log(`  ${pc.green('✓')} config/site-config.ts`)
}

function canUseSsh(): boolean {
  try {
    execSync('ssh -o BatchMode=yes -T git@github.com', { stdio: 'ignore', timeout: 5000 })
    return false
  } catch (error) {
    return getNumberProperty(error, 'status') === 1
  }
}

// Desktop template (Tauri)
const desktopTemplate: Template = {
  name: 'Desktop App',
  description: 'Native desktop app — users download & install on Mac, Windows, Linux',
  repo: 'builtby-win/desktop',
  prompts: [
    {
      type: 'text',
      name: 'appName',
      message: 'App name (e.g., "focus-hook")',
      validate: (v) =>
        /^[a-zA-Z0-9-_\s]+$/.test(v) || 'Only letters, numbers, hyphens, underscores, and spaces',
    },
    {
      type: 'text',
      name: 'productName',
      message: 'Product name (window title)',
      initial: (_, values) => values.appName || '',
    },
    {
      type: 'text',
      name: 'bundleIdentifier',
      message: 'Bundle identifier (e.g., com.example.myapp)',
      initial: (_, values) =>
        `com.example.${toKebabCase(values.appName || 'app').replace(/-/g, '')}`,
      validate: (v) =>
        /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(v) || 'Must be reverse DNS format',
    },
  ],
  transform: (projectDir, answers) => {
    const files = [
      'package.json',
      'src-tauri/Cargo.toml',
      'src-tauri/Cargo.lock',
      'src-tauri/tauri.conf.json',
      'src-tauri/src/main.rs',
      'src-tauri/src/db.rs',
      'src-tauri/src/bin/export-bindings.rs',
      'scripts/release.sh',
      'scripts/release-debug.sh',
      'README.md',
    ]

    const replacements = [
      { from: 'my-app', to: toKebabCase(answers.appName) },
      { from: 'my_app', to: toSnakeCase(answers.appName) },
      { from: 'My App', to: answers.productName },
      { from: 'com.example.myapp', to: answers.bundleIdentifier },
      { from: '"schemes": ["my-app"]', to: `"schemes": ["${toKebabCase(answers.appName)}"]` },
    ]

    for (const file of files) {
      replaceInFile(path.join(projectDir, file), replacements)
    }
  },
}

// Web template (Astro marketing/web app)
const webTemplate: Template = {
  name: 'Web App',
  description: 'Website at a URL — accessible on desktop, tablet, and phone',
  repo: 'builtby-win/web',
  prompts: [
    {
      type: 'text',
      name: 'appName',
      message: 'App name (e.g., "my-awesome-app")',
      validate: (v) =>
        /^[a-zA-Z0-9-_\s]+$/.test(v) || 'Only letters, numbers, hyphens, underscores, and spaces',
    },
    {
      type: 'text',
      name: 'productName',
      message: 'Product name (shown in UI)',
      initial: (_, values) =>
        (values.appName || '')
          .split(/[-_\s]+/)
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' '),
    },
    {
      type: 'text',
      name: 'description',
      message: 'Short description (1 sentence)',
      initial: (_, values) => `${values.productName || 'My App'} - Built with love`,
    },
    {
      type: 'text',
      name: 'domain',
      message: 'Domain name (e.g., "example.com")',
      validate: (v) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) || 'Must be a valid domain',
    },
  ],
  transform: (projectDir, answers) => {
    const files = [
      'package.json',
      'astro.config.mjs',
      'wrangler.jsonc',
      'config/site-config.ts',
      'src/lib/auth.ts',
      'src/lib/db.ts',
      'src/lib/schema.ts',
      'src/layouts/base-layout.astro',
      '.env.example',
      'README.md',
      'CUSTOMIZATION.md',
      'src/content/docs/docs/index.mdx',
      'src/content/docs/docs/quickstart.mdx',
      'src/content/docs/docs/setup.mdx',
    ]

    const kebab = toKebabCase(answers.appName)
    const snake = toSnakeCase(answers.appName)

    const replacements = [
      { from: 'my-app', to: kebab },
      { from: 'my_app', to: snake },
      { from: 'ZeroStack', to: answers.productName },
      { from: 'My App', to: answers.productName },
      { from: 'https://builtby.win', to: `https://${answers.domain}` },
    ]

    for (const file of files) {
      replaceInFile(path.join(projectDir, file), replacements)
    }

    updateWebSiteConfig(projectDir, {
      productName: answers.productName,
      description: answers.description,
      domain: answers.domain,
    })

    replaceInFile(path.join(projectDir, 'wrangler.static.jsonc'), [{ from: 'my-app', to: kebab }])
  },
}

const templates: Record<string, Template> = {
  desktop: desktopTemplate,
  web: webTemplate,
}

async function main() {
  console.log()
  console.log(pc.bold(pc.cyan('  create-builtby-app')))
  console.log()

  // Get project name from args or prompt
  let projectName = process.argv[2]

  if (!projectName) {
    const response = await prompts({
      type: 'text',
      name: 'projectName',
      message: 'Project name',
      validate: (v) => v.length > 0 || 'Required',
    })
    projectName = response.projectName
  }

  if (!projectName) {
    console.log(pc.red('Cancelled'))
    process.exit(1)
  }

  const projectDir = path.resolve(process.cwd(), projectName)

  if (fs.existsSync(projectDir)) {
    console.log(pc.red(`Directory ${projectName} already exists`))
    process.exit(1)
  }

  // Select template
  const { templateKey } = await prompts({
    type: 'select',
    name: 'templateKey',
    message: 'What kind of app are you building?',
    choices: Object.entries(templates).map(([key, t]) => ({
      title: t.name,
      description: t.description,
      value: key,
    })),
  })

  if (!templateKey) {
    console.log(pc.red('Cancelled'))
    process.exit(1)
  }

  const template = templates[templateKey]

  // Get template-specific answers
  const answers = await prompts(template.prompts)

  if (Object.keys(answers).length !== template.prompts.length) {
    console.log(pc.red('Cancelled'))
    process.exit(1)
  }

  // Select package manager
  const { packageManager } = await prompts({
    type: 'select',
    name: 'packageManager',
    message: 'Package manager',
    choices: [
      { title: 'npm', value: 'npm' },
      { title: 'yarn', value: 'yarn' },
      { title: 'pnpm', value: 'pnpm' },
      { title: 'bun', value: 'bun' },
    ],
  })

  if (!packageManager) {
    console.log(pc.red('Cancelled'))
    process.exit(1)
  }

  // Clone the template
  console.log()
  console.log(pc.cyan('Cloning template...'))

  const preferSsh = canUseSsh()
  const protocols = preferSsh ? ['ssh', 'https'] : ['https', 'ssh']
  let lastError: unknown
  let cloned = false

  for (const protocol of protocols) {
    try {
      // Clean up from previous attempt if needed
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true })
      }

      const repoUrl = template.repo.includes('/')
        ? protocol === 'ssh'
          ? `git@github.com:${template.repo}`
          : `https://github.com/${template.repo}`
        : template.repo

      if (protocols.length > 1 && protocol === protocols[1]) {
        console.log(pc.yellow(`  Retrying with ${protocol.toUpperCase()}...`))
      }

      const emitter = tiged(repoUrl, {
        disableCache: true,
        mode: 'git',
      })

      emitter.on('info', (info) => {
        if (info.message) {
          console.log(`  ${pc.dim(info.message)}`)
        }
      })

      await emitter.clone(projectDir)
      cloned = true
      break
    } catch (error) {
      lastError = error
      // Continue to next protocol
    }
  }

  if (!cloned) {
    if (isTemplateAccessError(lastError)) {
      console.log()
      console.log(pc.red('Error: Could not access the template repository.'))
      console.log()
      console.log('This is a private template. To use it, you need to:')
      console.log(`  1. Purchase access at ${PURCHASE_URL}`)
      console.log('  2. Accept the GitHub repository invitation')
      console.log('  3. Make sure you are authenticated with GitHub:')
      console.log('     - HTTPS: run `gh auth login`')
      console.log('     - SSH: ensure your key is added to GitHub')
      console.log('  4. Restart this process after access is granted')
      console.log()
      process.exit(1)
    }
    throw lastError
  }

  // Remove packageManager field and fix Cloudflare config
  const packageJsonPath = path.join(projectDir, 'package.json')
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
  delete packageJson.packageManager
  packageJson.name = toKebabCase(answers.appName)

  if (templateKey === 'web') {
    packageJson.scripts.preview = 'wrangler dev --local'
  }

  fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf-8')

  // Apply transformations
  console.log()
  console.log(pc.cyan('Customizing project...'))
  template.transform(projectDir, answers)
  rewritePackageManagerCommands(projectDir, packageManager)

  if (!fs.existsSync(path.join(projectDir, '.git'))) {
    try {
      execSync('git init', { cwd: projectDir, stdio: 'ignore' })
      console.log(`  ${pc.green('✓')} initialized git repository`)
    } catch {
      console.log(pc.yellow('  Could not initialize git. Run git init manually before your first commit.'))
    }
  }

  // Remove files that shouldn't be in generated projects
  const filesToRemove = [
    'scripts/generate-app.ts',
    'scripts/rename-app.ts',
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
  ]
  for (const file of filesToRemove) {
    const filePath = path.join(projectDir, file)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  }

  // Create .assetsignore for Cloudflare Workers deployment
  if (templateKey === 'web') {
    const assetsIgnorePath = path.join(projectDir, '.assetsignore')
    fs.writeFileSync(assetsIgnorePath, '_worker.js\n_redirects\n_headers\n', 'utf-8')
    console.log(`  ${pc.green('✓')} .assetsignore`)
  }

  // Install dependencies
  console.log()
  console.log(pc.cyan('Installing dependencies...'))
  try {
    execSync(`${packageManager} install`, { cwd: projectDir, stdio: 'inherit' })
  } catch {
    console.log(
      pc.yellow(`  Could not install dependencies. Run ${packageManager} install manually.`),
    )
  }

  // Done!
  console.log()
  console.log(pc.green('Done!'))
  console.log()
  console.log('Next steps:')
  console.log(`  ${pc.cyan('cd')} ${projectName}`)

  const runCmd = getRunCommand(packageManager)

  if (templateKey === 'desktop') {
    console.log(`  ${pc.cyan(`${runCmd} setup:polar`)} - Configure Polar.sh license`)
    console.log(`  ${pc.cyan(`${runCmd} tauri dev`)} - Start development`)
  } else if (templateKey === 'web') {
    console.log(`  ${pc.cyan(`${runCmd} setup`)} - Set up Cloudflare D1, auth, and more`)
    console.log(`  ${pc.cyan(`${runCmd} dev`)} - Start development`)
    console.log(`  ${pc.cyan('open http://localhost:4321/docs/setup/')} - Check setup status`)
    console.log(`  ${pc.cyan(`${runCmd} setup:deploy`)} - Configure Cloudflare production deploy`)
  }

  console.log()
}

main().catch((error) => {
  console.error(pc.red('Error:'), error.message)
  process.exit(1)
})
