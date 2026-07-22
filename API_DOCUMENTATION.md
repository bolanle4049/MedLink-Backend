# MedLink Backend Complete API Documentation

This document contains full, exhaustive reference documentation for all API endpoints in the MedLink Backend service.

---

## 📋 Table of Contents
1. [Base URL & General Information](#1-base-url--general-information)
2. [Doctor Authentication Endpoints](#2-doctor-authentication-endpoints)
   - [POST /api/auth/register](#21-post-apiauthregister)
   - [POST /api/auth/login](#22-post-apiauthlogin)
   - [GET /api/auth/me](#23-get-apiauthme)
   - [POST /api/auth/logout](#24-post-apiauthlogout)
   - [POST /api/auth/admin/verify](#25-post-apiauthadminverify)
3. [Twilio & Patient WhatsApp Endpoints](#3-twilio--patient-whatsapp-endpoints)
   - [POST /api/twilio/webhook](#31-post-apitwiliowebhook)
   - [POST /api/twilio/simulate-patient](#32-post-apitwiliosimulate-patient)
4. [Doctor Dashboard Triage Queue Endpoints (For Maaz)](#4-doctor-dashboard-triage-queue-endpoints-for-maaz)
   - [GET /api/cases](#41-get-apicases)
   - [GET /api/cases/:id](#42-get-apicasesid)
   - [POST /api/cases/:id/override](#43-post-apicasesidoverride)
   - [POST /api/cases/:id/reply](#44-post-apicasesidreply)
5. [System Endpoints](#5-system-endpoints)
   - [GET /health](#51-get-health)

---

## 1. Base URL & General Information

- **Default Server Base URL**: `http://localhost:8080` (or `PORT` configured in `.env`)
- **Content Types**:
  - `application/json` for standard REST APIs
  - `application/x-www-form-urlencoded` for Twilio Webhooks
  - `multipart/form-data` supported on Registration for credential document uploads
- **Authentication Method**:
  - Protected endpoints require either an **HTTP-only Cookie (`auth_token`)** set automatically upon successful login **OR** a standard **`Authorization: Bearer <sessionToken>`** header.

---

## 2. Doctor Authentication Endpoints

### 2.1 POST `/api/auth/register`
Used by doctors to apply for access to the platform prior to manual verification.

- **Auth Required**: No (Public)
- **Content-Type**: `application/json` OR `multipart/form-data`

#### Request Payload (`JSON`):
```json
{
  "email": "dr.sarah@hospital.org",
  "password": "SecurePassword123!",
  "fullName": "Dr. Sarah Jenkins",
  "medicalCredentials": "MD - General Medicine, License #MD987654"
}
```

#### Request Payload (`multipart/form-data` - with document file):
- `email`: `dr.sarah@hospital.org`
- `password`: `SecurePassword123!`
- `fullName`: `Dr. Sarah Jenkins`
- `medicalCredentials`: *(File Attachment e.g. license.pdf)*

#### Success Response (`201 Created`):
```json
{
  "message": "Registration successful. Your account is pending manual verification.",
  "doctor": {
    "id": "b18b4e72-2d8c-4a37-b9c1-8408cf59623e",
    "email": "dr.sarah@hospital.org",
    "fullName": "Dr. Sarah Jenkins",
    "medicalCredentials": "MD - General Medicine, License #MD987654",
    "isVerified": false,
    "isActive": true,
    "createdAt": "2026-07-22T09:00:00Z"
  },
  "step": "manual_verification_pending"
}
```

#### Error Response (`409 Conflict`):
```json
{
  "error": "registration_failed",
  "message": "error creating doctor: email already registered"
}
```

---

### 2.2 POST `/api/auth/login`
Authenticates the doctor and grants access to the dashboard and triage queue.

> ⚠️ **Server Verification Enforcement**: Checks `isVerified == true` before issuing a token upon successful credential match.

- **Auth Required**: No (Public)
- **Content-Type**: `application/json`

#### Request Payload:
```json
{
  "email": "dr.sarah@hospital.org",
  "password": "SecurePassword123!"
}
```

#### Success Response (`200 OK` - When Verified):
Sets HTTP-only Cookie `auth_token` automatically:
```json
{
  "message": "Login successful",
  "sessionToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "doctor": {
    "id": "b18b4e72-2d8c-4a37-b9c1-8408cf59623e",
    "email": "dr.sarah@hospital.org",
    "fullName": "Dr. Sarah Jenkins",
    "medicalCredentials": "MD - General Medicine, License #MD987654",
    "isVerified": true,
    "isActive": true,
    "createdAt": "2026-07-22T09:00:00Z"
  }
}
```

#### Error Response (`403 Forbidden` - Unverified Doctor):
```json
{
  "error": "account_unverified",
  "message": "Account pending manual verification. Please wait for admin approval.",
  "isVerified": false
}
```

#### Error Response (`401 Unauthorized` - Wrong Credentials):
```json
{
  "error": "invalid_credentials",
  "message": "Invalid email or password"
}
```

---

### 2.3 GET `/api/auth/me`
Validates active session when doctor refreshes the dashboard or opens a new tab.

- **Auth Required**: Yes (`auth_token` Cookie or `Authorization: Bearer <sessionToken>`)

#### Success Response (`200 OK`):
```json
{
  "doctor": {
    "id": "b18b4e72-2d8c-4a37-b9c1-8408cf59623e",
    "email": "dr.sarah@hospital.org",
    "fullName": "Dr. Sarah Jenkins",
    "medicalCredentials": "MD - General Medicine, License #MD987654",
    "isVerified": true,
    "isActive": true,
    "createdAt": "2026-07-22T09:00:00Z"
  }
}
```

#### Error Response (`401 Unauthorized`):
```json
{
  "error": "unauthorized",
  "message": "Missing authentication session token or Authorization header"
}
```

---

### 2.4 POST `/api/auth/logout`
Terminates doctor session, invalidates token on server, and clears HTTP-only cookie.

- **Auth Required**: Yes (`auth_token` Cookie or `Authorization: Bearer <sessionToken>`)

#### Success Response (`200 OK`):
```json
{
  "message": "Logged out successfully"
}
```

---

### 2.5 POST `/api/auth/admin/verify`
Hackathon admin helper to toggle a doctor's manual verification status for testing.

- **Auth Required**: No (Demo Helper)
- **Content-Type**: `application/json`

#### Request Payload:
```json
{
  "email": "dr.sarah@hospital.org",
  "isVerified": true
}
```

#### Success Response (`200 OK`):
```json
{
  "message": "Doctor dr.sarah@hospital.org verification status updated to true",
  "email": "dr.sarah@hospital.org",
  "isVerified": true
}
```

---

## 3. Twilio & Patient WhatsApp Endpoints

### 3.1 POST `/api/twilio/webhook`
Inbound webhook called by Twilio when a patient sends a WhatsApp message.

- **Auth Required**: No (Twilio Form Webhook)
- **Content-Type**: `application/x-www-form-urlencoded`

#### Form Parameters:
- `From`: `whatsapp:+2348123456789`
- `Body`: `"Hello, my name is John. I have severe stomach cramps for 2 days."`

#### Response (`200 OK` - TwiML XML):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Thank you, John. Could you please share your age and gender?</Message>
</Response>
```

---

### 3.2 POST `/api/twilio/simulate-patient`
Patient chat simulation endpoint for testing without live Twilio webhooks.

- **Auth Required**: No (Public Simulation)
- **Content-Type**: `application/json`

#### Request Payload:
```json
{
  "patientPhone": "whatsapp:+2348123456789",
  "message": "My name is John Doe, I am 35 years old male. I have stomach cramps for 2 days."
}
```

#### Success Response (`200 OK`):
```json
{
  "patientPhone": "whatsapp:+2348123456789",
  "userMessage": "My name is John Doe, I am 35 years old male. I have stomach cramps for 2 days.",
  "aiReply": "Got it. How long have you experienced these symptoms or complaint?",
  "case": {
    "id": "a9b1c2d3-1234-5678-90ab-cdef12345678",
    "patientPhone": "whatsapp:+2348123456789",
    "patientName": "John Doe",
    "patientAge": "35 years",
    "patientGender": "Male",
    "primaryComplaint": "stomach cramps for 2 days",
    "urgencyBand": "routine",
    "status": "draft"
  }
}
```

---

## 4. Doctor Dashboard Triage Queue Endpoints (For Maaz)

All endpoints below require a valid Doctor Session via Cookie or `Authorization: Bearer <sessionToken>`.

### 4.1 GET `/api/cases`
Returns the doctor's queue sorted by **Urgency Band** (`critical` > `emergency` > `urgent` > `routine` > `non_urgent`), then by waiting time (oldest waiting first).

- **Auth Required**: Yes (Doctor Auth)
- **Query Parameters**:
  - `status`: `queued`, `resolved`, `needs_visit`, `pending_followup` (Optional)
  - `urgency`: `critical`, `emergency`, `urgent`, `routine`, `non_urgent` (Optional)

#### Example Request:
`GET /api/cases?status=queued`

#### Success Response (`200 OK`):
```json
{
  "count": 2,
  "cases": [
    {
      "id": "c1f7a228-54c3-4d82-b88e-6447c293ba20",
      "patientPhone": "whatsapp:+2348999999999",
      "patientName": "Emergency Patient",
      "patientGender": "",
      "patientAge": "",
      "primaryComplaint": "chest pain and sweating profusely",
      "urgencyBand": "critical",
      "redFlagTriggered": "Chest pain with cardiac warning signs",
      "status": "queued",
      "createdAt": "2026-07-22T09:15:00Z"
    },
    {
      "id": "a9b1c2d3-1234-5678-90ab-cdef12345678",
      "patientPhone": "whatsapp:+2348123456789",
      "patientName": "John Doe",
      "patientGender": "Male",
      "patientAge": "35 years",
      "primaryComplaint": "stomach cramps for 2 days",
      "urgencyBand": "urgent",
      "status": "queued",
      "createdAt": "2026-07-22T09:10:00Z"
    }
  ]
}
```

---

### 4.2 GET `/api/cases/:id`
Retrieves single case details, structured summary, and full WhatsApp transcript.

- **Auth Required**: Yes (Doctor Auth)

#### Example Request:
`GET /api/cases/c1f7a228-54c3-4d82-b88e-6447c293ba20`

#### Success Response (`200 OK`):
```json
{
  "case": {
    "id": "c1f7a228-54c3-4d82-b88e-6447c293ba20",
    "patientPhone": "whatsapp:+2348999999999",
    "patientName": "Emergency Patient",
    "urgencyBand": "critical",
    "redFlagTriggered": "Chest pain with cardiac warning signs",
    "rawTranscript": [
      {
        "sender": "patient",
        "message": "Help! I have severe chest pain and sweating profusely!",
        "timestamp": "2026-07-22T09:15:00Z"
      },
      {
        "sender": "ai",
        "message": "⚠️ URGENT MEDICAL WARNING: Your reported symptoms indicate a potentially serious critical condition...",
        "timestamp": "2026-07-22T09:15:01Z"
      }
    ],
    "status": "queued",
    "createdAt": "2026-07-22T09:15:00Z"
  }
}
```

---

### 4.3 POST `/api/cases/:id/override`
Allows the doctor to manually change the AI-assigned urgency band with a reason.

- **Auth Required**: Yes (Doctor Auth)
- **Content-Type**: `application/json`

#### Request Payload:
```json
{
  "urgencyBand": "emergency",
  "reason": "Vitals indicate severe hypertension"
}
```

#### Success Response (`200 OK`):
```json
{
  "message": "Case urgency band updated successfully",
  "caseId": "c1f7a228-54c3-4d82-b88e-6447c293ba20",
  "oldUrgency": "critical",
  "newUrgency": "emergency"
}
```

---

### 4.4 POST `/api/cases/:id/reply`
Doctor submits reply message & outcome (`resolved`, `needs_visit`, `pending_followup`). Automatically sends the doctor's message to the patient's WhatsApp thread via Twilio and updates case status.

- **Auth Required**: Yes (Doctor Auth)
- **Content-Type**: `application/json`

#### Request Payload:
```json
{
  "responseMessage": "Please report to St. Jude Emergency Room immediately. An emergency team has been notified.",
  "outcome": "needs_visit"
}
```

#### Success Response (`200 OK`):
```json
{
  "message": "Doctor reply delivered to patient WhatsApp thread via Twilio",
  "case": {
    "id": "c1f7a228-54c3-4d82-b88e-6447c293ba20",
    "patientPhone": "whatsapp:+2348999999999",
    "status": "needs_visit",
    "doctorReply": "Please report to St. Jude Emergency Room immediately...",
    "doctorOutcome": "needs_visit",
    "assignedDoctorId": "b18b4e72-2d8c-4a37-b9c1-8408cf59623e"
  }
}
```

---

## 5. System Endpoints

### 5.1 GET `/health`
Health check endpoint to verify backend service status.

- **Auth Required**: No

#### Success Response (`200 OK`):
```json
{
  "service": "MedLink Backend API",
  "status": "ok"
}
```
