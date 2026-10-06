/**
 * Claude API Integration for Sacred Sanctuary Multilingual Subtitles & Cards
 * Uses client-side direct API call with glossary enforcement.
 */
import { GlossaryItem, LocalizedText } from '../types';

export async function translateWithClaude(
  textToTranslate: string,
  apiKey: string,
  modelName: string = 'claude-3-5-sonnet-20241022',
  glossary: GlossaryItem[] = []
): Promise<{ en: string; th: string }> {
  if (!textToTranslate || textToTranslate.trim() === '') {
    return { en: '', th: '' };
  }

  // If no API key provided, generate a dignified sanctuary-style translation fallback using glossary
  if (!apiKey || apiKey.trim() === '') {
    return mockSanctuaryTranslate(textToTranslate, glossary);
  }

  // Format glossary for prompt
  const glossaryPrompt = glossary.length > 0
    ? `\nUse the following official Sanctuary & Shinto terminology glossary for consistent translation:
${glossary.map(g => `- Japanese: "${g.japanese}" -> English: "${g.english}" / Thai: "${g.thai}"`).join('\n')}`
    : '';

  const systemPrompt = `You are an expert translator specializing in traditional Japanese Shinto shrines, sacred sanctuaries, rituals, and Buddhist heritage.
Translate the provided Japanese commentary or sanctuary information into both English and Thai.
Tone requirements:
- Serene, reverent, solemn, elegant, and atmospheric.
- Keep the sacred aura of the shrine.
- Preserve traditional honorifics and standardized Romanization according to the glossary.
${glossaryPrompt}

You MUST respond strictly with valid JSON with keys "en" and "th":
{
  "en": "English translation here",
  "th": "Thai translation here"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: modelName,
        max_tokens: 500,
        temperature: 0.2,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Please translate this sanctuary text into English and Thai:\n"${textToTranslate}"`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      throw new Error(errJson?.error?.message || `API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const contentText = data.content?.[0]?.text || '';
    
    // Extract JSON block
    const jsonMatch = contentText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        en: parsed.en || '',
        th: parsed.th || '',
      };
    }

    throw new Error('Could not parse JSON response from Claude');
  } catch (error: any) {
    console.warn('Claude API request failed, falling back to terminology mapping:', error);
    // If browser CORS or network error occurs, fall back with warning
    const fallback = mockSanctuaryTranslate(textToTranslate, glossary);
    fallback.en += ` [API: ${error.message || 'CORS/Key check'}]`;
    return fallback;
  }
}

/**
 * Intelligent local shrine translation fallback when API key is missing or testing offline
 */
function mockSanctuaryTranslate(japanese: string, glossary: GlossaryItem[]): { en: string; th: string } {
  let en = japanese;
  let th = japanese;

  // Apply glossary replacements
  for (const item of glossary) {
    if (japanese.includes(item.japanese)) {
      en = en.split(item.japanese).join(item.english);
      th = th.split(item.japanese).join(item.thai);
    }
  }

  // Common shrine vocabulary mappings
  const dict: Record<string, { en: string; th: string }> = {
    '神社': { en: 'Shrine', th: 'ศาลเจ้า' },
    '大社': { en: 'Grand Shrine', th: 'ศาลเจ้าใหญ่' },
    '鳥居': { en: 'Torii Gate', th: 'เสาโทริอิ' },
    '本殿': { en: 'Main Sanctuary (Honden)', th: 'วิหารหลัก' },
    '拝殿': { en: 'Worship Hall (Haiden)', th: 'โถงสักการะ' },
    '手水舎': { en: 'Temizuya (Purification Pavilion)', th: 'ศาลาล้างมือชำระกาย' },
    '参道': { en: 'Sacred Approach (Sando)', th: 'ทางเดินสู่ศาลเจ้า' },
    '御祭神': { en: 'Enshrined Deity', th: 'เทพเจ้าผู้สถิต' },
    'ご利益': { en: 'Divine Blessings', th: 'พรอันศักดิ์สิทธิ์' },
    '二礼二拍手一礼': { en: 'Two bows, two claps, and one final bow', th: 'คำนับสอง ปรบมือสอง คำนับหนึ่ง' },
    '手水で心身を清める': { en: 'Purifying the mind and body with sacred water', th: 'ชำระกายและใจด้วยน้ำบริสุทธิ์' },
    '静寂': { en: 'Serenity and stillness', th: 'ความสงบเงียบศักดิ์สิทธิ์' },
    '神聖': { en: 'Sacred sanctuary', th: 'ศักดิ์สิทธิ์' },
    '開運': { en: 'Good fortune and spiritual blessing', th: 'เสริมโชคลาภและความรุ่งเรือง' },
    '厄除け': { en: 'Warding off misfortune', th: 'ปัดเป่าสิ่งอัปมงคล' },
    '家内安全': { en: 'Family peace and safety', th: 'ความร่มเย็นในครอบครัว' },
  };

  for (const [key, val] of Object.entries(dict)) {
    if (en.includes(key)) {
      en = en.split(key).join(val.en + ' ');
    }
    if (th.includes(key)) {
      th = th.split(key).join(val.th + ' ');
    }
  }

  if (en === japanese) {
    en = `[EN: ${japanese}]`;
  }
  if (th === japanese) {
    th = `[TH: ${japanese}]`;
  }

  return { en: en.trim(), th: th.trim() };
}
