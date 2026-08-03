import { describe, expect, it } from 'vitest';

import {
  AI_ACTIVE_RUN_STALE_AFTER_MS,
  isActiveRunStale,
} from '../../src/ai/ai.service.js';

describe('AI active-run recovery', () => {
  const now = new Date('2026-07-30T12:00:00.000Z');

  it('keeps a recent active run exclusive', () => {
    expect(
      isActiveRunStale(
        {
          activeRunId: 'run-current',
          activeRunStartedAt: new Date(now.getTime() - 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  it('allows a crashed run to be reclaimed after the stale threshold', () => {
    expect(
      isActiveRunStale(
        {
          activeRunId: 'run-crashed',
          activeRunStartedAt: new Date(
            now.getTime() - AI_ACTIVE_RUN_STALE_AFTER_MS - 1,
          ),
        },
        now,
      ),
    ).toBe(true);
    expect(
      isActiveRunStale({ activeRunId: 'legacy-run', activeRunStartedAt: null }, now),
    ).toBe(true);
  });
});
