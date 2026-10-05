/** Errors carrying a user-facing hint. */
export class VideoAgentError extends Error {
  constructor(
    message: string,
    public readonly hint?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'VideoAgentError';
  }
}

export class ConfigError extends VideoAgentError {
  override name = 'ConfigError';
}

export class ProviderError extends VideoAgentError {
  override name = 'ProviderError';
  constructor(
    public readonly provider: string,
    message: string,
    hint?: string,
    options?: { cause?: unknown },
  ) {
    super(`[${provider}] ${message}`, hint, options);
  }
}

export class StoryboardValidationError extends VideoAgentError {
  override name = 'StoryboardValidationError';
  constructor(public readonly issues: string[]) {
    super(`Invalid storyboard:\n - ${issues.join('\n - ')}`);
  }
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Short, readable form of a provider error: keeps the provider prefix and the human message
 * found in JSON error bodies, drops request ids and raw JSON.
 */
export const summarizeError = (message: string, max = 220): string => {
  const prefix = /^\[[\w-]+\]\s*/.exec(message)?.[0] ?? '';
  const inner = [...message.matchAll(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'));
  const status = /\b(4\d\d|5\d\d)\b/.exec(message)?.[1];
  let text = inner.length ? `${prefix}${status ? `${status} ` : ''}${inner[inner.length - 1]}` : message;
  text = text.replace(/,?\s*"?request_id"?\s*:\s*"[^"]*"/g, '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
