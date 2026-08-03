# Architecture

FirstSeen is a Next.js application on Vercel backed by Supabase Auth and PostgreSQL. Inngest owns
durable scheduling and asynchronous orchestration. Official ATS and employer connectors produce
authoritative observations; Brave and Adzuna only discover candidates for verification.

The processing sequence is: discover, verify, canonicalize, fingerprint, detect material change,
apply deterministic eligibility, perform schema-constrained AI extraction for new/changed jobs,
calculate separate ranking dimensions, route queues, and notify. A transactional outbox connects
database commits to workflow events. External calls never occur in database transactions.
