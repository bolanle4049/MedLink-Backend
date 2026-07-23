export interface RedFlagCheckParams {
  message: string;
  age?: number;
  sex?: string;
}

export interface RedFlagResult {
  isCritical: boolean;
  matchedReason?: string;
}

const CRITICAL_KEYWORDS = [
  "chest pain",
  "heart attack",
  "unconscious",
  "not breathing",
  "bleeding heavily",
  "stroke",
  "seizure",
  "suicide",
  "kill myself"
];

const INFANT_CRITICAL_KEYWORDS = [
  "fever",
  "not waking up",
  "blue lips",
  "floppy"
];

export function checkRedFlags(params: RedFlagCheckParams): RedFlagResult {
  const normalizedMsg = params.message.toLowerCase();

  // 1. Universal checks
  for (const keyword of CRITICAL_KEYWORDS) {
    if (normalizedMsg.includes(keyword)) {
      return {
        isCritical: true,
        matchedReason: `Triggered critical keyword: ${keyword}`,
      };
    }
  }

  // 2. Age-specific checks
  // If infant (under 1 year)
  if (params.age !== undefined && params.age <= 1) {
    for (const keyword of INFANT_CRITICAL_KEYWORDS) {
      if (normalizedMsg.includes(keyword)) {
        return {
          isCritical: true,
          matchedReason: `Triggered infant critical keyword: ${keyword}`,
        };
      }
    }
  }

  return { isCritical: false };
}
