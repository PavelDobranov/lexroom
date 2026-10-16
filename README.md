# Lexroom

Lexroom is a shared law-firm workspace for AI-assisted contract reviews, built as a product engineering take-home assignment.

Three lawyers share a document library and a monthly allowance of 10 successful reviews. Lawyers can request reviews, follow their progress, and inspect findings with severity levels and explanations.

The original requirements are available in [docs/assignment.md](docs/assignment.md).

## Contents

- [Getting started](#getting-started)
- [Product decisions](#product-decisions)
- [Technical approach](#technical-approach)
- [Development process](#development-process)
- [AI session logs](#ai-session-logs)
- [Assumptions and limitations](#assumptions-and-limitations)
- [Time spent](#time-spent)
- [Development reference](#development-reference)

## Getting started

**Prerequisites:** Node.js 20.9+ and npm.

Clone the repository, install dependencies, initialize the database, and start the application:

```bash
git clone https://github.com/PavelDobranov/lexroom.git
cd lexroom

npm ci
npm run db:setup
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Database setup applies migrations and initializes the sample workspace. It is safe to run repeatedly without resetting existing reviews.

No external services, API keys, or additional infrastructure are required.

To run the tests:

```bash
npm test
```

## Product decisions

The assignment presents three disagreements between the product manager and the senior partner.

My guiding principle was to **provide useful information as early as possible without misleading lawyers about review results or the availability of their monthly allowance**.

### 1. Keep previous results accessible

**Decision:** Preserve the latest successful review while a new review is running or after it fails.

This addresses the product manager's concern about leaving lawyers without useful information. However, previous findings appear in a clearly separated **"Previous completed review"** section, so they cannot be mistaken for the current review.

Partial findings from failed reviews are never presented as completed results.

**Implementation:** [Review result panel](src/app/_review/components/review-result-panel.tsx)

### 2. Show findings progressively

**Decision:** Display findings as they become available, but unmistakably identify them as preliminary.

During execution, findings appear under **"Review in progress — preliminary findings"**, accompanied by a persistent **"Not final"** label.

Only a successfully completed review produces a final result. A completed review without findings displays **"No issues flagged."**

This preserves the product manager's progressive-feedback experience while respecting the senior partner's requirement that incomplete results must never appear final.

**Implementation:** [Review presentation](src/app/_review/presentation.ts) · [Review result panel](src/app/_review/components/review-result-panel.tsx)

### 3. Reject requests when the allowance is unavailable

**Decision:** Do not queue or defer reviews to a future month.

The product manager proposed accepting requests beyond the monthly allowance and automatically executing them after the next reset.

I deliberately rejected this approach. Accepting a request that might not run for weeks would create a misleading expectation, directly contradicting the senior partner's requirements.

Instead, the application distinguishes two conditions:

- **Allowance exhausted:** All 10 monthly reviews have completed. Capacity returns next UTC month.
- **Temporarily reserved:** Running reviews occupy the remaining capacity. A failed review may release a slot.

The confirmation dialog shows completed, reserved, and available reviews before a lawyer submits a request.

**Implementation:** [Review service](src/server/reviews/review-service.ts) · [Confirmation dialog](src/app/_review/components/review-confirmation-dialog.tsx)

## Technical approach

Lexroom is intentionally designed as a small, single-deployable application, with minimal infrastructure and a clear separation between the frontend, backend, and shared contracts.

### Technology stack

| Technology | Responsibility |
|---|---|
| Next.js App Router, React, TypeScript | Frontend application |
| Hono | REST API served alongside Next.js |
| SQLite + Drizzle ORM | Persistent, authoritative application state |
| TanStack Query | Client-side server state and polling |
| Tailwind CSS | Styling |
| Vitest | Automated testing |

### Review lifecycle

Reviews execute asynchronously and have three possible states: `running`, `completed`, or `failed`.

A fake AI runner progressively emits predefined findings from the sample documents and simulates three possible outcomes:

- **70% normal:** Completes in 5–30 seconds.
- **20% AI failure:** Fails after emitting zero or more findings.
- **10% slow:** Would complete in 60–120 seconds, but is permanently timed out by the application at 60 seconds.

The implementation enforces several important guarantees:

- **Concurrency:** At most one review may run per document. SQLite transactions and database constraints prevent conflicting requests and allowance overspending.
- **Allowance:** Starting a review reserves capacity. Completion consumes it; failure releases it. Reviews are attributed to their request month in UTC.
- **Timeouts:** A review still running at 60 seconds fails permanently. Late findings or completion events cannot change its result.
- **Idempotency:** Request IDs prevent accidental duplicate submissions. An intentional retry creates a new Review.
- **Recovery:** Reviews interrupted by a process restart are marked failed and release their reservations rather than being resumed.
- **Result safety:** Preliminary findings, failed reviews, previous completed reviews, and current final results remain clearly distinguishable.

SQLite is the source of truth. The frontend retrieves authoritative snapshots through REST and uses HTTP polling to follow review progress.

The workspace refreshes every five seconds, while an actively viewed running review refreshes every second.

### API

The Hono API is exposed under `/api` through the Next.js application.

| Endpoint | Purpose |
|---|---|
| `GET /api/workspace` | Retrieve lawyers, documents, latest review summaries, and monthly allowance |
| `POST /api/documents/:documentId/reviews` | Request a new review |
| `GET /api/reviews/:reviewId` | Retrieve the current review state and findings |
| `GET /api/health` | Health check |

REST responses are authoritative. Review state transitions, quota enforcement, and concurrency rules remain server-side.

### Project structure

The frontend is organized by feature, while the backend is separated by responsibility.

```text
src/
├── app/
│   ├── _workspace/    # Workspace UI, queries, presentation
│   ├── _review/       # Review UI, queries, presentation
│   ├── api/           # Next.js adapter for Hono
│   └── page.tsx       # Application entrypoint
├── server/
│   ├── app.ts         # Hono API routes
│   ├── db/            # SQLite schema and setup
│   ├── workspace/     # Workspace read model
│   └── reviews/       # Review lifecycle and fake AI runner
└── shared/
    └── api.ts         # Shared HTTP contracts
```

Tests are colocated with the code they cover.

The application runs in a single Node.js process using one local SQLite database. This deliberately avoids the overhead of distributed coordination, durable queues, and additional services.

The rationale is documented in [ADR 0001 — Single-process review runtime](docs/adr/0001-single-process-review-runtime.md).

## Development process

### AI-assisted engineering approach

I used AI coding agents throughout the project, but deliberately separated product decisions, specifications, implementation, and verification.

Rather than providing the complete assignment to an agent and asking it to implement everything in one pass, I established a high-level roadmap and progressively refined its milestones.

My responsibility was to direct that process: evaluate recommendations, resolve product and architectural trade-offs, challenge unnecessary complexity, define scope boundaries, and verify the resulting implementation.

The workflow was organized into four stages:

1. **Grill** — Explore requirements through focused interviews with an agent, challenging assumptions and agreeing on key decisions.
2. **Spec** — Convert those decisions into implementation-ready specifications published as GitHub Issues.
3. **Plan** — Break each specification into smaller, actionable implementation tickets with acceptance criteria and dependencies.
4. **Implement** — Work through individual tickets in focused coding sessions, supported by automated tests and code review.

This workflow was built around agent skills adapted from [mattpocock/skills](https://github.com/mattpocock/skills) and [owainlewis/blueprint](https://github.com/owainlewis/blueprint). The installed skills and their source references are recorded in [skills-lock.json](skills-lock.json).

Additional skills supported the process:

- **`domain-modeling`** — Maintains shared terminology in `GLOSSARY.md` and records durable decisions as architecture decision records.
- **`test`** — Verifies implementation against explicit acceptance criteria.
- **`review`** — Uses an independent agent to examine changes for correctness, regressions, and unnecessary complexity.
- **`improve`** — Simplifies existing code without changing its behavior.

These skills provided structure and repeatability, rather than replacing engineering judgment.

### Planning strategy

The development followed two levels of planning.

First, an initial grilling session produced the high-level [MVP roadmap (#1)](https://github.com/PavelDobranov/lexroom/issues/1), dividing the project into manageable milestones.

Each milestone then received its own focused grilling session, specification, and implementation tickets.

The purpose was to avoid giving the coding agent the complete implementation scope at once. Each session focused on a smaller, explicitly defined problem, with progressively more detailed specifications.

This provided a clear path from initial requirements to implementation while allowing architectural and product decisions to be reconsidered before code was written.

### Specifications and implementation tickets

GitHub Issues served as the source of truth for implementation scope and acceptance criteria.

| Milestone | Specification | Implementation tickets |
|---|---|---|
| M1 — Persistent Workspace Foundation | [#2](https://github.com/PavelDobranov/lexroom/issues/2) | [#3](https://github.com/PavelDobranov/lexroom/issues/3), [#4](https://github.com/PavelDobranov/lexroom/issues/4), [#5](https://github.com/PavelDobranov/lexroom/issues/5) |
| M2 — Correct End-to-End Review Lifecycle | [#10](https://github.com/PavelDobranov/lexroom/issues/10) | [#11](https://github.com/PavelDobranov/lexroom/issues/11), [#12](https://github.com/PavelDobranov/lexroom/issues/12), [#13](https://github.com/PavelDobranov/lexroom/issues/13), [#14](https://github.com/PavelDobranov/lexroom/issues/14) |

The milestone specifications capture the agreed requirements. Their implementation tickets define smaller deliverables and testable outcomes.

### Traceability

The project retains several forms of documentation:

- [Assignment](docs/assignment.md) — Original business requirements and product conflicts.
- [Implementation roadmap](https://github.com/PavelDobranov/lexroom/issues/1) — Milestones and delivery sequence.
- [GitHub Issues](https://github.com/PavelDobranov/lexroom/issues) — Specifications and implementation tickets.
- [GLOSSARY.md](GLOSSARY.md) — Canonical domain terminology.
- [Architecture decisions](docs/adr/) — Durable technical trade-offs.
- [Agent skills](.agents/skills/) — Skills used during planning, implementation, testing, and review.

The recorded AI sessions below preserve the conversations from which these artifacts originated.

## AI session logs

The assignment explicitly requests the logs of AI-assisted development. The exported coding-agent sessions are collected under [`docs/sessions/`](docs/sessions/).

These JSONL files preserve the original interaction history, including agent questions, proposed approaches, decisions, implementation discussions, and iterations. Any personal or confidential information must be removed before submission.

The GitHub Issues contain the finalized, structured decisions; the session exports document how those decisions were reached.

### Session index

| # | Phase | Raw session export | Related issues |
|---|---|---|---|
| 02 | Initial AI coding-agent setup | [`coding-agents-setup.jsonl`](docs/sessions/coding-agents-setup.jsonl) | — |
| 03 | High-level implementation roadmap | [`high-level-implementation-plan.jsonl`](docs/sessions/high-level-implementation-plan.jsonl) | [#1](https://github.com/PavelDobranov/lexroom/issues/1) |
| 04 | M1 — Persistent Workspace Foundation | [`m1-persistent-workspace-foundation.jsonl`](docs/sessions/m1-persistent-workspace-foundation.jsonl) | [#2](https://github.com/PavelDobranov/lexroom/issues/2), [#3](https://github.com/PavelDobranov/lexroom/issues/3), [#4](https://github.com/PavelDobranov/lexroom/issues/4), [#5](https://github.com/PavelDobranov/lexroom/issues/5) |
| 05 | M2 — Correct End-to-End Review Lifecycle | [`m2-review-lifecycle.jsonl`](docs/sessions/m2-review-lifecycle.jsonl) | [#10](https://github.com/PavelDobranov/lexroom/issues/10), [#11](https://github.com/PavelDobranov/lexroom/issues/11), [#12](https://github.com/PavelDobranov/lexroom/issues/12), [#13](https://github.com/PavelDobranov/lexroom/issues/13), [#14](https://github.com/PavelDobranov/lexroom/issues/14) |

### Session-to-code traceability

The recorded sessions can also be connected to specific stages in the repository's Git history:

- **Agent setup:** [Commit `aa7b9dd`](https://github.com/PavelDobranov/lexroom/commit/aa7b9ddb215a593138c793a42a76efecbe8865d5)
- **Initial roadmap:** [Commit `57616f8`](https://github.com/PavelDobranov/lexroom/commit/57616f8760afc77a74eda81b05b4b9c022a784e5)
- **Implementation:** See the linked GitHub Issues and the repository's commit and pull-request history.

The sessions, specifications, tickets, and Git history together provide a traceable record of the AI-assisted development process.

## Assumptions and limitations

### Assumptions

The implementation follows the assignment's intentionally constrained environment:

- **One shared workspace:** All three lawyers access the same document collection and monthly allowance.
- **No authentication:** The acting lawyer is selected in the UI. This identifies who requested a review but does not establish permissions or private views.
- **Fake AI:** Reviews use predefined findings from `samples/documents.json`; no real language model is called.
- **Single-process execution:** The application uses one long-lived Node.js process and one local SQLite database.
- **UTC allowance periods:** The monthly allowance resets at midnight UTC on the first day of each calendar month.

Document uploads, parsing, billing, and real AI integration are outside the requirements.

### Limitations and unfinished work

**1. No server-sent events (SSE)**

Review progress currently uses HTTP polling.

SSE notifications were included in the planned third milestone but deliberately deferred to prioritize a correct end-to-end review lifecycle.

The original assignment does not explicitly require SSE. Polling allows lawyers to follow reviews until completion or failure and provides authoritative server state.

**2. Non-durable review execution**

The fake AI runner executes in the application process.

If that process restarts during a review, the review is marked `failed/interrupted` and its allowance reservation is released. Execution is not resumed.

This is a deliberate simplification for a single-process MVP.

**3. No dedicated review history UI**

Each document exposes its latest review attempt and, when relevant, its latest successful review.

Historical Review records are persisted, but there is no complete history interface.

**4. Single-process deployment**

The architecture does not support multiple application instances, distributed workers, or serverless execution.

These would require a different approach to background execution and coordination.

**5. Best-effort timeout notification**

A scheduled timer provides timely timeout handling, but correctness does not depend on timer precision.

Expired reviews are also reconciled when relevant state is read or modified. Late results cannot change a terminal review or consume allowance.

## Time spent

**Roughly 6.5–7 hours of active work**, exceeding the suggested four-hour timebox.

This estimate is reconstructed from Git commit history and recorded AI development sessions rather than precise time tracking.

The additional time went primarily into:

- Structured requirements refinement and product decisions.
- Correctness of the review lifecycle, particularly concurrency, quota reservations, and timeouts.
- Improving code organization and documenting the development process.

The implemented scope covers the shared workspace, polling-based review lifecycle, and all three required product decisions.

The planned SSE enhancement remains unfinished.

## Development reference

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start the development server |
| `npm run build` | Create a production build |
| `npm start` | Serve an existing production build |
| `npm test` | Run the Vitest test suite |
| `npm run lint` | Run ESLint |
| `npm run db:setup` | Apply migrations and initialize sample data |

After changing the application, run:

```bash
npm test
npm run lint
npm run build
```

### Database workflow

The default SQLite database is stored at `data/lexroom.db`. The directory is ignored by Git.

Database initialization applies checked-in Drizzle migrations and loads public sample data.

The setup command is designed to be safe to repeat: it preserves matching records and existing reviews rather than resetting the database.

#### Custom database path

Set `DATABASE_URL` to use a different SQLite file:

```bash
DATABASE_URL=/tmp/lexroom.sqlite npm run db:setup
DATABASE_URL=/tmp/lexroom.sqlite npm run dev
```

Despite its name, `DATABASE_URL` represents a filesystem path rather than a network connection string.

Use the same database path for setup and application execution.

#### Resetting local data

To reset the default database:

```bash
rm data/lexroom.db
npm run db:setup
```

**Warning:** This deletes existing local data, including reviews and findings.

#### Schema changes

When changing the database schema:

1. Update [`src/server/db/schema.ts`](src/server/db/schema.ts).
2. Generate and inspect a migration with `npx drizzle-kit generate`.
3. Run `npm run db:setup` against both a fresh and an existing database.
4. Commit the schema changes and generated migration files under [`drizzle/`](drizzle/).

The sample document fixtures contain both public metadata and private fake-AI findings.

Database initialization stores only public document metadata. Findings are persisted individually as reviews emit them and must not be exposed through workspace snapshots before that point.

### Repository conventions

Coding agents and contributors should consult:

- [AGENTS.md](AGENTS.md) — Agent-specific project instructions.
- [GLOSSARY.md](GLOSSARY.md) — Domain vocabulary.
- [docs/agents/](docs/agents/) — Issue tracking and domain documentation conventions.
- [docs/adr/](docs/adr/) — Architectural decisions.

Shared frontend/backend HTTP contracts are defined in [`src/shared/api.ts`](src/shared/api.ts).

The project uses Next.js 16.4. Framework-level changes should follow its version-specific documentation, and Hono changes should follow its official documentation.

These conventions help keep subsequent changes consistent with the architecture and domain decisions already made.