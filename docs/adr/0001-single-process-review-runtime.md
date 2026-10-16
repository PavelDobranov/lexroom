# Use a single-process review runtime for the MVP

Lexroom will ship as one Next.js and Hono application backed by authoritative SQLite state. Contract reviews run asynchronously in that application process without recovery or resumption: interrupted reviews fail and release their quota reservations. Review changes are signalled with SSE, authoritative review snapshots are fetched through REST, and workspace snapshots are refreshed with HTTP polling. This deliberately favors MVP simplicity over horizontal scaling, durable job execution, and multi-instance event delivery.

Quota admission atomically reserves capacity from the UTC calendar month in which a review is requested; success consumes that reservation and failure releases it. The MVP rejects requests when allowance is exhausted or temporarily fully reserved and never queues work for a future month.
