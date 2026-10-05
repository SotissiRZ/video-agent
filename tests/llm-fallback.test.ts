import { afterEach, describe, expect, it } from 'vitest';
import { summarizeError } from '../src/core/errors';
import { FallbackLLM, isLastingFailure, resetFallbackState } from '../src/llm/fallback';
import { resolveLLM } from '../src/llm/registry';
import { FakeLLM, testConfig } from './helpers';

/** FakeLLM with a chosen id. */
const named = (id: string, answers: Array<string | Error>) => Object.assign(new FakeLLM(answers), { id });

afterEach(() => resetFallbackState());

describe('LLM fallback chain', () => {
  it('uses the next provider when one has no credit, and skips it afterwards', async () => {
    const noCredit = new Error('[anthropic] API error 400: {"message":"Your credit balance is too low"}');
    const a = named('anthropic', [noCredit, 'never']);
    const b = named('groq', ['{"ok":1}', '{"ok":2}']);
    const chain = new FallbackLLM([a, b]);
    expect((await chain.generate({ messages: [{ role: 'user', content: 'x' }] })).text).toBe('{"ok":1}');
    expect((await chain.generate({ messages: [{ role: 'user', content: 'y' }] })).text).toBe('{"ok":2}');
    expect(a.requests).toHaveLength(1);
  });

  it('reports every error when all providers fail', async () => {
    const chain = new FallbackLLM([named('a', [new Error('timeout')]), named('b', [new Error('500 boom')])]);
    await expect(chain.generate({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow('timeout | 500 boom');
  });

  it('chains every configured provider in "auto" mode', () => {
    const llm = resolveLLM(testConfig({ ANTHROPIC_API_KEY: 'a', GROQ_API_KEY: 'g' }));
    expect(llm).toBeInstanceOf(FallbackLLM);
    expect((llm as FallbackLLM).chain).toEqual(['anthropic', 'groq']);
    expect(resolveLLM(testConfig({ GROQ_API_KEY: 'g' }))).not.toBeInstanceOf(FallbackLLM);
  });

  it('classifies lasting failures and summarizes provider errors', () => {
    expect(isLastingFailure('Your credit balance is too low')).toBe(true);
    expect(isLastingFailure('HTTP 401 invalid_api_key')).toBe(true);
    expect(isLastingFailure('timeout after 1000ms')).toBe(false);
    expect(summarizeError('[anthropic] API error 400: 400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low."},"request_id":"req_1"}')).toBe('[anthropic] 400 Your credit balance is too low.');
  });
});
