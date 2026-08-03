# Izumi Core

Izumi Core is an independent content platform for the Izumi blog. It owns its
API, identity, content data, and background infrastructure. The public Izumi
website consumes released versions of `@izumi/sdk` over versioned HTTP APIs;
the repositories do not share source code, database access, or filesystem
links.

## Workspace

```text
apps/api       NestJS + Fastify API, production Admin host
apps/admin     React + Vite Admin SPA
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

In a second terminal, start the Admin development server with `pnpm dev:admin`.
For manual local runs, configure `PORT` (Core, default `3001`) and `ADMIN_PORT`
(Admin, default `5173`) in the root `.env`; the Admin automatically targets that
Core port. Set `VITE_CORE_API_URL` in `apps/admin/.env.local` only when the Admin
should call a different Core origin.

`pnpm build` builds the SDK, Admin, and API in that order. When the API starts
with `apps/admin/dist` present, it serves the Admin SPA at `/admin/`, including
client-side routes such as `/admin/posts`. Set `ADMIN_STATIC_DIR` only when a
deployment stores the Admin build outside the standard workspace path. The API
health endpoint is `GET /api/v1/health`; interactive OpenAPI documentation is
at `/api/docs`.

This repository's Conductor scripts intentionally unset `CONDUCTOR_PORT`, so
the default run actions stay on the memorable four-digit ports `3001` and
`5173`. The run mode is therefore non-concurrent: stop an existing workspace
run before starting another one that uses the same ports. Manual runs can still
override `PORT` and `ADMIN_PORT` in `.env`.

Before exposing a new deployment, replace both placeholder secrets in `.env`.
The first call to `POST /api/v1/auth/setup` must include the deployment-only
`x-izumi-setup-token` header. This prevents an unauthenticated first visitor
from claiming the owner account. Setup and login use the sole Owner's unique
`username` plus a password of at least 12 characters; email is not an
authentication field. Set `CORS_ORIGIN` to the public Izumi website
and any separately deployed Admin origins in production; the bundled `/admin/`
application is same-origin and does not need a CORS entry. An unset production
value denies browser cross-origin requests. Supply multiple origins as a
comma-separated list.

## Public Content API v1

The versioned frontend contract is [Public Content API v1](docs/public-content-api-v1.md).

The public site supplies an API-prefix URL, for example
`IZUMI_CORE_URL=https://core.example.com/api`, then requests these server-side
paths from it:

- `GET /v1/public/posts` — every published post summary, or a validated
  `limit` from 1 through 100.
- `GET /v1/public/posts/:slug` — one immutable publication snapshot with its
  RichDocument and compatibility Markdown.

Core exposes those paths as `/api/v1/public/...` in its standard deployment.
The collection omits document content; the detail response includes it. Drafts and
incomplete legacy records return `404` or are absent from the archive. Both
success responses use `{ "data": ... }`; errors use the standard
`{ "error": ... }` envelope.

`@izumi/sdk` exports `createIzumiPublicClient`, whose `baseUrl` has the same
API-prefix meaning as `IZUMI_CORE_URL`. The public Izumi site must use it only
in server-side rendering, metadata, RSS, and sitemap code. `document` is the
canonical Lexical/Haklex JSON source. `content` is server-derived compatibility
Markdown for older clients and must still be sanitized before rendering as
HTML.

## Public Profile API v1

The versioned frontend and admin contract is
[Public Profile API v1](docs/public-profile-api-v1.md). Core exposes the
profile endpoints as `/api/v1/public/profile` and the authenticated
`/api/v1/owner/profile`. It intentionally returns `404 PROFILE_NOT_CONFIGURED`
until the owner supplies a complete profile. The public site uses the same
server-only `IZUMI_CORE_URL` API-prefix convention as public posts.

The current slice includes owner setup/login, structured article editing,
working-copy revisions and immutable publication snapshots, S3-compatible
media, safe link previews, persistent AI writing sessions, singleton profile
replacement, and public post/profile reads. The private contracts consumed by
`apps/admin` are documented in [Owner Writing API
v1](docs/owner-api-v1.md) and [Public Profile API
v1](docs/public-profile-api-v1.md). Comments, multi-owner collaboration,
scheduling, and deletion remain outside this milestone.

## Rich-content migration

Run `pnpm --filter @izumi/api db:migrate` before starting the upgraded Core.
Migration `0004` adds the working RichDocument and immutable publication
snapshots without replacing the original Markdown. The startup backfill
converts pending rows through Haklex headless conversion:

- successful rows become `contentMigrationState: "native"`;
- failed rows retain their exact Markdown and become `"failed"`;
- retrying `db:migrate` retries only pending/failed conversions and never
  writes an empty document over a non-empty source.

Migration `0005` adds media, media-reference, AI-provider, session, message, and
tool-decision storage.

## Media and AI configuration

The complete S3 group in `.env.example` enables direct upload to MinIO or
another S3-compatible service. The browser uploads through a short-lived POST
policy into a private `<S3_BUCKET>-quarantine` bucket; Core verifies size, MIME
signature, image decoding, dimensions, and ThumbHash before promotion. Only
finalized assets at their canonical
`S3_PUBLIC_BASE_URL` may be published. Local MinIO uses ports `9000` (API) and
`9001` (console).

AI can use a read-only environment provider, encrypted owner BYOK profiles, or
both. `AI_CREDENTIALS_ENCRYPTION_KEY` must be canonical base64 for exactly 32
random bytes; replace the development-only example before production. Owner
keys use AES-256-GCM at rest and are never returned unmasked. Production AI
provider URLs require HTTPS and public, DNS-pinned destinations.

## Tests

`pnpm test` runs the unit and SDK contract tests. The owner-and-post API
integration test uses PostgreSQL Testcontainers and runs with:

```bash
RUN_INTEGRATION_TESTS=true pnpm test:integration
```
