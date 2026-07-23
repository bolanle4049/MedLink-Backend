import config from '../../config';
import { AIProvider, Modality, StructuredRequest } from './types';

// ---------------------------------------------------------------------------
// Google Gemini adapter — text + image/video/audio/document understanding.
//
// Uses the Interactions API (the successor to generateContent, which is being
// retired for new accounts):
//   POST https://generativelanguage.googleapis.com/v1beta/interactions
// Media is passed inline as base64 (request cap ~20MB, covers WhatsApp media).
// Structured JSON via `response_format`. Output lands in the `model_output`
// step's text content.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';
const MAX_INLINE_BYTES = 18 * 1024 * 1024;

// Gemini's schema is an OpenAPI-3 subset; strip JSON-Schema-only keywords.
function toGeminiSchema(schema: any): any {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'additionalProperties' || k === '$schema') continue;
      out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

function partType(mimeType: string): 'image' | 'audio' | 'video' | 'document' {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';

  supports(_modality: Modality): boolean {
    return true; // text, image, video, audio, document
  }

  async completeStructured<T = unknown>(req: StructuredRequest): Promise<T> {
    if (!config.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not set (required for media understanding).');
    }

    const input: any[] = [
      { type: 'text', text: req.system },
      { type: 'text', text: req.prompt }
    ];
    for (const m of req.media || []) {
      if (m.data.length > MAX_INLINE_BYTES) {
        throw new Error(
          `Gemini: media ${m.mimeType} is ${(m.data.length / 1e6).toFixed(1)}MB, exceeds the inline limit.`
        );
      }
      input.push({ type: partType(m.mimeType), mime_type: m.mimeType, data: m.data.toString('base64') });
    }

    const body = {
      model: config.geminiModel,
      input,
      response_format: [
        { type: 'text', mime_type: 'application/json', schema: toGeminiSchema(req.schema) }
      ]
    };

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiApiKey },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini Interactions API ${response.status}: ${errText.slice(0, 400)}`);
    }

    const data: any = await response.json();
    const text = extractText(data);
    if (!text) {
      throw new Error(`Gemini returned no usable content (status=${data?.status ?? 'unknown'}).`);
    }
    return JSON.parse(text) as T;
  }
}

// Output is the last text part across the response steps (after any `thought`
// step, the `model_output` step carries the JSON).
function extractText(data: any): string | undefined {
  let text: string | undefined;
  for (const step of data?.steps || []) {
    const part = (step?.content || []).find((c: any) => c?.type === 'text' && c?.text);
    if (part) text = part.text;
  }
  return text;
}
