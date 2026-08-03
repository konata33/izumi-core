import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export type HostLookup = (
  hostname: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export type SafeUrlTarget = Readonly<{
  url: URL;
  address: string;
  family: number;
}>;

function parseIpv4(address: string): number[] | undefined {
  const parts = address.split('.').map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : undefined;
}

function isPrivateIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 88) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

export function isPrivateIp(input: string): boolean {
  const address = input.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(address) === 4) return isPrivateIpv4(address);
  if (isIP(address) !== 6) return true;
  if (address === '::' || address === '::1') return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(address)) return true;
  if (address.startsWith('ff')) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(address);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u.exec(address);
  if (mappedHex?.[1] && mappedHex[2]) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`);
  }
  const first = Number.parseInt(address.split(':')[0] ?? '', 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return true;
  return (
    address.startsWith('2001:0:') ||
    address.startsWith('2001:db8:') ||
    address.startsWith('2002:') ||
    address.startsWith('3fff:')
  );
}

const defaultLookup: HostLookup = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export class UrlSafetyPolicy {
  constructor(private readonly resolveHost: HostLookup = defaultLookup) {}

  async resolveSafe(input: string): Promise<SafeUrlTarget> {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      throw new Error('URL is invalid');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('Only HTTP(S) URLs are allowed');
    }
    if (url.username || url.password) {
      throw new Error('URLs containing credentials are not allowed');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      throw new Error('Local network URLs are not allowed');
    }
    if (isIP(hostname)) {
      if (isPrivateIp(hostname))
        throw new Error('Private network URLs are not allowed');
      return { url, address: hostname, family: isIP(hostname) };
    }
    const addresses = await this.resolveHost(hostname);
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => isPrivateIp(address))
    ) {
      throw new Error('Private or unresolved network targets are not allowed');
    }
    return { url, address: addresses[0]!.address, family: addresses[0]!.family };
  }

  async assertSafe(input: string): Promise<URL> {
    return (await this.resolveSafe(input)).url;
  }
}
