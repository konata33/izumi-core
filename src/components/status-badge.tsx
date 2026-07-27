import { CheckCircle2Icon, CircleDashedIcon } from 'lucide-react';

import type { PostStatus } from '@/lib/core';

export function StatusBadge({ status }: { status: PostStatus }) {
  const published = status === 'published';

  return (
    <span className={`mx-status-badge${published ? ' is-published' : ''}`}>
      {published ? <CheckCircle2Icon /> : <CircleDashedIcon />}
      {published ? '已发布' : '草稿'}
    </span>
  );
}
