import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeModelId, loadClaudeSettings, translateLinesWithClaude, translateWithClaude } from './claudeApi';

const MODEL_STORAGE_KEY = 'sacred_studio_claude_model';

/** A localStorage holding the given entries */
function stubStorage(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
}

interface SentRequest {
  body: Record<string, unknown>;
  beta: string | null;
}

/** Answers every Messages API request with `answer` as the JSON text, and records what was sent */
function stubApi(answer: unknown, stopReason = 'end_turn'): SentRequest[] {
  const sent: SentRequest[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ body, beta: headers.get('anthropic-beta') });
    return new Response(
      JSON.stringify({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: body.model,
        // A thinking block first, as the 5.5 models send: the answer must be read by type, not position
        content: [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: JSON.stringify(answer) },
        ],
        stop_reason: stopReason,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_test' } }
    );
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadClaudeSettings', () => {
  it('keeps a model that is still offered', () => {
    stubStorage({ [MODEL_STORAGE_KEY]: 'claude-sonnet-5-5' });
    expect(loadClaudeSettings().model).toBe('claude-sonnet-5-5');
  });

  it('turns a saved Haiku 4.5 into Haiku 5.5, not into the dearer default', () => {
    stubStorage({ [MODEL_STORAGE_KEY]: 'claude-haiku-4-5' });
    expect(loadClaudeSettings().model).toBe('claude-haiku-5-5');
  });

  it('uses the default for nothing saved or an unknown model', () => {
    stubStorage({});
    expect(loadClaudeSettings().model).toBe('claude-opus-5-5');
    stubStorage({ [MODEL_STORAGE_KEY]: 'claude-unknown' });
    expect(loadClaudeSettings().model).toBe('claude-opus-5-5');
    // Not something Map/object lookups would find on the prototype
    stubStorage({ [MODEL_STORAGE_KEY]: 'constructor' });
    expect(loadClaudeSettings().model).toBe('claude-opus-5-5');
  });
});

describe('requests per model', () => {
  beforeEach(() => stubStorage({}));

  it('Haiku 5.5: sets effort, and sends no server-side fallback (it has none)', async () => {
    const sent = stubApi({ en: 'Torii gate' });
    await expect(translateWithClaude('鳥居', 'sk-test', 'claude-haiku-5-5')).resolves.toBe('Torii gate');

    expect(sent).toHaveLength(1);
    const { body, beta } = sent[0];
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(body).not.toHaveProperty('fallbacks');
    expect(beta ?? '').not.toContain('server-side-fallback');
  });

  it.each<ClaudeModelId>(['claude-opus-5-5', 'claude-sonnet-5-5'])(
    '%s: sets effort and asks for the server-side fallback',
    async (model) => {
      const sent = stubApi({ en: 'Torii gate' });
      await translateWithClaude('鳥居', 'sk-test', model);

      const { body, beta } = sent[0];
      expect(body.output_config).toMatchObject({ effort: 'low' });
      expect(body.fallbacks).toBe('default');
      expect(beta).toContain('server-side-fallback-2026-07-01');
    }
  );

  it('batch translation on Haiku 5.5 is sent the same way', async () => {
    const sent = stubApi({ translations: [{ id: 'a', en: 'Main hall' }] });
    const result = await translateLinesWithClaude([{ id: 'a', ja: '拝殿' }], 'sk-test', 'claude-haiku-5-5');

    expect(result.get('a')).toBe('Main hall');
    expect(sent).toHaveLength(1);
    expect(sent[0].body.output_config).toMatchObject({ effort: 'low' });
    expect(sent[0].body).not.toHaveProperty('fallbacks');
  });

  it('a request Haiku 5.5 declines suggests trying another model', async () => {
    stubApi({}, 'refusal');
    await expect(translateWithClaude('鳥居', 'sk-test', 'claude-haiku-5-5')).rejects.toThrow(/Opus 5\.5 か Sonnet 5\.5/);
  });

  it('a request declined on Opus 5.5 (fallback included) does not suggest another model', async () => {
    stubApi({}, 'refusal');
    await expect(translateWithClaude('鳥居', 'sk-test', 'claude-opus-5-5')).rejects.toThrow(
      /^Claudeがこの文章の翻訳を辞退しました。表現を変えて再度お試しください。$/
    );
  });
});
