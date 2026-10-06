/**
 * Claude API Integration for Sacred Sanctuary Subtitles (Japanese -> English)
 * Calls the Anthropic API directly from the browser with glossary enforcement.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { GlossaryItem } from '../types';

export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（高品質・標準）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（品質と価格のバランス）' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5（低コスト・高速）' },
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];
export const DEFAULT_CLAUDE_MODEL: ClaudeModelId = 'claude-opus-5-5';

// The API key and model are browser settings, not project data,
// so they never end up in exported project files.
const API_KEY_STORAGE_KEY = 'sacred_studio_claude_key';
const MODEL_STORAGE_KEY = 'sacred_studio_claude_model';

export function loadClaudeSettings(): { apiKey: string; model: ClaudeModelId } {
  let apiKey = '';
  let model: string | null = null;
  try {
    apiKey = localStorage.getItem(API_KEY_STORAGE_KEY) || '';
    model = localStorage.getItem(MODEL_STORAGE_KEY);
  } catch {}
  const isKnownModel = CLAUDE_MODELS.some((m) => m.id === model);
  return { apiKey, model: isKnownModel ? (model as ClaudeModelId) : DEFAULT_CLAUDE_MODEL };
}

export function saveClaudeApiKey(apiKey: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, apiKey.trim());
}

export function saveClaudeModel(model: ClaudeModelId): void {
  localStorage.setItem(MODEL_STORAGE_KEY, model);
}

const TRANSLATION_FORMAT = betaJSONSchemaOutputFormat({
  type: 'object',
  properties: {
    en: { type: 'string', description: 'The English translation' },
  },
  required: ['en'],
  additionalProperties: false,
});

export async function translateWithClaude(
  textToTranslate: string,
  apiKey: string,
  model: ClaudeModelId,
  glossary: GlossaryItem[] = []
): Promise<string> {
  if (!textToTranslate.trim()) {
    return '';
  }
  if (!apiKey.trim()) {
    throw new Error('Claude APIキーが未設定です。「翻訳」タブの Claude API 設定でキーを保存してください。');
  }

  // Format glossary for prompt
  const glossaryPrompt = glossary.length > 0
    ? `\nUse the following official Sanctuary & Shinto terminology glossary for consistent translation:
${glossary.map(g => `- Japanese: "${g.japanese}" -> English: "${g.english}"`).join('\n')}`
    : '';

  const systemPrompt = `You are an expert translator specializing in traditional Japanese Shinto shrines, sacred sanctuaries, rituals, and Buddhist heritage.
Translate the provided Japanese commentary or sanctuary information into English.
Tone requirements:
- Serene, reverent, solemn, elegant, and atmospheric.
- Keep the sacred aura of the shrine.
- Preserve traditional honorifics and standardized Romanization according to the glossary.
${glossaryPrompt}`;

  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  // Haiku 4.5 rejects `effort` and has no server-side fallback; the 5.5 models accept both
  const isHaiku = model === 'claude-haiku-4-5';

  const response = await client.beta.messages
    .parse({
      model,
      max_tokens: 16000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Please translate this sanctuary text into English:\n"${textToTranslate}"`,
        },
      ],
      output_config: isHaiku
        ? { format: TRANSLATION_FORMAT }
        : { format: TRANSLATION_FORMAT, effort: 'low' as const }, // short subtitle lines need little reasoning
      // If a safety classifier declines, the API retries on Anthropic's recommended fallback model
      ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
    })
    .catch((error: unknown) => {
      throw new Error(describeApiError(error));
    });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claudeがこの文章の翻訳を辞退しました。表現を変えて再度お試しください。');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('翻訳結果が途中で切れました。文章を短く分けて再度お試しください。');
  }
  const en = response.parsed_output?.en?.trim();
  if (!en) {
    throw new Error('翻訳結果を読み取れませんでした。再度お試しください。');
  }
  return en;
}

function describeApiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return 'APIキーが正しくありません。キーを確認して保存し直してください。';
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return 'このAPIキーでは選択中のモデルを利用できません。別のモデルを選んでください。';
  }
  if (error instanceof Anthropic.NotFoundError) {
    return '選択中のモデルが見つかりません。別のモデルを選んでください。';
  }
  if (error instanceof Anthropic.RateLimitError) {
    return 'リクエストが集中しています。少し待ってから再度お試しください。';
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return 'Claude APIに接続できませんでした。インターネット接続を確認してください。';
  }
  if (error instanceof Anthropic.APIError) {
    return `Claude APIエラー (${error.status}): ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
