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
