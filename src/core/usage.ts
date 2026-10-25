/**
 * Consumption of paid services during one generation (LLM tokens, voice characters, music seconds,
 * generated images). Providers are wrapped so the pipeline records what it really used; prices are
 * applied later, so changing a price table re-prices the history.
 */
import type { LLMProvider } from '../llm/types';
import type { ImageProvider } from '../providers/image/types';
import type { MusicProvider } from '../providers/music/types';
import type { VoiceProvider } from '../providers/voice/types';

export type UsageKind = 'llm' | 'voice' | 'music' | 'image';

/** One aggregated line: same kind, provider and model are summed together. */
export interface UsageLine {
  kind: UsageKind;
  provider: string;
  model?: string;
  calls: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Text-to-speech characters. */
  characters?: number;
  /** Generated audio length. */
  seconds?: number;
  images?: number;
}

const sum = (a: number | undefined, b: number | undefined) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));

export class UsageMeter {
  private readonly byKey = new Map<string, UsageLine>();

  record(entry: Omit<UsageLine, 'calls'> & { calls?: number }): void {
    const key = `${entry.kind}|${entry.provider}|${entry.model ?? ''}`;
    const line = this.byKey.get(key) ?? { kind: entry.kind, provider: entry.provider, ...(entry.model ? { model: entry.model } : {}), calls: 0 };
    line.calls += entry.calls ?? 1;
    for (const field of ['inputTokens', 'outputTokens', 'characters', 'seconds', 'images'] as const) {
      const value = sum(line[field], entry[field]);
      if (value !== undefined) line[field] = value;
    }
    this.byKey.set(key, line);
  }

  get lines(): UsageLine[] {
    return [...this.byKey.values()];
  }

  llm(provider: LLMProvider): LLMProvider {
    const meter = this;
    return {
      id: provider.id,
      model: provider.model,
      async generate(request) {
        const response = await provider.generate(request);
        // The provider that answered (a fallback chain may have moved on) is the one billed.
        meter.record({ kind: 'llm', provider: response.provider, model: response.model, inputTokens: response.usage?.inputTokens ?? 0, outputTokens: response.usage?.outputTokens ?? 0 });
        return response;
      },
    };
  }

  voice(provider: VoiceProvider, model?: string): VoiceProvider {
    const meter = this;
    return {
      id: provider.id,
      supports: provider.supports?.bind(provider),
      async synthesize(request) {
        const result = await provider.synthesize(request);
        meter.record({ kind: 'voice', provider: provider.id, model, characters: request.text.length, seconds: result.durationSec });
        return result;
      },
    };
  }

  music(provider: MusicProvider): MusicProvider {
    const meter = this;
    return {
      id: provider.id,
      maxDurationSec: provider.maxDurationSec,
      async generate(request) {
        const result = await provider.generate(request);
        meter.record({ kind: 'music', provider: provider.id, seconds: result.durationSec || request.durationSec });
        return result;
      },
    };
  }

  image(provider: ImageProvider, model?: string): ImageProvider {
    const meter = this;
    return {
      // A fallback chain changes provider after a failure: read it at each call.
      get id() {
        return provider.id;
      },
      async generate(request) {
        const result = await provider.generate(request);
        meter.record({ kind: 'image', provider: provider.id, model: provider.id === 'huggingface' || provider.id === 'cloudflare' ? undefined : model, images: 1 });
        return result;
      },
    };
  }
}

/** Merge usage recorded in several runs (a song generated again, a correction that fell back). */
export const mergeUsage = (...groups: UsageLine[][]): UsageLine[] => {
  const meter = new UsageMeter();
  for (const line of groups.flat()) meter.record(line);
  return meter.lines;
};
