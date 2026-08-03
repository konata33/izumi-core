export type ServerSentEvent = {
  event: string;
  data: string;
};

export type NormalizedAiRunEvent =
  | { type: 'meta'; runId: string }
  | { type: 'delta'; delta: string }
  | { type: 'done'; runId: string; messageId?: string }
  | { type: 'error'; message: string };

function parseFrame(frame: string): ServerSentEvent | undefined {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/u)) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    let value = separator < 0 ? '' : line.slice(separator + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length ? { event, data: data.join('\n') } : undefined;
}

export class ServerSentEventParser {
  private buffer = '';

  push(chunk: string): ServerSentEvent[] {
    this.buffer += chunk;
    const frames = this.buffer.split(/\r?\n\r?\n/u);
    this.buffer = frames.pop() ?? '';
    return frames
      .map(parseFrame)
      .filter((event): event is ServerSentEvent => Boolean(event));
  }

  finish(): ServerSentEvent[] {
    const trailing = this.buffer.trim();
    this.buffer = '';
    const event = trailing ? parseFrame(trailing) : undefined;
    return event ? [event] : [];
  }
}

function parseData(data: string): Record<string, unknown> {
  const value = JSON.parse(data) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('AI stream event data must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function normalizeAiRunEvent(
  event: ServerSentEvent,
): NormalizedAiRunEvent | undefined {
  const data = parseData(event.data);
  if (event.event === 'meta' && typeof data.runId === 'string') {
    return { type: 'meta', runId: data.runId };
  }
  if (event.event === 'delta' && typeof data.text === 'string') {
    return { type: 'delta', delta: data.text };
  }
  if (event.event === 'done' && typeof data.runId === 'string') {
    return {
      type: 'done',
      runId: data.runId,
      ...(typeof data.messageId === 'string' ? { messageId: data.messageId } : {}),
    };
  }
  if (event.event === 'error' && typeof data.message === 'string') {
    return { type: 'error', message: data.message };
  }
  return undefined;
}
