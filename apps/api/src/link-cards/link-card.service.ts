import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { ApiException } from '../common/api-exception.js';
import {
  LINK_CARD_CACHE,
  type LinkCardCache,
  type LinkCardMetadata,
} from './link-card-cache.js';
import {
  LINK_CARD_HTTP_CLIENT,
  type LinkCardHttpClient,
} from './pinned-http-client.js';
import { type SafeUrlTarget, UrlSafetyPolicy } from './url-safety.js';

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const CACHE_TTL_SECONDS = 6 * 60 * 60;

function decodeHtml(value: string): string {
  const entities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
    '#39': "'",
  };
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+|#39);/gi, (match, name: string) => entities[name] ?? match)
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    'i',
  ).exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function metaContent(html: string, identities: string[]): string | undefined {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const identity = (
      attribute(tag, 'property') ?? attribute(tag, 'name')
    )?.toLowerCase();
    if (identity && identities.includes(identity)) {
      const content = attribute(tag, 'content');
      if (content) return decodeHtml(content);
    }
  }
  return undefined;
}

function titleContent(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? decodeHtml(match[1].replace(/<[^>]*>/g, '')) : undefined;
}

async function readLimitedHtml(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new Error('Link response is too large');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('Link response is too large');
    }
    chunks.push(value);
  }
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

@Injectable()
export class LinkCardService {
  constructor(
    @Inject(LINK_CARD_CACHE) private readonly cache: LinkCardCache,
    @Inject(UrlSafetyPolicy) private readonly safety: UrlSafetyPolicy,
    @Inject(LINK_CARD_HTTP_CLIENT)
    private readonly httpClient: LinkCardHttpClient,
  ) {}

  async resolve(input: string): Promise<LinkCardMetadata> {
    try {
      const initialTarget = await this.safety.resolveSafe(input);
      const cacheKey = initialTarget.url.toString();
      const cached = await this.cache.get(cacheKey);
      if (cached) return cached;

      const { response, finalUrl } = await this.fetchFollowingRedirects(initialTarget);
      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (
        !contentType.startsWith('text/html') &&
        !contentType.startsWith('application/xhtml+xml')
      ) {
        throw new Error('Link target is not an HTML document');
      }
      const html = await readLimitedHtml(response);
      const title =
        metaContent(html, ['og:title', 'twitter:title']) ?? titleContent(html);
      if (!title) throw new Error('Link target has no usable title');

      const rawImage = metaContent(html, ['og:image', 'twitter:image']);
      let imageUrl: string | null = null;
      if (rawImage) {
        try {
          imageUrl = (
            await this.safety.assertSafe(new URL(rawImage, finalUrl).toString())
          ).toString();
        } catch {
          imageUrl = null;
        }
      }
      const metadata: LinkCardMetadata = {
        url: finalUrl.toString(),
        title: title.slice(0, 300),
        description:
          metaContent(html, [
            'og:description',
            'twitter:description',
            'description',
          ])?.slice(0, 1_000) ?? null,
        imageUrl,
        siteName:
          metaContent(html, ['og:site_name'])?.slice(0, 200) ??
          finalUrl.hostname.replace(/^www\./, ''),
      };
      await this.cache.set(cacheKey, metadata, CACHE_TTL_SECONDS);
      return metadata;
    } catch (error: unknown) {
      throw new ApiException(
        'LINK_CARD_UNAVAILABLE',
        'The link preview could not be retrieved safely',
        HttpStatus.BAD_GATEWAY,
        { reason: error instanceof Error ? error.message : 'unknown error' },
      );
    }
  }

  private async fetchFollowingRedirects(
    initialTarget: SafeUrlTarget,
  ): Promise<{ response: Response; finalUrl: URL }> {
    let current = initialTarget;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
      const response = await this.httpClient.request(current, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent': 'Izumi-Link-Preview/1.0',
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || redirectCount === MAX_REDIRECTS) {
          await response.body?.cancel().catch(() => undefined);
          throw new Error('Link target redirected too many times');
        }
        await response.body?.cancel().catch(() => undefined);
        current = await this.safety.resolveSafe(
          new URL(location, current.url).toString(),
        );
        continue;
      }
      if (!response.ok) throw new Error(`Link target returned ${response.status}`);
      return { response, finalUrl: current.url };
    }
    throw new Error('Link target redirected too many times');
  }
}
