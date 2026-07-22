import { v4 as uuidv4 } from 'uuid';
import globalDB from '../database/db';

export type DoctorRole = 'medlink_admin' | 'facility_admin' | 'doctor';

export interface Doctor {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  medicalCredentials: string;
  facilityId: string;
  role: string;
  mdcnLicense: string;
  mustResetPassword: boolean;
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
  facilityId: string;
  role: string;
  mdcnLicense: string;
  mustResetPassword: boolean;
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
    facilityId: doc.facilityId,
    role: doc.role,
    mdcnLicense: doc.mdcnLicense,
    mustResetPassword: doc.mustResetPassword,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: doc.createdAt.toISOString()
  };
}

export interface CreateDoctorOptions {
  facilityId?: string;
  role?: DoctorRole;
  mdcnLicense?: string;
  mustResetPassword?: boolean;
  isVerified?: boolean;
}

export async function createDoctor(
  email: string,
  passwordHash: string,
  fullName: string,
  medicalCredentials: string,
  options: CreateDoctorOptions = {}
): Promise<Doctor> {
  const id = uuidv4();
  const now = new Date();

  const doc: Doctor = {
    id,
    email,
    passwordHash,
    fullName,
    medicalCredentials,
    facilityId: options.facilityId || '',
    role: options.role || 'doctor',
    mdcnLicense: options.mdcnLicense || '',
    mustResetPassword: options.mustResetPassword ?? false,
    isVerified: options.isVerified ?? false,
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
        facilityId: doc.facilityId,
        role: doc.role,
        mdcnLicense: doc.mdcnLicense,
        mustResetPassword: doc.mustResetPassword,
        isVerified: doc.isVerified,
        isActive: true,
        createdAt: now,
        updatedAt: now
      }
    });

    return mapDoctor(created);
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

  return mapDoctor(doc);
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

  return mapDoctor(doc);
}

function mapDoctor(doc: any): Doctor {
  return {
    id: doc.id,
    email: doc.email,
    passwordHash: doc.passwordHash,
    fullName: doc.fullName,
    medicalCredentials: doc.medicalCredentials,
    facilityId: doc.facilityId ?? '',
    role: doc.role ?? 'doctor',
    mdcnLicense: doc.mdcnLicense ?? '',
    mustResetPassword: doc.mustResetPassword ?? false,
    isVerified: doc.isVerified,
    isActive: doc.isActive,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function updateDoctor(id: string, data: Partial<Doctor>): Promise<void> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    const doc = globalDB.memoryStore.doctorsByID.get(id);
    if (!doc) throw new Error('doctor not found');
    Object.assign(doc, data, { updatedAt: new Date() });
    if (doc.email) globalDB.memoryStore.doctorsByEmail.set(doc.email, doc);
    return;
  }
  await globalDB.prisma.doctor.update({ where: { id }, data: { ...data, updatedAt: new Date() } as any });
}

export async function countDoctors(): Promise<number> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    return globalDB.memoryStore.doctorsByID.size;
  }
  return globalDB.prisma.doctor.count();
}

export async function listDoctorsByFacility(facilityId: string): Promise<Doctor[]> {
  if (!globalDB.prisma || globalDB.isInMemory) {
    return [...globalDB.memoryStore.doctorsByID.values()].filter((d) => d.facilityId === facilityId);
  }
  const rows = await globalDB.prisma.doctor.findMany({ where: { facilityId } });
  return rows.map(mapDoctor);
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
