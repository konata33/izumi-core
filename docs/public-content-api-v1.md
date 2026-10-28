# Izumi Public Content API v1

Status: agreed implementation contract. `izumi-core` must implement and
publish this contract before the front end can use live content.

## Base URL

`IZUMI_CORE_URL` is a server-only absolute URL for the API prefix _before_ the
version segment. The public-site adapter appends `/v1/public/...` itself.

```text
https://core.example.com
https://core.example.com/api
```

For Core's current `/api/v1` route prefix, use:

```text
IZUMI_CORE_URL=https://core.example.com/api
```

Do **not** include `/v1` in this environment variable, or the adapter would
request `/api/v1/v1/...`.

The browser must never call this URL directly. Izumi fetches it only in Server
Components, metadata generation, RSS, and sitemap generation.

## Endpoints

### `GET /v1/public/posts`

Returns live publication summaries ordered newest first. It deliberately does
not return the article document or compatibility Markdown.

`limit` is optional. When omitted, Core returns all published posts: the
archive, RSS, sitemap, and static article parameters rely on this behavior. If
provided, it must be an integer from `1` through `100`; `0`, negative values,
fractions, an empty value, and values over `100` return `400`. An empty archive
returns `200` with `{ "data": [] }`.

Core orders results by `publishedAt DESC, createdAt DESC, id DESC`. `createdAt`
and `id` are stable internal database fields and do not need to be exposed in
this public response.

```json
{
  "data": [
    {
      "slug": "make-room-for-a-slower-entry",
      "title": "为一座个人网站留出缓慢的入口",
      "excerpt": "首页不必像一条不断催促的时间线。",
      "publishedAt": "2026-07-20T04:00:00.000Z",
      "readingMinutes": 4,
      "section": "思考",
      "tags": ["网站", "写作"]
    }
  ]
}
```

### `GET /v1/public/posts/:slug`

Returns the current immutable publication snapshot in a `data` envelope. The
canonical `document` is a Lexical/Haklex serialized editor state; `content` is
server-derived compatibility Markdown for existing readers. It returns `404`
when the slug does not identify a live publication.

```json
{
  "data": {
    "slug": "make-room-for-a-slower-entry",
    "title": "为一座个人网站留出缓慢的入口",
    "excerpt": "首页不必像一条不断催促的时间线。",
    "publishedAt": "2026-07-20T04:00:00.000Z",
    "readingMinutes": 4,
    "section": "思考",
    "tags": ["网站", "写作"],
    "document": {
      "root": {
        "children": [
          {
            "children": [
              {
                "detail": 0,
                "format": 0,
                "mode": "normal",
                "style": "",
                "text": "先让内容找到位置",
                "type": "text",
                "version": 1
              }
            ],
            "tag": "h2",
            "type": "heading",
            "version": 1
          }
        ],
        "type": "root",
        "version": 1
      }
    },
    "content": "## 先让内容找到位置",
    "references": []
  }
}
```

## Contract rules

- All routes return `application/json` and the `data` envelope shown above.
- `title`, `slug`, derived `content`, and `section` are non-empty trimmed
  strings when a post is published. `document` is canonical JSON. `content`
  remains compatibility Markdown; Core does not render it to HTML.
- `excerpt` is editorial copy written by the owner. It may be empty on a draft,
  but is a required non-empty trimmed string when a post is published.
- `tags` is always present and may be `[]`. Each tag is trimmed and non-empty;
  duplicate tags are removed without changing their display casing. A tag or
  category table is out of scope for v1.
- `publishedAt` is a normalized ISO 8601 UTC timestamp in
  `YYYY-MM-DDTHH:mm:ss.SSSZ` form. The public site formats it in
  Asia/Shanghai time; the database must not store a display-only calendar date.
- v1 does not support scheduled publishing. On the first publication Core
  writes `publishedAt` in UTC; later working-copy edits remain private until a
  new snapshot is published and retain that first publication time.
- `readingMinutes` is calculated by Core from the derived visible content:
  `max(1, ceil(CJK characters / 300 + Latin-or-number word tokens / 200))`.
  The same integer must appear in collection and detail responses.
- `document`, `content`, and `references` are detail-only. The collection
  endpoint omits them. `references` resolves live internal post references to
  their public slug/title metadata.
- A Markdown compatibility renderer supports CommonMark + GFM and sanitizes
  raw HTML, event handlers, and unsafe URLs. A structured renderer must compose
  only the allowlisted Haklex nodes; `poll`, executable `dynamic`, transient AI
  diff, and unknown nodes are never public.
- Unpublished, private, or draft content never appears in this API. A missing
  slug and a non-public slug both return `404`.
- Unknown additive fields are allowed. A later revision may add a stable post
  ID, `updatedAt`, and translation metadata without breaking this v1 reader.
- Invalid `limit` values return `400`; unexpected server failures return `500`.
  All non-`2xx` responses use Core's standard `error` envelope. The public
  front end distinguishes only `404` from other non-`2xx` responses.
- A non-404 response outside the `2xx` range is an outage, not an empty
  archive. The public front end deliberately does not fall back to fixture
  articles in that case.

## Cache and handoff

The front end caches a successful public-post response for 60 seconds and tags
it as `izumi:public-posts`. The first backend implementation only needs the two
GET endpoints. On-demand cache invalidation can be added after the admin
publishing flow is stable.

The current front-end adapter lives in `src/lib/posts.ts`. When `izumi-core`
publishes `@konata33/izumi-sdk`, replace only the HTTP calls inside that adapter; keep
the exported `getPosts`, `getLatestPosts`, and `getPostBySlug` methods stable.
