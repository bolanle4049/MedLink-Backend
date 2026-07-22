// ---------------------------------------------------------------------------
// Deterministic red-flag layer (Spec Section 9, layer one).
// Clinician-written, held in plain code, NEVER in the AI. Checked on EVERY
// inbound message before any model call. Age-aware and tuned to over-escalate.
// A hit halts the interview, marks the episode critical, and alerts doctors.
// ---------------------------------------------------------------------------

export interface RedFlagResult {
  isRedFlag: boolean;
  ruleName: string;
}

interface RedFlagRule {
  name: string;
  keywords: string[];
  // Optional age gate (inclusive). If set, the rule only fires when the
  // subject's age is known and falls within [minAgeYears, maxAgeYears].
  minAgeYears?: number;
  maxAgeYears?: number;
}

// Age-independent emergencies.
const universalRules: RedFlagRule[] = [
  { name: 'Chest pain with cardiac warning signs', keywords: ['chest pain', 'left arm pain', 'crushing chest', 'heart attack'] },
  { name: 'Severe respiratory distress', keywords: ['difficulty breathing', 'cannot breathe', "can't breathe", 'not breathing', 'gasping', 'suffocating', 'turning blue'] },
  { name: 'Uncontrolled acute hemorrhage', keywords: ['heavy bleeding', 'bleeding profusely', 'gushing blood', 'uncontrolled bleeding', 'vomiting blood', 'coughing blood'] },
  { name: 'Neurological emergency or unresponsiveness', keywords: ['convulsion', 'convulsing', 'seizure', 'unresponsive', 'fainted', 'unconscious', 'not waking up', "won't wake"] },
  { name: 'Acute stroke signs', keywords: ['stroke', 'slurred speech', 'face drooping', 'numbness one side', 'weakness one side'] },
  { name: 'Anaphylaxis / severe allergic reaction', keywords: ['throat closing', 'swollen tongue', 'severe allergic', 'anaphyla'] },
  { name: 'Suicidal ideation / self-harm', keywords: ['kill myself', 'suicide', 'end my life', 'want to die'] }
];

// Age-gated rules. Age flips the ruleset: fever in a newborn is an emergency,
// the same fever in an adult is routine (Spec Section 8).
const ageGatedRules: RedFlagRule[] = [
  { name: 'Fever in infant under 3 months', keywords: ['fever', 'hot', 'high temperature', 'temperature'], minAgeYears: 0, maxAgeYears: 0 },
  { name: 'Infant not feeding / lethargic', keywords: ['not feeding', 'not eating', 'very sleepy', 'floppy', 'lethargic'], minAgeYears: 0, maxAgeYears: 1 }
];

function matchAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/**
 * @param message   The raw inbound patient message.
 * @param subjectAgeYears The clinical subject's age in years (null if unknown).
 *                        For infants under 1, pass 0.
 */
export function checkRedFlags(message: string, subjectAgeYears: number | null = null): RedFlagResult {
  const text = message.toLowerCase();

  for (const rule of universalRules) {
    if (matchAny(text, rule.keywords)) {
      return { isRedFlag: true, ruleName: rule.name };
    }
  }

  for (const rule of ageGatedRules) {
    if (subjectAgeYears === null) continue;
    const min = rule.minAgeYears ?? 0;
    const max = rule.maxAgeYears ?? Number.MAX_SAFE_INTEGER;
    if (subjectAgeYears >= min && subjectAgeYears <= max && matchAny(text, rule.keywords)) {
      return { isRedFlag: true, ruleName: rule.name };
    }
  }

  return { isRedFlag: false, ruleName: '' };
}
