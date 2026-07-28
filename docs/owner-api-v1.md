# Izumi Owner Writing API v1

Status: implementation contract for the `apps/admin` application.

`izumi-core` owns authentication, content rules, and persistence. `apps/admin`
is a browser application in the same monorepo; it must use this HTTP API and
must never connect to PostgreSQL, Redis, or Core's filesystem.

## URL and browser setup

For the owner API, the Core base URL is its origin and optional deployment path
prefix **before** `/api/v1`:

```text
https://core.example.com
https://example.com/core
```

With the first value above, an owner request is made to
`https://core.example.com/api/v1/posts`. This is intentionally different from
the public site's `IZUMI_CORE_URL`, which includes `/api` because its requests
begin with `/v1/public/...`.

For a separately served development build, the admin may expose only the Core
URL as `VITE_CORE_API_URL`. The bundled `/admin/` build uses its own origin by
default. Neither variant may put `OWNER_SETUP_TOKEN`, the JWT secret, or
database credentials in a build-time environment variable.

Core must explicitly allow an admin origin in `CORS_ORIGIN` only when the Admin
is deployed on a different origin:

```text
CORS_ORIGIN=https://admin.example.com
```

Multiple browser origins are comma-separated. For local development with a
public site on port 3000 and an admin site on port 5173:

```text
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

## Envelopes and dates

Every successful response uses a `data` envelope. Every error has an `error`
envelope and an `x-request-id` response header.

```json
{
  "error": {
    "code": "POST_PUBLISHING_INCOMPLETE",
    "message": "Published posts require non-empty title, slug, content, excerpt, and section",
    "details": { "fields": ["excerpt", "section"] },
    "requestId": "..."
  }
}
```

`createdAt`, `updatedAt`, and `publishedAt` are server-authored ISO 8601 UTC
instants. The admin should display them in the reader's local time. The public
website alone converts `publishedAt` to its Asia/Shanghai calendar-date
presentation.

## Owner bootstrap and login

### `POST /api/v1/auth/setup`

This one-time endpoint creates the sole owner. It needs a manually entered
bootstrap token in the `x-izumi-setup-token` request header.

```http
POST /api/v1/auth/setup
x-izumi-setup-token: <deployment bootstrap secret>
content-type: application/json

{
  "email": "owner@example.com",
  "password": "at-least-twelve-characters"
}
```

It returns `201` with an access token. An invalid bootstrap token returns
`403 SETUP_TOKEN_INVALID`; after setup, another setup attempt returns
`409 OWNER_ALREADY_CONFIGURED`. The initial-setup screen should be separate
from normal login and should never persist or log the bootstrap token.

### `POST /api/v1/auth/login`

```json
{
  "email": "owner@example.com",
  "password": "at-least-twelve-characters"
}
```

It returns `200`:

```json
{
  "data": {
    "accessToken": "<JWT>",
    "tokenType": "Bearer",
    "expiresIn": 604800
  }
}
```

All owner post requests require `Authorization: Bearer <accessToken>`. A
missing, invalid, or expired token is `401`; `401 INVALID_CREDENTIALS` from
login means the credentials were rejected. The current API has no refresh or
logout endpoint: expiry or a client-side logout ends the session. The admin
should clear its stored access token on a `401` response and return to login.

## Article model

Every owner response returns the full canonical record:

```ts
type Post = {
  id: string;
  title: string;
  slug: string;
  content: string; // canonical Markdown
  excerpt: string;
  section: string;
  tags: string[];
  readingMinutes: number; // calculated by Core; minimum 1
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

The admin sends Markdown source unchanged; it must not send rendered HTML.
Core calculates `readingMinutes`, trims `excerpt` and `section`, and trims and
case-insensitively de-duplicates tags while keeping the first spelling.

`slug` is globally unique and must match
`^[a-z0-9]+(?:-[a-z0-9]+)*$`. A collision returns `409 POST_SLUG_CONFLICT`.

### `POST /api/v1/posts`

Creates a post and returns `201` with `{ "data": Post }`. It always requires
non-whitespace `title`, `slug`, and `content`, even for a draft. `excerpt`,
`section`, and `tags` are optional for a draft. Therefore the admin should
create a record only after it has collected those three minimum fields, or use
a deliberate non-empty local draft template.

```json
{
  "title": "A slower entry",
  "slug": "a-slower-entry",
  "content": "# A slower entry\n\nCanonical Markdown.",
  "excerpt": "A short introduction.",
  "section": "Notes",
  "tags": ["writing", "website"],
  "status": "draft"
}
```

### `GET /api/v1/posts`

Lists only the logged-in owner's posts, newest creation first. Query parameters
are optional:

```text
page    positive integer; default 1
size    integer from 1 through 100; default 20
status  draft | published
```

```json
{
  "data": {
    "items": ["...Post records..."],
    "page": 1,
    "size": 20,
    "total": 42
  }
}
```

There is no title search endpoint in v1. The first admin can filter the
already-loaded page locally, while a server-side search contract remains a
future Core slice.

### `GET /api/v1/posts/:id`

Returns `200` with `{ "data": Post }`, including drafts. An unknown ID (or a
record belonging to a different owner if multi-owner support is added later)
returns `404 POST_NOT_FOUND`.

### `PATCH /api/v1/posts/:id`

Saves any non-empty subset of editable fields and returns the complete updated
post. Omitted fields are preserved; do not send stale fields merely because an
editor did not change them. An empty object returns `400 POST_UPDATE_EMPTY`.

```json
{
  "content": "# Revised Markdown",
  "tags": ["writing", "revision"]
}
```

Fields that are sent must meet their validation rules. `title` and `content`
cannot be blank; `tags` cannot contain blank values. `excerpt` and `section`
may be blank while a post is a draft.

## Publication state machine

The publish control is an update with `"status": "published"`.

```text
draft --PATCH status=published--> published
published --PATCH status=draft--> draft
```

A published post must have non-empty `title`, `slug`, `content`, `excerpt`, and
`section`; otherwise Core rejects the update with
`400 POST_PUBLISHING_INCOMPLETE` and lists the missing fields in
`error.details.fields`. The admin may pre-check this for clearer UX, but Core
is authoritative.

Core sets `publishedAt` on the first successful publication. Editing an already
published post, unpublishing it, and publishing it again all retain that first
timestamp. A draft can still have a non-null historical `publishedAt`; the
`status` field, not the timestamp, determines public visibility.

There is no delete endpoint in v1. Removing a post is intentionally deferred
until retention and URL-redirect behaviour are designed.

## Expected error handling

| Situation                              | Status / code                      | Admin behaviour                         |
| -------------------------------------- | ---------------------------------- | --------------------------------------- |
| Invalid field, query, or request shape | `400 VALIDATION_ERROR`             | Show field or form feedback.            |
| Publish has missing metadata           | `400 POST_PUBLISHING_INCOMPLETE`   | Highlight `details.fields`.             |
| Empty save request                     | `400 POST_UPDATE_EMPTY`            | Do not retry; retain local edits.       |
| Blank tag after trimming               | `400 POST_TAG_INVALID`             | Ask for valid tags.                     |
| Bootstrap secret invalid               | `403 SETUP_TOKEN_INVALID`          | Keep setup form; never echo the secret. |
| Slug already used                      | `409 POST_SLUG_CONFLICT`           | Let the author choose another slug.     |
| Setup already complete                 | `409 OWNER_ALREADY_CONFIGURED`     | Send the user to normal login.          |
| Bad login or owner token               | `401 INVALID_CREDENTIALS` or `401` | Clear session token when applicable.    |
| Article missing                        | `404 POST_NOT_FOUND`               | Return to list with a clear notice.     |
| Other non-2xx response                 | standard error envelope            | Treat as an outage, not an empty list.  |

## Type-safe client and OpenAPI

Core publishes a generated OpenAPI document at `GET /api/docs-json` and an
interactive viewer at `GET /api/docs`. The current `@izumi/sdk` package also
has `createIzumiClient` for all owner calls. Its `baseUrl` uses the owner-API
meaning above (the URL before `/api/v1`), for example:

```ts
createIzumiClient({
  baseUrl: 'https://core.example.com',
  getAccessToken: () => sessionToken,
});
```

The admin may consume that package or generate its own client from the OpenAPI
document, but it should preserve these HTTP and envelope semantics in either
case.
