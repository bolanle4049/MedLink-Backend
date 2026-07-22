// ---------------------------------------------------------------------------
// Triage banding (Spec Section 9, layer two).
// Maps a case to one of four bands using a lightweight adaptation of the
// South African Triage Scale (SATS) rather than an invented score.
//
// PAYMENT-BLIND: this module receives ONLY clinical/subject data. It has no
// access to coverage, HMO, or facility information (Spec Section 2).
// ---------------------------------------------------------------------------

export type TriageBand = 'emergency' | 'urgent' | 'routine' | 'non_urgent';

export interface BandingInput {
  subjectAge: number | null;
  subjectSex: string;
  primaryComplaint: string;
  symptoms: string;
  duration: string;
  transcriptText: string; // full patient-authored text, lowercased upstream is fine
}

export interface BandingResult {
  band: TriageBand;
  rationale: string;
}

// SATS-inspired discriminators. Rule of thumb: when uncertain, escalate upward,
// never downward (Spec Section 9).
const emergencyDiscriminators = [
  'severe pain', 'worst pain', 'vomiting blood', 'blood in stool', 'black stool',
  'high fever', 'very high fever', 'stiff neck', 'confusion', 'disoriented',
  'severe dehydration', 'cannot walk', 'pregnant bleeding', 'severe abdominal pain'
];

const urgentDiscriminators = [
  'moderate pain', 'persistent vomiting', 'diarrhea', 'diarrhoea', 'dehydrated',
  'getting worse', 'worsening', 'fever for', 'shortness of breath on exertion',
  'cramp', 'severe headache', 'unable to eat'
];

const nonUrgentDiscriminators = [
  'mild', 'minor', 'slight', 'runny nose', 'small rash', 'itchy', 'checkup', 'refill'
];

function matches(text: string, list: string[]): string | null {
  for (const term of list) {
    if (text.includes(term)) return term;
  }
  return null;
}

export function bandCase(input: BandingInput): BandingResult {
  const haystack = `${input.primaryComplaint} ${input.symptoms} ${input.duration} ${input.transcriptText}`.toLowerCase();

  const emHit = matches(haystack, emergencyDiscriminators);
  if (emHit) {
    return { band: 'emergency', rationale: `SATS emergency discriminator: "${emHit}"` };
  }

  // Age vulnerability escalates one level for the very young / very old.
  const vulnerable = input.subjectAge !== null && (input.subjectAge <= 5 || input.subjectAge >= 70);

  const urgHit = matches(haystack, urgentDiscriminators);
  if (urgHit) {
    return {
      band: vulnerable ? 'emergency' : 'urgent',
      rationale: vulnerable
        ? `SATS urgent discriminator "${urgHit}" escalated for vulnerable age (${input.subjectAge})`
        : `SATS urgent discriminator: "${urgHit}"`
    };
  }

  const nonUrgHit = matches(haystack, nonUrgentDiscriminators);
  if (nonUrgHit && !vulnerable) {
    return { band: 'non_urgent', rationale: `SATS non-urgent discriminator: "${nonUrgHit}"` };
  }

  return {
    band: vulnerable ? 'urgent' : 'routine',
    rationale: vulnerable
      ? `No acute discriminator; escalated to urgent for vulnerable age (${input.subjectAge})`
      : 'No acute discriminator; default routine'
  };
}
