# MineOps Production Path

This repository now contains the first production backend boundary for MineOps while preserving the current static prototype.

## What changed

- `api/worker.js` adds a Cloudflare Worker API for authenticated MineOps records.
- `migrations/0001_initial.sql` defines the production D1 schema.
- `config/production-seed.json` contains demo organization/site/users/equipment seed data.
- `scripts/seed-d1.cjs` generates SQL seed statements for D1.
- `wrangler.toml` describes the Cloudflare Worker, static assets, and D1 database binding. Evidence/photo storage can be added with R2 after R2 is enabled on the Cloudflare account.

## Production model

MineOps records are scoped by:

- organization
- site/mine
- user role

The first production records are:

- workplace exams
- hazards
- equipment
- equipment checks
- shift logs
- audit events

## Local setup

```bash
npm install
npx wrangler d1 create mineops-production
```

Paste the returned D1 database id into `wrangler.toml`.

Apply schema:

```bash
npx wrangler d1 execute mineops-production --file migrations/0001_initial.sql
```

Seed demo data:

```bash
node scripts/seed-d1.cjs > /tmp/mineops-seed.sql
npx wrangler d1 execute mineops-production --file /tmp/mineops-seed.sql
```

Set an API key before public use:

```bash
npx wrangler secret put MINEOPS_API_KEY
```

Deploy:

```bash
npx wrangler deploy
```

## API authentication

For the current production slice, requests use headers:

```text
X-MineOps-Key: <secret>
X-MineOps-Org: org_demo
X-MineOps-Site: site_demo_mine
X-MineOps-User: user_admin
```

Next step is replacing this header-based bootstrap with a real auth provider such as Clerk, Auth0, or Supabase Auth.

## API routes

- `GET /api/health`
- `GET /api/bootstrap`
- `GET /api/workplace-exams`
- `POST /api/workplace-exams`
- `GET /api/hazards`
- `POST /api/hazards`
- `GET /api/equipment`
- `POST /api/equipment-checks`
- `GET /api/shift-logs`
- `POST /api/shift-logs`
- `GET /api/audit-events`

## Frontend integration plan

The deployed `mineops/index.html` is currently a static prototype. The next code step is to replace its seeded/local data access with a small adapter:

1. Try the production API.
2. Cache successful API responses locally for offline use.
3. Queue offline writes locally.
4. Sync queued writes when online.
5. Keep prototype/demo data only as an explicit demo mode.

That lets the current UI keep working while production data becomes real.
