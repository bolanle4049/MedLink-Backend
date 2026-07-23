import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email({ message: 'Invalid email address' }),
  password: z.string().min(6, { message: 'Password must be at least 6 characters' }),
  fullName: z.string().min(1, { message: 'fullName is required' }),
  mdcnLicense: z.string().optional()
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

export const OverrideUrgencySchema = z.object({
  urgencyBand: z.string().min(1, { message: 'urgencyBand is required' }),
  reason: z.string().optional()
});

export const DoctorReplySchema = z.object({
  responseMessage: z.string().min(1, { message: 'responseMessage is required' }),
  outcome: z.string().min(1, { message: 'outcome is required' })
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type VerifyDoctorInput = z.infer<typeof VerifyDoctorSchema>;
export type SimulatePatientInput = z.infer<typeof SimulatePatientSchema>;
export type OverrideUrgencyInput = z.infer<typeof OverrideUrgencySchema>;
export type DoctorReplyInput = z.infer<typeof DoctorReplySchema>;
