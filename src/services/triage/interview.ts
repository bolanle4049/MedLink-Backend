import Anthropic from '@anthropic-ai/sdk';
import config from '../../config';

// ---------------------------------------------------------------------------
// Payment-blind clinical interview (Spec Sections 2, 4, 7).
//
// This is inside the triage core. It receives ONLY the clinical subject and
// the conversation so far. It NEVER receives coverage / HMO / facility data.
// It proposes structured fields; the system validates and persists them, and
// every extracted field is tied to the patient's own words (source_quote) for
// traceability (Spec Section 4.6). The AI has no consequential capability.
//
// This calls the Anthropic API directly. There is no rule-based fallback — a
// missing or invalid ANTHROPIC_API_KEY is a hard configuration error.
// ---------------------------------------------------------------------------

export interface InterviewSubject {
  reporterRelationship: string; // self | child | other_adult
  subjectAge: number | null;
  subjectSex: string;
}

export interface InterviewKnown {
  primaryComplaint: string;
  symptoms: string;
  duration: string;
}

export interface ExtractedObservation {
  code: string;
  value: string;
  sourceQuote: string;
}

export interface InterviewResult {
  updated: InterviewKnown;
  observations: ExtractedObservation[];
  nextQuestion: string;
  readyToConfirm: boolean;
}

let client: Anthropic | null = null;

function anthropic(): Anthropic {
  if (!config.anthropicApiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. The clinical interview requires a valid Anthropic API key.'
    );
  }
  if (!client) {
    client = new Anthropic({ apiKey: config.anthropicApiKey });
  }
  return client;
}

function isProxy(subject: InterviewSubject): boolean {
  return subject.reporterRelationship === 'child' || subject.reporterRelationship === 'other_adult';
}

// Structured-output schema. Guarantees the model returns exactly these fields
// so we never parse free-form text or strip markdown fences.
const INTERVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    primaryComplaint: { type: 'string', description: "The patient's main presenting complaint, in their words." },
    symptoms: { type: 'string', description: 'Accumulated symptoms gathered so far.' },
    duration: { type: 'string', description: 'How long the symptoms have been present.' },
    observations: {
      type: 'array',
      description: 'Discrete clinical observations extracted from the latest message.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: { type: 'string', description: 'Short slug, e.g. primary_complaint, symptom, duration.' },
          value: { type: 'string', description: 'The structured value.' },
          sourceQuote: { type: 'string', description: "The exact patient words this was drawn from." }
        },
        required: ['code', 'value', 'sourceQuote']
      }
    },
    nextQuestion: {
      type: 'string',
      description: 'One clarifying question to ask next. Empty string when ready to confirm.'
    },
    readyToConfirm: {
      type: 'boolean',
      description: 'True once complaint, symptoms and duration are all captured.'
    }
  },
  required: ['primaryComplaint', 'symptoms', 'duration', 'observations', 'nextQuestion', 'readyToConfirm']
} as const;

function buildSystemPrompt(subject: InterviewSubject): string {
  const perspective = isProxy(subject)
    ? `The reporter is speaking about someone else (relationship: ${subject.reporterRelationship}). Ask questions in the third person and treat answers as secondhand; accept "I don't know" and note the gap rather than pressing.`
    : `The reporter is the patient themselves. Ask questions in the second person.`;

  return `You are MedLink's payment-blind clinical intake assistant, operating over WhatsApp.

Your only job is to gather and structure the clinical picture. You do NOT diagnose, advise, or ever mention money, insurance, HMOs, or facilities.

${perspective}
Subject age: ${subject.subjectAge ?? 'unknown'}. Subject sex: ${subject.subjectSex || 'unknown'}.

Rules:
- Ask exactly ONE short, plain-language question at a time in "nextQuestion".
- Merge new information into "primaryComplaint", "symptoms" and "duration"; never drop what was already known.
- Every field you extract into "observations" must carry the exact patient words in "sourceQuote".
- Set "readyToConfirm" to true once you have a primary complaint, associated symptoms, and a duration. When true, set "nextQuestion" to an empty string.`;
}

export async function runInterviewTurn(
  subject: InterviewSubject,
  known: InterviewKnown,
  latestMsg: string
): Promise<InterviewResult> {
  const userPrompt = `Known so far:
- complaint: "${known.primaryComplaint}"
- symptoms: "${known.symptoms}"
- duration: "${known.duration}"

Latest patient message: "${latestMsg}"

Update the structured record and decide the next question.`;

  // No extended thinking: this is a lightweight structured-extraction turn and
  // the schema keeps the output clean, so thinking would only burn tokens.
  const response = await anthropic().messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system: buildSystemPrompt(subject),
    messages: [{ role: 'user', content: userPrompt }],
    output_config: { format: { type: 'json_schema', schema: INTERVIEW_SCHEMA } }
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === 'text'
  );
  if (!textBlock) {
    throw new Error('Anthropic interview response contained no text block.');
  }

  const parsed = JSON.parse(textBlock.text) as {
    primaryComplaint?: string;
    symptoms?: string;
    duration?: string;
    observations?: ExtractedObservation[];
    nextQuestion?: string;
    readyToConfirm?: boolean;
  };

  return {
    updated: {
      primaryComplaint: parsed.primaryComplaint || known.primaryComplaint,
      symptoms: parsed.symptoms || known.symptoms,
      duration: parsed.duration || known.duration
    },
    observations: Array.isArray(parsed.observations) ? parsed.observations : [],
    nextQuestion: parsed.nextQuestion || '',
    readyToConfirm: Boolean(parsed.readyToConfirm)
  };
}
