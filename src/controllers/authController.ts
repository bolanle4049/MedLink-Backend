import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import config from "../config";
import { RegisterSchema, LoginSchema, VerifyDoctorSchema } from "../schemas";

const prisma = new PrismaClient();

export async function register(req: Request, res: Response): Promise<void> {
  const parseResult = RegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    res
      .status(400)
      .json({
        error: "bad_request",
        message: parseResult.error.errors[0]?.message,
      });
    return;
  }

  const { email, password, fullName, mdcnLicense } = parseResult.data;

  const existingDoctor = await prisma.doctor.findUnique({ where: { email } });
  if (existingDoctor) {
    res
      .status(409)
      .json({
        error: "registration_failed",
        message: "error creating doctor: email already registered",
      });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // For MVP, create a dummy facility if none is provided in the schema, but ideally it comes from the request.
  // We'll create a default facility or attach to it.
  let facility = await prisma.facility.findFirst();
  if (!facility) {
    facility = await prisma.facility.create({
      data: { name: "Default MedLink Hospital", type: "hospital" },
    });
  }

  const newDoctor = await prisma.doctor.create({
    data: {
      email,
      passwordHash,
      fullName,
      role: "doctor",
      mdcnLicense: mdcnLicense ?? "",
      facilityId: facility.id,
      isVerified: false,
      isActive: true,
      mustResetPassword: true,
    },
  });

  res.status(201).json({
    message:
      "Registration successful. Your account is pending manual verification.",
    doctor: {
      id: newDoctor.id,
      email: newDoctor.email,
      fullName: newDoctor.fullName,
      mdcnLicense: newDoctor.mdcnLicense,
      isVerified: newDoctor.isVerified,
      isActive: newDoctor.isActive,
      createdAt: newDoctor.createdAt,
    },
    step: "manual_verification_pending",
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const parseResult = LoginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res
      .status(400)
      .json({
        error: "bad_request",
        message: parseResult.error.errors[0]?.message,
      });
    return;
  }

  const { email, password } = parseResult.data;

  const doctor = await prisma.doctor.findUnique({ where: { email } });
  if (!doctor || !(await bcrypt.compare(password, doctor.passwordHash))) {
    res
      .status(401)
      .json({
        error: "invalid_credentials",
        message: "Invalid email or password",
      });
    return;
  }

  if (!doctor.isVerified) {
    res
      .status(403)
      .json({
        error: "account_unverified",
        message:
          "Account pending manual verification. Please wait for admin approval.",
        isVerified: false,
      });
    return;
  }

  const token = jwt.sign(
    { id: doctor.id, email: doctor.email, facilityId: doctor.facilityId },
    config.jwtSecret,
    { expiresIn: "8h" },
  );

  res.cookie("auth_token", token, {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
  });

  res.status(200).json({
    message: "Login successful",
    sessionToken: token,
    doctor: {
      id: doctor.id,
      email: doctor.email,
      fullName: doctor.fullName,
      mdcnLicense: doctor.mdcnLicense,
      isVerified: doctor.isVerified,
      isActive: doctor.isActive,
      createdAt: doctor.createdAt,
    },
  });
}

export async function me(req: Request, res: Response): Promise<void> {
  const doctor = (req as any).user;
  if (!doctor) {
    res.status(401).json({ error: "unauthorized", message: "Invalid session" });
    return;
  }

  res.status(200).json({
    doctor: {
      id: doctor.id,
      email: doctor.email,
      fullName: doctor.fullName,
      mdcnLicense: doctor.mdcnLicense,
      isVerified: doctor.isVerified,
      isActive: doctor.isActive,
      createdAt: doctor.createdAt,
    },
  });
}

import globalDB from "../database/db";

export async function logout(req: Request, res: Response): Promise<void> {
  const token = (req as any).sessionToken;
  if (token) {
    await globalDB.revokeToken(token);
  }
  res.clearCookie("auth_token");
  res.status(200).json({ message: "Logged out successfully" });
}

export async function adminVerify(req: Request, res: Response): Promise<void> {
  const parseResult = VerifyDoctorSchema.safeParse(req.body);
  if (!parseResult.success) {
    res
      .status(400)
      .json({
        error: "bad_request",
        message: parseResult.error.errors[0]?.message,
      });
    return;
  }

  const { email, isVerified } = parseResult.data;

  const doctor = await prisma.doctor.update({
    where: { email },
    data: { isVerified },
  });

  res.status(200).json({
    message: `Doctor ${email} verification status updated to ${isVerified}`,
    email: doctor.email,
    isVerified: doctor.isVerified,
  });
}
