/**
 * Claude API Integration for Sacred Sanctuary Subtitles (Japanese -> English)
 * Calls the Anthropic API directly from the browser with glossary enforcement.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { GlossaryItem, LocalizedText } from '../types';

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

// ---------------------------------------------------------------------------
// Automatic editing: on-screen text for a shrine visit, written from one frame per clip
// ---------------------------------------------------------------------------

export interface EditScriptClipInput {
  durationSec: number;
  hasSpeech: boolean;
  /** JPEG (base64) of a representative frame, or null when the picture could not be read */
  imageBase64: string | null;
}

export interface EditScriptClip {
  index: number;
  scene: string;
  telop: 'commentary' | 'etiquette' | 'none';
  text: LocalizedText;
  tipTitle: LocalizedText;
  chapter: LocalizedText;
}

export interface EditScript {
  videoTitle: LocalizedText;
  sanctuary: { name: LocalizedText; location: LocalizedText; deity: LocalizedText; blessing: LocalizedText };
  access: { address: LocalizedText; nearestStation: LocalizedText; parking: LocalizedText; visitingHours: LocalizedText };
  clips: EditScriptClip[];
  glossary: { japanese: string; english: string }[];
}

const LOCALIZED_SCHEMA = {
  type: 'object',
  properties: { ja: { type: 'string' }, en: { type: 'string' } },
  required: ['ja', 'en'],
  additionalProperties: false,
} as const;

const EDIT_SCRIPT_FORMAT = betaJSONSchemaOutputFormat({
  type: 'object',
  properties: {
    videoTitle: LOCALIZED_SCHEMA,
    sanctuary: {
      type: 'object',
      properties: { name: LOCALIZED_SCHEMA, location: LOCALIZED_SCHEMA, deity: LOCALIZED_SCHEMA, blessing: LOCALIZED_SCHEMA },
      required: ['name', 'location', 'deity', 'blessing'],
      additionalProperties: false,
    },
    access: {
      type: 'object',
      properties: {
        address: LOCALIZED_SCHEMA,
        nearestStation: LOCALIZED_SCHEMA,
        parking: LOCALIZED_SCHEMA,
        visitingHours: LOCALIZED_SCHEMA,
      },
      required: ['address', 'nearestStation', 'parking', 'visitingHours'],
      additionalProperties: false,
    },
    clips: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          scene: { type: 'string' },
          telop: { type: 'string', enum: ['commentary', 'etiquette', 'none'] },
          text: LOCALIZED_SCHEMA,
          tipTitle: LOCALIZED_SCHEMA,
          chapter: LOCALIZED_SCHEMA,
        },
        required: ['index', 'scene', 'telop', 'text', 'tipTitle', 'chapter'],
        additionalProperties: false,
      },
    },
    glossary: {
      type: 'array',
      items: {
        type: 'object',
        properties: { japanese: { type: 'string' }, english: { type: 'string' } },
        required: ['japanese', 'english'],
        additionalProperties: false,
      },
    },
  },
  required: ['videoTitle', 'sanctuary', 'access', 'clips', 'glossary'],
  additionalProperties: false,
} as const);

// The API accepts at most 100 images per request; later clips are described by text only
const MAX_IMAGES = 100;

const EDIT_SCRIPT_SYSTEM_PROMPT = `You are the editor of a Japanese YouTube channel that guides viewers through Shinto shrines and sacred sites.
You receive one still frame from each clip of an edited shrine-visit video, in playing order, and write the on-screen text.

Style:
- Japanese: serene, reverent and concise, like a travel documentary. A caption is one sentence of at most 40 characters.
- English: natural, elegant renderings of the Japanese that follow the glossary.

Accuracy (most important):
- Describe only what is visible in a frame or stated in the user's notes.
- Facts about the shrine (location, enshrined deity, blessings, address, nearest station, parking, visiting hours): take them from the user's notes first. Otherwise include a fact only if you are certain it is true of this specific shrine. When unsure, return an empty string for that field. Never guess.

For each clip:
- scene: a short Japanese phrase for what the clip shows (e.g. 大鳥居, 参道, 手水舎, 拝殿).
- telop: "etiquette" when the clip shows a place where visitors follow a custom (purifying at the 手水舎, praying at the 拝殿 with 二礼二拍手一礼, bowing at a torii) and a tip would help viewers; "commentary" for a short caption about what is shown; "none" when the picture should stay clear. Prefer "none" for clips where the person filming is talking, since their voice already explains the scene. Clips shorter than 3 seconds get "none". Use etiquette tips sparingly (about one in four clips at most) and never repeat a tip.
- text: the caption (commentary) or the tip's explanation (etiquette) in ja and en; empty strings for "none".
- tipTitle: a short heading such as 手水の作法 for etiquette; otherwise empty strings.
- chapter: a YouTube chapter title in ja and en when this clip starts a new part of the visit (approach, purification, main hall, sub-shrines, ...); empty strings when it continues the previous part. Clip 1 always starts a chapter. Aim for 3 to 8 chapters in total.

Also return:
- videoTitle: an inviting YouTube title in ja (at most 32 characters, including the shrine name) and en.
- sanctuary: name, location (prefecture and city), deity, blessing, following the accuracy rules.
- access: address, nearestStation, parking, visitingHours, following the accuracy rules.
- glossary: the Japanese proper nouns you used (shrine, deities, buildings) with the English rendering you chose.`;

export async function generateEditScript(
  params: {
    shrineName: string;
    notes: string;
    clips: EditScriptClipInput[];
    glossary: GlossaryItem[];
  },
  apiKey: string,
  model: ClaudeModelId,
  signal?: AbortSignal
): Promise<EditScript> {
  if (!apiKey.trim()) {
    throw new Error('Claude APIキーが未設定です。「翻訳」タブの Claude API 設定でキーを保存してください。');
  }

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  let imageCount = 0;
  params.clips.forEach((clip, i) => {
    const speech = clip.hasSpeech ? '撮影者の話し声あり' : '話し声なし';
    content.push({ type: 'text', text: `クリップ${i + 1}（${clip.durationSec.toFixed(1)}秒・${speech}）` });
    if (clip.imageBase64 && imageCount < MAX_IMAGES) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: clip.imageBase64 } });
      imageCount++;
    }
  });

  const glossaryText = params.glossary.length > 0
    ? `\n\nGlossary (use these English renderings):\n${params.glossary.map((g) => `- ${g.japanese} -> ${g.english}`).join('\n')}`
    : '';
  content.push({
    type: 'text',
    text: `Shrine: ${params.shrineName}
Notes from the person who filmed (trust these over your own knowledge):
${params.notes.trim() || '(none)'}${glossaryText}

Write the on-screen text for these ${params.clips.length} clips. Return exactly one entry per clip, with index 1 to ${params.clips.length}.`,
  });

  const client = new Anthropic({ apiKey: apiKey.trim(), dangerouslyAllowBrowser: true });
  const isHaiku = model === 'claude-haiku-4-5';

  const response = await client.beta.messages
    .parse(
      {
        model,
        max_tokens: 16000,
        system: EDIT_SCRIPT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
        output_config: isHaiku ? { format: EDIT_SCRIPT_FORMAT } : { format: EDIT_SCRIPT_FORMAT, effort: 'medium' as const },
        ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      },
      { signal }
    )
    .catch((error: unknown) => {
      throw new Error(describeApiError(error));
    });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claudeがテロップの作成を辞退しました。メモの内容を見直して再度お試しください。');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('テロップの作成結果が途中で切れました。動画の本数を減らして再度お試しください。');
  }
  const script = response.parsed_output as EditScript | null;
  if (!script) {
    throw new Error('テロップの作成結果を読み取れませんでした。再度お試しください。');
  }
  return script;
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
