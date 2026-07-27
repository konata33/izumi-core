# Izumi Public Profile API v1

Status: agreed implementation contract. `izumi-core` must implement and
publish this API before Izumi moves the public identity display off its local
fixture.

## Scope

This is the singleton identity shown in the public site's home hero and site
header. It is not a general social-profile, media-library, site-settings, or
page-management API.

`siteName`, site-wide SEO text, the RSS endpoint, the home writing-map copy,
and the About page remain separate concerns. In particular, RSS is a stable
Izumi capability, not an owner-configured social link.

## Base URL

Use the same server-only `IZUMI_CORE_URL` convention as the public content API:

```text
IZUMI_CORE_URL=https://core.example.com/api
```

The Izumi adapter appends `/v1/public/profile`, so the deployed Core route is
`https://core.example.com/api/v1/public/profile`.

## Public endpoint

### `GET /v1/public/profile`

Returns the one public profile in the standard `data` envelope.

```json
{
  "data": {
    "displayName": "Konata",
    "headline": "Hello, I'm Konata.",
    "bio": "A design-driven developer, bringing ideas to life in products.",
    "avatar": {
      "url": "https://assets.example.com/izumi/avatar.png",
      "alt": "Konata33 的头像"
    },
    "links": [
      {
        "kind": "github",
        "url": "https://github.com/konata33"
      },
      {
        "kind": "x",
        "url": "https://x.com/Mrcat333"
      }
    ]
  }
}
```

## Field rules

- `displayName`, `headline`, `bio`, and `avatar.alt` are required non-empty
  trimmed plain-text strings. They are not Markdown or HTML.
- `avatar.url` is a required absolute public URL. Production values use HTTPS;
  Core may permit localhost HTTP only in its development environment.
- `links` is required and may be `[]`. In v1, each item has a unique `kind`
  from the closed set `github | x` and one absolute HTTPS `url`.
- The public site owns icon rendering. Core and the admin must never send SVG,
  arbitrary icon names, HTML, or JavaScript as profile data.
- Unknown additive fields are allowed. A later revision may add another
  explicitly supported link kind without changing the stable fields above.
- The profile is public only; this endpoint returns `200` with the singleton
  profile. If Core has no configured profile, it returns `404` rather than an
  incomplete object.

## Owner API required by the admin

The admin owns mutation. The public Izumi repository never creates, edits, or
deletes profile data.

```text
GET /v1/owner/profile
PUT /v1/owner/profile
```

`PUT` accepts the complete profile representation above and validates it before
replacing the singleton. It requires Core's owner authentication. The owner
response includes `updatedAt` for the admin UI; it is not part of the public v1
response.

## Cache and handoff

Izumi will cache a successful public-profile response for 60 seconds. After an
admin update, the public site may therefore take up to one minute to reflect
the new profile until Core provides an authenticated revalidation webhook.

Once Core exposes this endpoint, the blog will replace its local profile
fixture with a server-only adapter. The adapter follows the same rule as posts:
when Core is configured, a non-`2xx` response is an outage and is never silently
replaced by fixture data.
