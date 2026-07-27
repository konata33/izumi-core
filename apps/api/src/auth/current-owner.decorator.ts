import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { OwnerRequest } from './jwt-auth.guard.js';

export const CurrentOwnerId = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<OwnerRequest>();
    if (!request.ownerId) throw new Error('Owner context is missing');
    return request.ownerId;
  },
);
