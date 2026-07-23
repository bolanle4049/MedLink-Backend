import { StandardEnrollee } from './hmoAdapter';

export enum CoverageCase {
  HMO = 1,
  CARD = 2,
  NONE = 3
}

export interface RoutingResult {
  coverageCase: CoverageCase;
  targetFacilityId: string | null; // Null means global pool or specific partner clinic assigned later
  identityMismatch: boolean;
}

export class RoutingEngine {
  /**
   * Determine the routing case and target facility.
   * @param patientHmoData The Enrollee data from the HMO adapter, or null if self-pay/none
   * @param specificFacilityId The facility ID if the patient presented a hospital card
   * @param patientName The name from the Twilio interview (who-for)
   */
  static determineRoute(
    patientHmoData: StandardEnrollee | null,
    specificFacilityId: string | null,
    patientName: string
  ): RoutingResult {
    let identityMismatch = false;

    // Case 1: HMO Plan
    if (patientHmoData && patientHmoData.valid) {
      if (
        patientName &&
        patientHmoData.patientName.toLowerCase() !== 'unknown' &&
        patientName.toLowerCase() !== patientHmoData.patientName.toLowerCase()
      ) {
        identityMismatch = true;
      }

      return {
        coverageCase: CoverageCase.HMO,
        targetFacilityId: patientHmoData.homeFacilityId || null,
        identityMismatch
      };
    }

    // Case 2: Hospital Card (Self-pay at resolution)
    if (specificFacilityId) {
      return {
        coverageCase: CoverageCase.CARD,
        targetFacilityId: specificFacilityId,
        identityMismatch: false
      };
    }

    // Case 3: No Coverage
    return {
      coverageCase: CoverageCase.NONE,
      targetFacilityId: null, // Partner clinic or shared pool
      identityMismatch: false
    };
  }
}
