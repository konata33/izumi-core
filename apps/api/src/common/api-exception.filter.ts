import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiException } from './api-exception.js';

type ErrorEnvelope = {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId: string;
  };
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const requestId = request.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : 'HTTP_ERROR';
      const response = exception.getResponse();

      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object') {
        const body = response as { message?: string | string[]; error?: string };
        if (Array.isArray(body.message)) {
          message = 'Validation failed';
          details = { issues: body.message };
        } else if (body.message) {
          message = body.message;
        } else if (body.error) {
          message = body.error;
        }
      }
    }

    const body: ErrorEnvelope = {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
        requestId,
      },
    };

    reply.header('x-request-id', requestId).status(status).send(body);
  }
}
