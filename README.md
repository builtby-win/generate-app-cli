# create-builtby-app

Generate apps from [builtby.win](https://builtby.win) templates.

## Usage

```bash
npx @builtby.win/cli my-project
```

Or using the bin name:

```bash
npx create-builtby-app my-project
```

## Templates

### Desktop App (Tauri)

A full-featured desktop application template with:

- Tauri + React + TypeScript
- SQLite database with SeaORM
- Polar.sh license management
- Auto-updates via GitHub releases
- macOS code signing

### Web App (Astro)

A full-stack web app template with:

- Astro SSR + Cloudflare Pages
- tRPC for type-safe APIs
- better-auth (Google OAuth, email/password, magic link)
- Cloudflare D1 database with Drizzle ORM
- Polar.sh payments integration
- Notion-powered blog
- Resend transactional email

## Prerequisites

These are **premium templates**. To use them:

1. Purchase access at [polar.sh/builtby-win](https://polar.sh/checkout/polar_c_fn71EPc0WhBlx36diBJW0kQ89g1Txm4emzAPa0SjLwk)
2. Accept the GitHub repository invitation you receive
3. Make sure you're authenticated with GitHub:
   ```bash
   gh auth login
   ```

## License

MIT
