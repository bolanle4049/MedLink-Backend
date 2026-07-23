import Anthropic from '@anthropic-ai/sdk';
import config from '../../config';
import { AIProvider, Modality, StructuredRequest, UnsupportedModalityError } from './types';

// ---------------------------------------------------------------------------
// Anthropic (Claude) adapter. Text + images via structured outputs.
// Claude does NOT accept video/audio — those route to a multimodal provider.
// ---------------------------------------------------------------------------

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic';
  private client: Anthropic | null = null;

  private sdk(): Anthropic {
    if (!config.anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set.');
    }
    if (!this.client) {
      this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    }
    return this.client;
  }

  supports(modality: Modality): boolean {
    // Claude handles text, images, and PDF documents — not video/audio.
    return modality === 'text' || modality === 'image' || modality === 'document';
  }

  async completeStructured<T = unknown>(req: StructuredRequest): Promise<T> {
    const content: Anthropic.ContentBlockParam[] = [];

    for (const m of req.media || []) {
      if (m.mimeType.startsWith('image/')) {
        if (!IMAGE_TYPES.has(m.mimeType)) {
          throw new Error(`Anthropic: unsupported image type ${m.mimeType}`);
        }
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: m.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: m.data.toString('base64')
          }
        });
      } else if (m.mimeType === 'application/pdf') {
        content.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: m.data.toString('base64') }
        });
      } else {
        throw new UnsupportedModalityError(this.name, m.mimeType.split('/')[0] as Modality);
      }
    }
    content.push({ type: 'text', text: req.prompt });

    const response = await this.sdk().messages.create({
      model: config.anthropicModel,
      max_tokens: 1024,
      system: req.system,
      messages: [{ role: 'user', content }],
      output_config: { format: { type: 'json_schema', schema: req.schema } }
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === 'text'
    );
    if (!textBlock) {
      throw new Error('Anthropic response contained no text block.');
    }
    return JSON.parse(textBlock.text) as T;
  }
}
