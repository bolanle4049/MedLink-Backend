import { ApiAdapter, ListAdapter, ManualAdapter } from './adapters';
import { HmoAdapter, StandardEnrollee, VerificationMethod } from './types';

export * from './types';
export { seedEnrollee, uploadedEnrolleeList } from './adapters';

// ---------------------------------------------------------------------------
// The single internal interface application code speaks to (Spec Section 11).
// Application code never cares how a given HMO exposes data.
// ---------------------------------------------------------------------------

const adapters: Record<VerificationMethod, HmoAdapter> = {
  list: new ListAdapter(),
  manual: new ManualAdapter(),
  api: new ApiAdapter()
};

/**
 * Resolve coverage for an enrollee. Chooses the adapter by the HMO's configured
 * method and always returns a StandardEnrollee (never throws for a miss).
 */
export async function verifyEnrollee(
  enrolleeId: string,
  hmoName: string,
  method: VerificationMethod = 'list'
): Promise<StandardEnrollee> {
  const adapter = adapters[method] || adapters.list;
  try {
    return await adapter.verify(enrolleeId, hmoName);
  } catch {
    // Never let a coverage failure crash the flow — fall back to manual.
    return adapters.manual.verify(enrolleeId, hmoName);
  }
}
