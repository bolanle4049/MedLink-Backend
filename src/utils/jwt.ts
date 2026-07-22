import jwt, { JwtPayload } from 'jsonwebtoken';

export interface JWTClaims extends JwtPayload {
  doctorId: string;
  email: string;
}

export function generateToken(doctorId: string, email: string, secret: string, expiresIn: string = '24h'): string {
  return jwt.sign(
    { sub: doctorId, doctorId, email },
    secret,
    { expiresIn: expiresIn as any }
  );
}

export function validateToken(tokenString: string, secret: string): JWTClaims {
  try {
    const decoded = jwt.verify(tokenString, secret) as any;
    return {
      doctorId: decoded.sub || decoded.doctorId,
      email: decoded.email,
      ...decoded
    };
  } catch (err) {
    throw new Error('Invalid or expired token');
  }
}
