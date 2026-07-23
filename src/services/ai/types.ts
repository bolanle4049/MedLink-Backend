// ---------------------------------------------------------------------------
// Provider-agnostic AI interface.
//
// The rest of the app talks to this interface only — it never imports a vendor
// SDK. Concrete adapters (anthropic.ts, gemini.ts) implement it. This is what
// lets us keep Claude for the text interview while routing image/video/audio
// understanding to a multimodal provider (Gemini), and swap either via config.
// ---------------------------------------------------------------------------

export type Modality = 'text' | 'image' | 'video' | 'audio' | 'document';

export interface MediaPart {
  mimeType: string; // e.g. image/jpeg, video/mp4, audio/ogg
  data: Buffer; // raw bytes
}

export interface StructuredRequest {
  system: string;
  prompt: string;
  /** JSON Schema (OpenAPI-3 subset) the response must validate against. */
  schema: Record<string, unknown>;
  /** Optional media attachments; providers that don't support the modality throw. */
  media?: MediaPart[];
}

export interface AIProvider {
  readonly name: string;
  supports(modality: Modality): boolean;
  /** Returns the model's response parsed & validated against `schema`. */
  completeStructured<T = unknown>(req: StructuredRequest): Promise<T>;
}

export function modalityForMime(mimeType: string): Modality {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  // PDFs and similar (e.g. lab/test-result documents) go through document
  // understanding, not the text path.
  if (mimeType === 'application/pdf') return 'document';
  return 'text';
}

export class UnsupportedModalityError extends Error {
  constructor(provider: string, modality: Modality) {
    super(`Provider '${provider}' does not support ${modality} input.`);
    this.name = 'UnsupportedModalityError';
  }
}
