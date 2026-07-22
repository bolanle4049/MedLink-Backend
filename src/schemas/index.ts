import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
  fullName: z.string().min(1, { message: 'fullName is required' }),
  medicalCredentials: z.string().optional()
});

export const LoginSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(1, { message: 'Password is required' })
});

export const VerifyDoctorSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  isVerified: z.boolean().optional()
});

export const SimulatePatientSchema = z.object({
  patientPhone: z.string().min(1, { message: 'patientPhone is required' }),
  message: z.string().min(1, { message: 'message is required' })
});

export const BAND_VALUES = ['emergency', 'urgent', 'routine', 'non_urgent'] as const;
export const OUTCOME_VALUES = ['resolved', 'needs_visit', 'follow_up'] as const;

export const OverrideUrgencySchema = z.object({
  urgencyBand: z.enum(BAND_VALUES, { errorMap: () => ({ message: 'urgencyBand must be a valid SATS band' }) }),
  reason: z.string().min(1, { message: 'A reason is required for a band override' })
});

export const DoctorReplySchema = z.object({
  responseMessage: z.string().min(1, { message: 'responseMessage is required' }),
  outcome: z.enum(OUTCOME_VALUES, { errorMap: () => ({ message: 'outcome must be resolved, needs_visit, or follow_up' }) })
});

// --- Access model / facility admin (Spec Section 12) ------------------------

export const CreateFacilitySchema = z.object({
  name: z.string().min(1, { message: 'name is required' }),
  type: z.enum(['hospital', 'clinic']).default('hospital'),
  location: z.string().optional(),
  avgResponseMin: z.number().int().positive().optional(),
  adminEmail: z.string().email({ message: 'A valid facility-admin email is required' }),
  adminFullName: z.string().min(1, { message: 'adminFullName is required' }),
  adminTempPassword: z.string().min(6, { message: 'Temporary password must be at least 6 characters' })
});

export const EnrollDoctorSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  fullName: z.string().min(1, { message: 'fullName is required' }),
  mdcnLicense: z.string().min(1, { message: 'MDCN license is required' }),
  tempPassword: z.string().min(6, { message: 'Temporary password must be at least 6 characters' })
});

export const FirstLoginResetSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  currentPassword: z.string().min(1, { message: 'currentPassword is required' }),
  newPassword: z.string().min(6, { message: 'New password must be at least 6 characters' })
});

export const EnrolleeUploadSchema = z.object({
  enrollees: z.array(
    z.object({
      enrolleeId: z.string().min(1),
      patientName: z.string().min(1),
      hmoName: z.string().min(1),
      planTier: z.string().optional(),
      homeFacilityId: z.string().optional(),
      coverageStatus: z.enum(['active', 'lapsed', 'unknown']).default('active')
    })
  ).min(1, { message: 'At least one enrollee is required' })
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type VerifyDoctorInput = z.infer<typeof VerifyDoctorSchema>;
export type SimulatePatientInput = z.infer<typeof SimulatePatientSchema>;
export type OverrideUrgencyInput = z.infer<typeof OverrideUrgencySchema>;
export type DoctorReplyInput = z.infer<typeof DoctorReplySchema>;
