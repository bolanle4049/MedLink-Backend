import config from '../../config';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';
import { AIProvider, MediaPart, Modality, modalityForMime } from './types';

export { modalityForMime } from './types';
export type { AIProvider, MediaPart, Modality, StructuredRequest } from './types';

// ---------------------------------------------------------------------------
// Provider registry + config-driven routing. Default: Claude for text,
// Gemini for image/video/audio. Override per group with AI_TEXT_PROVIDER /
// AI_MEDIA_PROVIDER.
// ---------------------------------------------------------------------------

const registry: Record<string, AIProvider> = {
  anthropic: new AnthropicProvider(),
  gemini: new GeminiProvider()
};

function resolve(name: string): AIProvider {
  const p = registry[name];
  if (!p) throw new Error(`Unknown AI provider '${name}'. Known: ${Object.keys(registry).join(', ')}`);
  return p;
}

/** Provider for a given modality, honoring config and capability. */
export function providerFor(modality: Modality): AIProvider {
  const name = modality === 'text' ? config.aiTextProvider : config.aiMediaProvider;
  const provider = resolve(name);
  if (!provider.supports(modality)) {
    throw new Error(`Configured provider '${name}' does not support ${modality}.`);
  }
  return provider;
}

const MEDIA_UNDERSTANDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    description: {
      type: 'string',
      description: 'A concise, clinically-relevant description of what the media shows or says.'
    }
  },
  required: ['description']
} as const;

/**
 * Turn one media attachment into a text description a text model can triage on.
 * Payment-blind, like the interview: describe symptoms/appearance/words only.
 */
export async function understandMedia(media: MediaPart, patientHint: string): Promise<string> {
  const modality = modalityForMime(media.mimeType);
  const provider = providerFor(modality);

  const system =
    `You are a clinical media-understanding assistant for a payment-blind triage service. ` +
    `Describe only what is clinically relevant in the ${modality}, in plain language a triage ` +
    `assistant can act on. ` +
    `For images: the visible body part, lesion, rash, swelling, colour, or injury. ` +
    `For documents (lab or test results): extract each test name with its value, unit, reference range, ` +
    `and flag any result outside its range. ` +
    `For audio: transcribe what the patient says and note audible signs (cough, wheeze, slurring, distress). ` +
    `For video: transcribe speech and describe visible signs and movement. ` +
    `CRITICAL: Report ONLY what is actually present. If the ${modality} has no intelligible speech, ` +
    `no clinical content, or is unclear/corrupted/silent, say exactly that (e.g. "No speech detected; ` +
    `audio appears to be a tone or noise"). NEVER invent, infer, or embellish symptoms, values, or speech ` +
    `that are not clearly present — a fabricated symptom is worse than "unclear". ` +
    `Do NOT diagnose, and never mention money or insurance.`;

  const prompt = patientHint
    ? `The patient sent this ${modality} with the note: "${patientHint}". Describe it.`
    : `The patient sent this ${modality} with no caption. Describe it.`;

  const out = await provider.completeStructured<{ description: string }>({
    system,
    prompt,
    schema: MEDIA_UNDERSTANDING_SCHEMA as unknown as Record<string, unknown>,
    media: [media]
  });
  return out.description;
}
