import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { Readable } from 'node:stream';

import type { SafeUrlTarget } from './url-safety.js';

export type PinnedRequestInit = Readonly<{
  method: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}>;

export interface LinkCardHttpClient {
  request(target: SafeUrlTarget, init: PinnedRequestInit): Promise<Response>;
}

export const LINK_CARD_HTTP_CLIENT = Symbol('LINK_CARD_HTTP_CLIENT');

export class PinnedHttpClient implements LinkCardHttpClient {
  request(target: SafeUrlTarget, init: PinnedRequestInit): Promise<Response> {
    return new Promise<Response>((resolve, reject) => {
      const requestFunction =
        target.url.protocol === 'https:' ? requestHttps : requestHttp;
      const request = requestFunction(
        target.url,
        {
          method: init.method,
          headers: init.headers,
          signal: init.signal,
          servername:
            target.url.protocol === 'https:' ? target.url.hostname : undefined,
          lookup: (_hostname, _options, callback) => {
            callback(null, target.address, target.family);
          },
        },
        (response) => {
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              for (const item of value) headers.append(name, item);
            } else if (value !== undefined) {
              headers.set(name, String(value));
            }
          }
          const status = response.statusCode ?? 502;
          const noBody = status === 204 || status === 205 || status === 304;
          resolve(
            new Response(
              noBody ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>),
              { status, statusText: response.statusMessage, headers },
            ),
          );
        },
      );
      request.once('error', reject);
      if (init.body) request.write(init.body);
      request.end();
    });
  }
}
