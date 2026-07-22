import { Request, Response } from 'express';
import config from '../config';
import globalDB from '../database/db';
import { AuthenticatedRequest } from '../middleware/auth';
import { countDoctors, createDoctor, findDoctorByEmail, findDoctorById, setDoctorVerified, toDoctorResponse, updateDoctor } from '../models/doctorModel';
import { recordAudit } from '../models/clinical';
import { FirstLoginResetSchema, LoginSchema, RegisterSchema, VerifyDoctorSchema } from '../schemas';
import { generateToken } from '../utils/jwt';
import { checkPasswordHash, hashPassword } from '../utils/password';

export async function register(req: Request, res: Response): Promise<void> {
  try {
    let medicalCredentials = req.body.medicalCredentials;
    if (req.file) {
      medicalCredentials = req.file.path.replace(/\\/g, '/');
    }

    const parseResult = RegisterSchema.safeParse({
      ...req.body,
      medicalCredentials: medicalCredentials || req.body.medicalCredentials
    });

    if (!parseResult.success) {
      res.status(400).json({
        error: 'bad_request',
        message: parseResult.error.errors[0]?.message || 'Validation error',
        details: parseResult.error.flatten()
      });
      return;
    }

    const { email, password, fullName, medicalCredentials: validCreds } = parseResult.data;

    // Spec Section 12: doctors do NOT self-register. Public registration is
    // only permitted to bootstrap the very first MedLink admin (root). After
    // that, accounts are created top-down (admin -> facility admin -> doctor).
    const existing = await countDoctors();
    if (existing > 0) {
      res.status(403).json({
        error: 'self_registration_disabled',
        message: 'Self-registration is disabled. Accounts are created by a facility admin or MedLink admin.'
      });
      return;
    }

    const passwordHash = await hashPassword(password);
    const doctor = await createDoctor(email, passwordHash, fullName, validCreds || 'MedLink root admin', {
      role: 'medlink_admin',
      isVerified: true
    });

    res.status(201).json({
      message: 'Root MedLink admin created.',
      doctor: toDoctorResponse(doctor),
      role: 'medlink_admin'
    });
  } catch (err: any) {
    res.status(409).json({
      error: 'registration_failed',
      message: err.message || 'error creating doctor'
    });
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = LoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'bad_request',
        message: parseResult.error.errors[0]?.message || 'Validation error'
      });
      return;
    }

    const { email, password } = parseResult.data;

    let doctor;
    try {
      doctor = await findDoctorByEmail(email);
    } catch (err) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    const validPassword = await checkPasswordHash(password, doctor.passwordHash);
    if (!validPassword) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    if (!doctor.isVerified) {
      res.status(403).json({
        error: 'account_unverified',
        message: 'Account pending manual verification. Please wait for admin approval.',
        isVerified: false
      });
      return;
    }

    if (!doctor.isActive) {
      res.status(403).json({
        error: 'account_disabled',
        message: 'Account has been deactivated.'
      });
      return;
    }

    // Forced first-login password reset (Spec Section 12): issue a short-lived
    // token scoped to completing the reset, and flag the client.
    if (doctor.mustResetPassword) {
      const resetToken = generateToken(doctor.id, doctor.email, config.jwtSecret, '15m');
      res.status(200).json({
        message: 'Password reset required before first use.',
        mustResetPassword: true,
        resetToken,
        doctor: toDoctorResponse(doctor)
      });
      return;
    }

    const token = generateToken(doctor.id, doctor.email, config.jwtSecret, '24h');

    res.cookie('auth_token', token, {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      path: '/',
      secure: false
    });

    res.status(200).json({
      message: 'Login successful',
      sessionToken: token,
      doctor: toDoctorResponse(doctor)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}

export async function firstLoginReset(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = FirstLoginResetSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: 'bad_request', message: parseResult.error.errors[0]?.message || 'Validation error' });
      return;
    }
    const { email, currentPassword, newPassword } = parseResult.data;

    let doctor;
    try {
      doctor = await findDoctorByEmail(email);
    } catch {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    const valid = await checkPasswordHash(currentPassword, doctor.passwordHash);
    if (!valid) {
      res.status(401).json({ error: 'invalid_credentials', message: 'Invalid email or password' });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await updateDoctor(doctor.id, { passwordHash, mustResetPassword: false } as any);
    await recordAudit('doctor_password_reset', { doctorId: doctor.id, reason: 'first-login reset completed' });

    const token = generateToken(doctor.id, doctor.email, config.jwtSecret, '24h');
    res.cookie('auth_token', token, { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, path: '/', secure: false });
    res.status(200).json({ message: 'Password reset successful. You are now logged in.', sessionToken: token });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}

export async function me(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (!req.doctorId) {
      res.status(401).json({ error: 'unauthorized', message: 'Session invalid' });
      return;
    }

    const doctor = await findDoctorById(req.doctorId);
    res.status(200).json({
      doctor: toDoctorResponse(doctor)
    });
  } catch (err: any) {
    res.status(404).json({ error: 'not_found', message: 'Doctor record not found' });
  }
}

export async function logout(req: AuthenticatedRequest, res: Response): Promise<void> {
  try {
    if (req.sessionToken) {
      await globalDB.revokeToken(req.sessionToken);
    }

    res.clearCookie('auth_token', { path: '/' });
    res.status(200).json({
      message: 'Logged out successfully'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'server_error', message: err.message });
  }
}

export async function adminVerifyDoctor(req: Request, res: Response): Promise<void> {
  try {
    const parseResult = VerifyDoctorSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'bad_request',
        message: parseResult.error.errors[0]?.message || 'Validation error'
      });
      return;
    }

    const { email, isVerified } = parseResult.data;
    const verifiedStatus = isVerified !== undefined ? Boolean(isVerified) : true;
    await setDoctorVerified(email, verifiedStatus);

    res.status(200).json({
      message: `Doctor ${email} verification status updated to ${verifiedStatus}`,
      email,
      isVerified: verifiedStatus
    });
  } catch (err: any) {
    res.status(404).json({ error: 'not_found', message: err.message });
  }
}
