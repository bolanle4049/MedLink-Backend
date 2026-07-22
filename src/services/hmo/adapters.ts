import { HmoAdapter, StandardEnrollee } from './types';

// ---------------------------------------------------------------------------
// One adapter per verification method. Signing a new HMO means writing one new
// adapter; nothing else changes (Spec Section 11).
// ---------------------------------------------------------------------------

// In-memory uploaded enrollee list (the MVP default). In production this is
// populated by the facility-admin list upload. Seeded here for demo/testing.
export interface EnrolleeListRow {
  enrolleeId: string;
  patientName: string;
  hmoName: string;
  planTier: string;
  homeFacilityId: string;
  coverageStatus: 'active' | 'lapsed' | 'unknown';
}

export const uploadedEnrolleeList = new Map<string, EnrolleeListRow>();

export function seedEnrollee(row: EnrolleeListRow): void {
  uploadedEnrolleeList.set(row.enrolleeId.toUpperCase(), row);
}

// Adapter B — uploaded list (MVP default).
export class ListAdapter implements HmoAdapter {
  readonly method = 'list' as const;

  async verify(enrolleeId: string, hmoName: string): Promise<StandardEnrollee> {
    const row = uploadedEnrolleeList.get(enrolleeId.toUpperCase());
    if (!row) {
      return {
        valid: false,
        enrolleeId,
        patientName: 'unknown',
        hmoName,
        planTier: 'unknown',
        homeFacilityId: '',
        coverageStatus: 'unknown',
        verificationMethod: 'list'
      };
    }
    return {
      valid: true,
      enrolleeId: row.enrolleeId,
      patientName: row.patientName,
      hmoName: row.hmoName || hmoName,
      planTier: row.planTier || 'unknown',
      homeFacilityId: row.homeFacilityId,
      coverageStatus: row.coverageStatus,
      verificationMethod: 'list'
    };
  }
}

// Adapter C — manual fallback (facility confirms on arrival).
export class ManualAdapter implements HmoAdapter {
  readonly method = 'manual' as const;

  async verify(enrolleeId: string, hmoName: string): Promise<StandardEnrollee> {
    return {
      valid: false, // not yet confirmed; facility will confirm in person
      enrolleeId,
      patientName: 'unknown',
      hmoName,
      planTier: 'unknown',
      homeFacilityId: '',
      coverageStatus: 'unknown',
      verificationMethod: 'manual'
    };
  }
}

// Adapter A — live API (a minority of larger HMOs). Stubbed; wire per HMO.
export class ApiAdapter implements HmoAdapter {
  readonly method = 'api' as const;
  constructor(private readonly baseUrl?: string) {}

  async verify(enrolleeId: string, hmoName: string): Promise<StandardEnrollee> {
    // Without a configured endpoint we degrade to an unknown result rather
    // than throwing, keeping the routing lane resilient.
    return {
      valid: false,
      enrolleeId,
      patientName: 'unknown',
      hmoName,
      planTier: 'unknown',
      homeFacilityId: '',
      coverageStatus: 'unknown',
      verificationMethod: 'api'
    };
  }
}
