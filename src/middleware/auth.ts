import { Request, Response, NextFunction } from 'express';
import config from '../config';
import globalDB from '../database/db';
import { findDoctorById } from '../models/doctorModel';
import { validateToken } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  doctorId?: string;
  email?: string;
  sessionToken?: string;
  role?: string;
  facilityId?: string;
}

export async function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
  let tokenString: string | undefined;

  // 1. Try to read from HTTP-only cookie 'auth_token'
  if (req.cookies && req.cookies.auth_token) {
    tokenString = req.cookies.auth_token;
  }

  // 2. Fallback to Authorization: Bearer <token> header
  if (!tokenString) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
        tokenString = parts[1];
      }
    }
  }

  if (!tokenString || tokenString.trim() === '') {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Missing authentication session token or Authorization header'
    });
    return;
  }

  // Check if token was revoked via logout
  const isRevoked = await globalDB.isTokenRevoked(tokenString);
  if (isRevoked) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Session has been logged out'
    });
    return;
  }

  try {
    const claims = validateToken(tokenString, config.jwtSecret);
    req.doctorId = claims.doctorId;
    req.email = claims.email;
    req.sessionToken = tokenString;

    // Attach role + facility for scoping and permission separation (Spec §12).
    try {
      const doctor = await findDoctorById(claims.doctorId);
      req.role = doctor.role;
      req.facilityId = doctor.facilityId;
    } catch {
      // Doctor record missing; leave role/facility unset.
    }

    next();
  } catch (err) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired session token'
    });
    return;
  }
}

/**
 * Role guard. Enforces the account hierarchy (Spec Section 12).
 */
export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.role || !roles.includes(req.role)) {
      res.status(403).json({ error: 'forbidden', message: 'Insufficient role for this action' });
      return;
    }
    next();
  };
}

export default authMiddleware;
