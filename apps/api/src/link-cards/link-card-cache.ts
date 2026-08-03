export type LinkCardMetadata = Readonly<{
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
}>;

export interface LinkCardCache {
  get(key: string): Promise<LinkCardMetadata | undefined>;
  set(key: string, value: LinkCardMetadata, ttlSeconds: number): Promise<void>;
}

export const LINK_CARD_CACHE = Symbol('LINK_CARD_CACHE');

export class InMemoryLinkCardCache implements LinkCardCache {
  private readonly values = new Map<
    string,
    { expiresAt: number; value: LinkCardMetadata }
  >();

  async get(key: string): Promise<LinkCardMetadata | undefined> {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: LinkCardMetadata, ttlSeconds: number): Promise<void> {
    this.values.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1_000,
      value,
    });
  }
}
