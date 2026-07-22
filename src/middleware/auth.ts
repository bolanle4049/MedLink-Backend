import { Request, Response, NextFunction } from 'express';
import config from '../config';
import globalDB from '../database/db';
import { validateToken } from '../utils/jwt';

export interface AuthenticatedRequest extends Request {
  doctorId?: string;
  email?: string;
  sessionToken?: string;
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
    next();
  } catch (err) {
    res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired session token'
    });
    return;
  }
}

export default authMiddleware;
