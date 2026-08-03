# FirstSeen

FirstSeen is a private, single-user job-discovery system. It monitors official employer and ATS
career pages, verifies broadly discovered listings against their official sources, applies
deterministic eligibility rules, and produces explainable software-engineering recommendations.

The project is under active implementation. Verified setup and operations instructions will be
added as each milestone passes its quality gates.

## Safety

- Never commit `.env.local`, `.env.test`, provider tokens, webhooks, database URLs, or service keys.
- Search and aggregator results are discovery signals only. Official employer listings are
  authoritative.
- AI extracts and explains requirements; deterministic code owns hard exclusions and lifecycle.
- FirstSeen does not auto-apply, access Gmail, or automate referral outreach.

## Planned production services

- Vercel: web application and Inngest serving endpoint
- Supabase: authentication and PostgreSQL with row-level security
- Inngest: durable scheduled and asynchronous workflows
- OpenAI: schema-constrained extraction and explanation
- Brave and Adzuna: broad discovery sensors
- Slack: exceptional alerts and the morning digest
- Sentry: errors, traces, and releases
