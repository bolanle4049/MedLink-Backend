export interface StandardEnrollee {
  valid: boolean;
  enrolleeId: string;
  patientName: string;
  hmoName: string;
  planTier: string | 'unknown';
  homeFacilityId: string | null;
  coverageStatus: 'active' | 'lapsed' | 'unknown';
  verificationMethod: 'api' | 'list' | 'manual';
}

export interface IHMOAdapter {
  verifyEnrollee(hmoId: string): Promise<StandardEnrollee>;
}

export class ListBasedHMOAdapter implements IHMOAdapter {
  private hmoName: string;

  constructor(hmoName: string) {
    this.hmoName = hmoName;
  }

  async verifyEnrollee(hmoId: string): Promise<StandardEnrollee> {
    // Mock implementation for MVP. In reality, queries the uploaded list in the database.
    const isValid = hmoId.startsWith("HMO");
    return {
      valid: isValid,
      enrolleeId: hmoId,
      patientName: "John Doe",
      hmoName: this.hmoName,
      planTier: "standard",
      homeFacilityId: "mock-facility-uuid", // This would be the home facility id
      coverageStatus: isValid ? 'active' : 'unknown',
      verificationMethod: 'list'
    };
  }
}

export class ManualFallbackAdapter implements IHMOAdapter {
  async verifyEnrollee(hmoId: string): Promise<StandardEnrollee> {
    return {
      valid: true,
      enrolleeId: hmoId,
      patientName: "Unknown",
      hmoName: "Unknown HMO",
      planTier: 'unknown',
      homeFacilityId: null,
      coverageStatus: 'unknown',
      verificationMethod: 'manual'
    };
  }
}
