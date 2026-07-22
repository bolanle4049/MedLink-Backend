// ---------------------------------------------------------------------------
// Identity resolution helpers (Spec Section 8). Deterministic parsing of the
// consent answer, the who-for menu, subject age/sex, and coverage selection.
// These live OUTSIDE the triage core.
// ---------------------------------------------------------------------------

export type Consent = 'yes' | 'no' | 'unclear';

export function parseConsent(message: string): Consent {
  const m = message.trim().toLowerCase();
  if (/^(1|yes|y|yeah|yep|ok|okay|agree|i agree|i consent|consent|sure|proceed)\b/.test(m)) return 'yes';
  if (/^(2|no|n|nope|stop|decline|cancel|don'?t)\b/.test(m)) return 'no';
  return 'unclear';
}

export type ReporterRelationship = 'self' | 'child' | 'other_adult';

export function parseWhoFor(message: string): ReporterRelationship | null {
  const m = message.trim().toLowerCase();
  if (/^1\b/.test(m) || /\b(me|myself|i am|for me)\b/.test(m)) return 'self';
  if (/^2\b/.test(m) || /\b(child|kid|son|daughter|baby|infant|my son|my daughter)\b/.test(m)) return 'child';
  if (/^3\b/.test(m) || /\b(another adult|someone|my (wife|husband|mother|father|friend|partner|mum|dad)|adult)\b/.test(m)) return 'other_adult';
  return null;
}

export interface AgeSex {
  age: number | null;
  sex: string; // Male | Female | '' if unknown
}

export function parseAgeSex(message: string): AgeSex {
  const m = message.toLowerCase();
  let age: number | null = null;
  let sex = '';

  // Months for infants -> treat as age 0 years.
  const monthMatch = m.match(/\b(\d{1,2})\s*(month|months|mo)\b/);
  if (monthMatch) {
    age = 0;
  } else {
    const yearMatch = m.match(/\b(\d{1,3})\s*(years|year|yrs|yr|y|o|old)?\b/);
    if (yearMatch && yearMatch[1]) {
      const n = parseInt(yearMatch[1], 10);
      if (n >= 0 && n <= 120) age = n;
    }
  }

  if (/\b(male|man|boy|m)\b/.test(m)) sex = 'Male';
  else if (/\b(female|woman|girl|f)\b/.test(m)) sex = 'Female';

  return { age, sex };
}

export type CoverageType = 'hmo' | 'card' | 'none';

export interface CoverageSelection {
  coverageType: CoverageType;
  enrolleeId?: string;
  hmoName?: string;
  cardFacilityId?: string;
}

/**
 * Coverage capture is a deterministic parse of the patient's reply to the
 * coverage question. HMO detection is via pick-list in production; here we
 * accept an enrollee/HMO number, the word "card", or "none".
 */
export function parseCoverage(message: string): CoverageSelection | null {
  const m = message.trim().toLowerCase();

  if (/\b(none|no cover|no insurance|nothing|self pay|self-pay|pay myself)\b/.test(m)) {
    return { coverageType: 'none' };
  }

  if (/\b(card|hospital card)\b/.test(m)) {
    return { coverageType: 'card' };
  }

  // An enrollee/HMO number: contains letters+digits or a run of digits >= 4.
  const idMatch = message.trim().match(/\b([A-Za-z]{0,5}[-/]?\d{4,}[A-Za-z0-9-]*)\b/);
  if (/\bhmo\b/.test(m) || idMatch) {
    return {
      coverageType: 'hmo',
      enrolleeId: idMatch ? idMatch[1] : message.trim(),
      hmoName: 'Unknown HMO'
    };
  }

  return null;
}
