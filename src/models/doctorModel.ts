import { v4 as uuidv4 } from 'uuid';
import globalDB from '../database/db';

export interface Doctor {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  medicalCredentials: string;
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DoctorResponse {
  id: string;
  email: string;
  fullName: string;
  medicalCredentials: string;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
}

export function toDoctorResponse(doc: Doctor): DoctorResponse {
  return {
    id: doc.id,
    email: doc.email,
    fullName: doc.fullName,
    medicalCredentials: doc.medicalCredentials,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString()
  };
}

export async function createDoctor(
  email: string,
  passwordHash: string,
  fullName: string,
  medicalCredentials: string
): Promise<Doctor> {
  const id = uuidv4();
  const now = new Date();

  const doc: Doctor = {
    id,
    email,
    passwordHash,
    fullName,
    medicalCredentials,
    isVerified: false,
    isActive: true,
    createdAt: now,
    updatedAt: now
  };

  if (!globalDB.prisma || globalDB.isInMemory) {
    if (globalDB.memoryStore.doctorsByEmail.has(email)) {
      throw new Error('email already registered');
    }
    globalDB.memoryStore.doctorsByID.set(id, doc);
    globalDB.memoryStore.doctorsByEmail.set(email, doc);
    return doc;
  }

  try {
    const created = await globalDB.prisma.doctor.create({
      data: {
        id,
        email,
        passwordHash,
        fullName,
        medicalCredentials,
        isVerified: false,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    });

    return {
      id: created.id,
      email: created.email,
      passwordHash: created.passwordHash,
      fullName: created.fullName,
      medicalCredentials: created.medicalCredentials,
      isVerified: created.isVerified,
      isActive: created.isActive,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt
    };
  } catch (err: any) {
    if (err.code === 'P2002' || err.message?.includes('Unique constraint')) {
      throw new Error('email already registered');
    }
    throw new Error(`error creating doctor: ${err.message}`);
  }
}

export async function findDoctorByEmail(email: string): Promise<Doctor> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    const doc = globalDB.memoryStore.doctorsByEmail.get(email);
    if (!doc) {
      throw new Error('doctor not found');
    }
    return doc;
  }

  const doc = await globalDB.prisma.doctor.findUnique({
    where: { email }
  });

  if (!doc) {
    throw new Error('doctor not found');
  }

  return {
    id: doc.id,
    email: doc.email,
    passwordHash: doc.passwordHash,
    fullName: doc.fullName,
    medicalCredentials: doc.medicalCredentials,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function findDoctorById(id: string): Promise<Doctor> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    const doc = globalDB.memoryStore.doctorsByID.get(id);
    if (!doc) {
      throw new Error('doctor not found');
    }
    return doc;
  }

  const doc = await globalDB.prisma.doctor.findUnique({
    where: { id }
  });

  if (!doc) {
    throw new Error('doctor not found');
  }

  return {
    id: doc.id,
    email: doc.email,
    passwordHash: doc.passwordHash,
    fullName: doc.fullName,
    medicalCredentials: doc.medicalCredentials,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function setDoctorVerified(email: string, isVerified: boolean): Promise<void> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    const doc = globalDB.memoryStore.doctorsByEmail.get(email);
    if (!doc) {
      throw new Error('doctor not found');
    }
    doc.isVerified = isVerified;
    return;
  }

  try {
    await globalDB.prisma.doctor.update({
      where: { email },
      data: { isVerified, updatedAt: new Date() }
    });
  } catch (err: any) {
    throw new Error('doctor not found');
  }
}
