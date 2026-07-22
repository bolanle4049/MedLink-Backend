// ---------------------------------------------------------------------------
// HMO verification — the StandardEnrollee contract (Spec Section 11).
// Every adapter populates EXACTLY these fields, returning "unknown" rather
// than omitting any. The result feeds ROUTING ONLY, never triage.
// ---------------------------------------------------------------------------

export type CoverageStatus = 'active' | 'lapsed' | 'unknown';
export type VerificationMethod = 'api' | 'list' | 'manual';

export interface StandardEnrollee {
  valid: boolean;
  enrolleeId: string;
  patientName: string; // the enrollee / account holder (may differ from who is sick)
  hmoName: string;
  planTier: string; // string | "unknown"
  homeFacilityId: string; // drives routing
  coverageStatus: CoverageStatus;
  verificationMethod: VerificationMethod;
}

export interface HmoAdapter {
  readonly method: VerificationMethod;
  verify(enrolleeId: string, hmoName: string): Promise<StandardEnrollee>;
}
