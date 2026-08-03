import { describe, expect, it, vi } from 'vitest';

import { InMemoryLinkCardCache } from '../../src/link-cards/link-card-cache.js';
import { LinkCardService } from '../../src/link-cards/link-card.service.js';
import type { LinkCardHttpClient } from '../../src/link-cards/pinned-http-client.js';
import { isPrivateIp, UrlSafetyPolicy } from '../../src/link-cards/url-safety.js';

describe('link-card SSRF protection', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '100.64.0.1',
    '169.254.169.254',
    '172.20.0.1',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '2001:db8::1',
  ])('classifies %s as private', (address) => {
    expect(isPrivateIp(address)).toBe(true);
  });

  it('rejects any hostname whose DNS result set contains a private address', async () => {
    const policy = new UrlSafetyPolicy(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(policy.resolveSafe('https://example.test')).rejects.toThrow('Private');
  });

  it('pins the validated address so transport cannot re-resolve a rebound host', async () => {
    const lookup = vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]);
    const policy = new UrlSafetyPolicy(lookup);
    const request = vi.fn<LinkCardHttpClient['request']>(async (target) => {
      expect(target.address).toBe('93.184.216.34');
      return new Response('<title>Safe preview</title>', {
        headers: { 'Content-Type': 'text/html' },
      });
    });
    const service = new LinkCardService(new InMemoryLinkCardCache(), policy, {
      request,
    });

    await expect(
      service.resolve('https://example.test/article'),
    ).resolves.toMatchObject({ title: 'Safe preview' });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('revalidates every redirect and never requests a private redirect target', async () => {
    const lookup = vi.fn(async (hostname: string) =>
      hostname === 'public.test'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }],
    );
    const request = vi.fn<LinkCardHttpClient['request']>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'http://metadata.test/latest' },
        }),
    );
    const service = new LinkCardService(
      new InMemoryLinkCardCache(),
      new UrlSafetyPolicy(lookup),
      { request },
    );

    await expect(service.resolve('https://public.test')).rejects.toMatchObject({
      code: 'LINK_CARD_UNAVAILABLE',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
