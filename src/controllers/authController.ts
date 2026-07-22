import { Request, Response } from 'express';
import config from '../config';
import globalDB from '../database/db';
import { AuthenticatedRequest } from '../middleware/auth';
import { createDoctor, findDoctorByEmail, findDoctorById, setDoctorVerified, toDoctorResponse } from '../models/doctorModel';
import { LoginSchema, RegisterSchema, VerifyDoctorSchema } from '../schemas';
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

    if (!validCreds || validCreds.trim() === '') {
      res.status(400).json({ error: 'bad_request', message: 'medicalCredentials is required' });
      return;
    }

    const passwordHash = await hashPassword(password);
    const doctor = await createDoctor(email, passwordHash, fullName, validCreds);

    res.status(201).json({
      message: 'Registration successful. Your account is pending manual verification.',
      doctor: toDoctorResponse(doctor),
      step: 'manual_verification_pending'
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
