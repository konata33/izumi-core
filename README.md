# Izumi Core

Izumi Core is an independent content platform for the Izumi blog. It owns its
API, identity, content data, and background infrastructure. The public Izumi
website consumes released versions of `@izumi/sdk` over versioned HTTP APIs;
the repositories do not share source code, database access, or filesystem
links.

## Workspace

```text
apps/api       NestJS + Fastify API
packages/sdk   Consumer-safe TypeScript client generated from OpenAPI types
infra          Local infrastructure guidance
```

## Local Start

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm --filter @izumi/api db:migrate
pnpm dev
```

The API health endpoint is `GET /api/v1/health`; interactive OpenAPI
documentation is at `/api/docs`.

Conductor supplies `CONDUCTOR_PORT` to the development server, which takes
precedence over `PORT` when present.

Before exposing a new deployment, replace both placeholder secrets in `.env`.
The first call to `POST /api/v1/auth/setup` must include the deployment-only
`x-izumi-setup-token` header. This prevents an unauthenticated first visitor
from claiming the owner account. Set `CORS_ORIGIN` to the public Izumi website
and the separate Izumi Admin origins in production; an unset production value
denies browser cross-origin requests. Supply multiple origins as a
comma-separated list.

## Public Content API v1

The versioned frontend contract is [Public Content API v1](docs/public-content-api-v1.md).

The public site supplies an API-prefix URL, for example
`IZUMI_CORE_URL=https://core.example.com/api`, then requests these server-side
paths from it:

- `GET /v1/public/posts` — every published post summary, or a validated
  `limit` from 1 through 100.
- `GET /v1/public/posts/:slug` — one published post and its canonical Markdown.

Core exposes those paths as `/api/v1/public/...` in its standard deployment.
The collection omits Markdown; the detail response includes it. Drafts and
incomplete legacy records return `404` or are absent from the archive. Both
success responses use `{ "data": ... }`; errors use the standard
`{ "error": ... }` envelope.

`@izumi/sdk` exports `createIzumiPublicClient`, whose `baseUrl` has the same
API-prefix meaning as `IZUMI_CORE_URL`. The public Izumi site must use it only
in server-side rendering, metadata, RSS, and sitemap code. Markdown remains
canonical source data and must be sanitized by the public renderer before it
becomes HTML.

## Public Profile API v1

The versioned frontend and admin contract is
[Public Profile API v1](docs/public-profile-api-v1.md). Core exposes the
profile endpoints as `/api/v1/public/profile` and the authenticated
`/api/v1/owner/profile`. It intentionally returns `404 PROFILE_NOT_CONFIGURED`
until the owner supplies a complete profile. The public site uses the same
server-only `IZUMI_CORE_URL` API-prefix convention as public posts.

The current slice includes owner setup/login, protected post creation, listing,
reading, and editing; singleton profile replacement; and public post/profile
read endpoints. The private API contracts for the separate `izumi-admin`
repository are documented in [Owner Writing API v1](docs/owner-api-v1.md) and
[Public Profile API v1](docs/public-profile-api-v1.md). Media processing,
comments, real-time events, AI, scheduling, cache invalidation, deletion, and
a broader site-settings dashboard remain outside this milestone.

## Tests

`pnpm test` runs the unit and SDK contract tests. The owner-and-post API
integration test uses PostgreSQL Testcontainers and runs with:

```bash
RUN_INTEGRATION_TESTS=true pnpm test:integration
```
