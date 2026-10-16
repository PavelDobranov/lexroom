# Lexroom

Lexroom is a shared law-firm workspace for AI-assisted contract reviews. The MVP models one workspace in which lawyers can browse contracts, request reviews, and track the firm's monthly review allowance.

The product brief and its trade-offs live in [`docs/assignment.md`](docs/assignment.md). Read it before changing product behavior.

## Getting started

### Prerequisites

- Node.js 20.9 or newer
- npm

### First-time setup

```bash
git clone git@github.com:PavelDobranov/lexroom.git
cd lexroom
npm ci
npm run db:setup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The API health check is available at [http://localhost:3000/api/health](http://localhost:3000/api/health).

`db:setup` applies the checked-in Drizzle migrations and reconciles the public sample data in [`samples/`](samples/). It is safe to run repeatedly: matching and unrelated rows are preserved, missing sample rows are inserted, and conflicting sample IDs fail without overwriting or partially loading fixture data.

Application startup deliberately does **not** create, migrate, seed, or reset the database. Run `npm run db:setup` before using a new database file.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Next.js development server |
| `npm run build` | Create a production build and run Next.js type validation |
| `npm start` | Serve an existing production build |
| `npm run db:setup` | Apply migrations and reconcile sample data |
| `npm test` | Run the Vitest suite once |
| `npm run lint` | Run ESLint |

Before opening a pull request, run:

```bash
npm test
npm run lint
npm run build
```

## Database workflow

The default SQLite database is `data/lexroom.db`. The `data/` directory is ignored by Git.

`DATABASE_URL` selects a different database file. Despite its name, it is a filesystem path, not a network URL:

```bash
DATABASE_URL=/tmp/lexroom.sqlite npm run db:setup
DATABASE_URL=/tmp/lexroom.sqlite npm run dev
```

Use the same `DATABASE_URL` for setup and for the app. To reset the default local database, remove it and recreate it (this destroys local data):

```bash
rm data/lexroom.db
npm run db:setup
```

When changing the schema:

1. Update [`src/server/db/schema.ts`](src/server/db/schema.ts).
2. Generate and inspect a migration with `npx drizzle-kit generate`.
3. Run `npm run db:setup` against a fresh database and an existing database.
4. Commit the schema change and generated files under [`drizzle/`](drizzle/).

The document fixtures contain fake-AI findings as well as public document metadata. Database setup intentionally persists only the public fields; do not expose findings through workspace APIs before a review emits them.

## Repository map

```text
src/app/                 Next.js App Router pages, UI, and browser queries
src/app/api/             Next.js adapter that exposes the Hono API
src/server/app.ts        Hono routes and API error handling
src/server/db/           SQLite connection, Drizzle schema, and setup logic
src/server/workspace/    Workspace read model
src/shared/api.ts        API response contracts shared by client and server
drizzle/                 Checked-in SQL migrations and Drizzle metadata
samples/                 Public seed data and private fake-review inputs
docs/assignment.md       Product brief and required behavior
docs/adr/                Architecture decision records
GLOSSARY.md              Canonical domain language
docs/agents/             Repository conventions for coding agents
```

Tests are colocated with the code they cover and use the `*.test.ts` naming convention.

## Architecture at a glance

- **Web:** Next.js App Router and React
- **API:** Hono, mounted under `/api` by `src/app/api/[[...route]]/route.ts`
- **Client data:** TanStack Query; the workspace snapshot currently refreshes by polling
- **Persistence:** SQLite through `better-sqlite3`, with Drizzle for schema and migrations
- **Styling:** Tailwind CSS
- **Tests:** Vitest

SQLite is the authoritative state. The MVP runs reviews asynchronously in the application process, uses REST for authoritative snapshots, and uses server-sent events for review updates. It is intentionally a single-process design without durable job recovery or multi-instance event delivery. Read [`docs/adr/0001-single-process-review-runtime.md`](docs/adr/0001-single-process-review-runtime.md) before changing this boundary.

## Working in the repository

1. Read [`docs/assignment.md`](docs/assignment.md), [`GLOSSARY.md`](GLOSSARY.md), and the relevant [ADRs](docs/adr/).
2. Use the glossary's domain terms in code and product copy. For example, use **review** rather than “job” and **monthly review allowance** rather than “credits.”
3. Keep shared HTTP contracts in [`src/shared/api.ts`](src/shared/api.ts), rather than duplicating client and server types.
4. Add or update colocated tests with behavior changes.
5. Keep migrations and sample-data behavior backward-compatible unless the change explicitly requires otherwise.
6. Run the full validation set before submitting a pull request.

This project uses Next.js 16.4, whose APIs may differ from older Next.js versions. Consult the versioned guides in `node_modules/next/dist/docs/` before making framework-level changes. Before modifying Hono code, consult the current [Hono documentation](https://hono.dev/llms-small.txt). Coding agents must also follow [`AGENTS.md`](AGENTS.md).

## Issues and decisions

Work is tracked in [GitHub Issues](https://github.com/PavelDobranov/lexroom/issues). From inside the repository, common commands are:

```bash
gh issue list --state open
gh issue view <number>
```

Use an ADR for a durable architectural decision and update `GLOSSARY.md` when the team resolves new domain terminology. Do not silently contradict an existing ADR; call out the conflict and amend or supersede the decision explicitly.
