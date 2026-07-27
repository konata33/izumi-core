import { randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';

import { ApiException } from '../common/api-exception.js';
import { APP_CONFIG, type AppConfig } from '../config/app-config.js';
import { DATABASE, type Database } from '../database/database.module.js';
import { profileLinks, profiles } from '../database/schema.js';
import type {
  OwnerProfileDto,
  ProfileLinkDto,
  ProfileLinkKind,
  PublicProfileDto,
  ReplaceProfileDto,
} from './profiles.dto.js';

type ProfileRecord = typeof profiles.$inferSelect;
type ProfileLinkRecord = typeof profileLinks.$inferSelect;

type NormalizedProfile = {
  displayName: string;
  headline: string;
  bio: string;
  avatar: { url: string; alt: string };
  links: ProfileLinkDto[];
};

function invalidProfileField(field: string, message: string): never {
  throw new ApiException('PROFILE_FIELD_INVALID', message, HttpStatus.BAD_REQUEST, {
    field,
  });
}

function normalizePlainText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[<>]/.test(trimmed)) {
    return invalidProfileField(
      field,
      `${field} must contain non-whitespace plain text without HTML brackets`,
    );
  }
  return trimmed;
}

function isDevelopmentLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function normalizeAbsoluteUrl(input: {
  value: string;
  field: string;
  allowDevelopmentLoopbackHttp: boolean;
}): string {
  const value = input.value.trim();
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return invalidProfileField(input.field, `${input.field} must be an absolute URL`);
  }

  const isHttps = url.protocol === 'https:';
  const isAllowedDevelopmentHttp =
    input.allowDevelopmentLoopbackHttp &&
    url.protocol === 'http:' &&
    isDevelopmentLoopbackHost(url.hostname);

  if (
    !url.hostname ||
    url.username ||
    url.password ||
    (!isHttps && !isAllowedDevelopmentHttp)
  ) {
    return invalidProfileField(
      input.field,
      input.allowDevelopmentLoopbackHttp
        ? `${input.field} must use HTTPS or development localhost HTTP`
        : `${input.field} must use HTTPS`,
    );
  }

  return value;
}

function normalizeLinks(input: ProfileLinkDto[]): ProfileLinkDto[] {
  const seen = new Set<ProfileLinkKind>();

  const links = input.map((link) => {
    if (seen.has(link.kind)) {
      throw new ApiException(
        'PROFILE_LINK_KIND_DUPLICATE',
        'Each profile link kind may appear only once',
        HttpStatus.BAD_REQUEST,
        { kind: link.kind },
      );
    }
    seen.add(link.kind);

    return {
      kind: link.kind,
      url: normalizeAbsoluteUrl({
        value: link.url,
        field: `links.${link.kind}.url`,
        allowDevelopmentLoopbackHttp: false,
      }),
    };
  });

  return links.sort((left, right) => left.kind.localeCompare(right.kind));
}

function toPublicProfileDto(
  profile: ProfileRecord,
  links: ProfileLinkRecord[] | ProfileLinkDto[],
): PublicProfileDto {
  return {
    displayName: profile.displayName,
    headline: profile.headline,
    bio: profile.bio,
    avatar: {
      url: profile.avatarUrl,
      alt: profile.avatarAlt,
    },
    links: links.map((link) => ({
      kind: link.kind as ProfileLinkKind,
      url: link.url,
    })),
  };
}

function toOwnerProfileDto(
  profile: ProfileRecord,
  links: ProfileLinkRecord[] | ProfileLinkDto[],
): OwnerProfileDto {
  return {
    ...toPublicProfileDto(profile, links),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async findPublic(): Promise<PublicProfileDto> {
    const profile = await this.findSingleton();
    return toPublicProfileDto(profile, await this.findLinks(profile.id));
  }

  async findForOwner(ownerId: string): Promise<OwnerProfileDto> {
    const [profile] = await this.database
      .select()
      .from(profiles)
      .where(eq(profiles.ownerId, ownerId))
      .limit(1);

    if (!profile) this.throwProfileNotConfigured();
    return toOwnerProfileDto(profile, await this.findLinks(profile.id));
  }

  async replace(ownerId: string, input: ReplaceProfileDto): Promise<OwnerProfileDto> {
    const normalized = this.normalize(input);
    const now = new Date();

    const profile = await this.database.transaction(async (transaction) => {
      const [updatedProfile] = await transaction
        .insert(profiles)
        .values({
          id: randomUUID(),
          ownerId,
          displayName: normalized.displayName,
          headline: normalized.headline,
          bio: normalized.bio,
          avatarUrl: normalized.avatar.url,
          avatarAlt: normalized.avatar.alt,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: profiles.singletonSlot,
          set: {
            ownerId,
            displayName: normalized.displayName,
            headline: normalized.headline,
            bio: normalized.bio,
            avatarUrl: normalized.avatar.url,
            avatarAlt: normalized.avatar.alt,
            updatedAt: now,
          },
        })
        .returning();

      if (!updatedProfile) throw new Error('Profile replacement returned no row');

      await transaction
        .delete(profileLinks)
        .where(eq(profileLinks.profileId, updatedProfile.id));
      if (normalized.links.length > 0) {
        await transaction.insert(profileLinks).values(
          normalized.links.map((link) => ({
            profileId: updatedProfile.id,
            kind: link.kind,
            url: link.url,
          })),
        );
      }

      return updatedProfile;
    });

    return toOwnerProfileDto(profile, normalized.links);
  }

  private normalize(input: ReplaceProfileDto): NormalizedProfile {
    return {
      displayName: normalizePlainText(input.displayName, 'displayName'),
      headline: normalizePlainText(input.headline, 'headline'),
      bio: normalizePlainText(input.bio, 'bio'),
      avatar: {
        url: normalizeAbsoluteUrl({
          value: input.avatar.url,
          field: 'avatar.url',
          allowDevelopmentLoopbackHttp: this.config.nodeEnv === 'development',
        }),
        alt: normalizePlainText(input.avatar.alt, 'avatar.alt'),
      },
      links: normalizeLinks(input.links),
    };
  }

  private async findSingleton(): Promise<ProfileRecord> {
    const [profile] = await this.database.select().from(profiles).limit(1);
    if (!profile) this.throwProfileNotConfigured();
    return profile;
  }

  private async findLinks(profileId: string): Promise<ProfileLinkRecord[]> {
    return this.database
      .select()
      .from(profileLinks)
      .where(eq(profileLinks.profileId, profileId))
      .orderBy(asc(profileLinks.kind));
  }

  private throwProfileNotConfigured(): never {
    throw new ApiException(
      'PROFILE_NOT_CONFIGURED',
      'Public profile has not been configured',
      HttpStatus.NOT_FOUND,
    );
  }
}
