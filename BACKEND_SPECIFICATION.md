# MedLink AI — Backend Technical Specification

## 1. Overview
This document serves as the comprehensive technical specification for the MedLink AI backend. Built on Node.js, Express, and Prisma ORM, it acts as the triage and intake layer connecting patients (via WhatsApp) to doctors (via the web dashboard).

The primary focus is **payment-blind triage** combined with **deterministic identity and routing**. The AI only asks clinical questions and assigns urgency bands, while deterministic systems handle identity, HMO verification, and routing.

---

## 2. Design Principles

1. **Payment-Blind Triage**: Coverage data is strictly inaccessible from the clinical interview and banding logic.
2. **Deterministic Red Flags**: Evaluated before any AI model call. A predefined list of critical keywords/phrases (factoring in the patient's age) triggers immediate escalation.
3. **Privilege Separation**: The patient-facing AI cannot execute system actions; it only proposes structured JSON data, which is schema-validated before persistence.
4. **Unit of Care = Episode**: A WhatsApp thread consists of distinct episodes. Every inbound message is mapped to an active or new episode.
5. **Source Traceability**: Every structured observation in the clinical report includes a direct quote and links to the original patient message ID.
6. **Doctor Accountability**: Only verified doctors can make real-world clinical decisions or overrides. All actions are immutably audited.

---

## 3. System Architecture

### 3.1 Components

- **API Edge (FastAPI / Express)**: Webhook receiver, handles request validation, signature verification, message deduplication, and consent gating.
- **Red-Flag Engine**: Deterministic rules engine (regex/keyword + age parameters) that runs on every message.
- **Triage Core**: The LLM-powered module for clinical interviewing and SATS (South African Triage Scale) banding.
- **Identity & Routing Engine**: Resolves the "Who-for" question, interfaces with HMO adapters, and routes the episode to the appropriate facility queue.
- **Dashboard Backend**: Provides endpoints for authenticated doctors and facility admins to view queues, override bands, and reply to patients.

### 3.2 The Three Coverage Cases

1. **HMO Plan (Case 1)**: Routes to the patient's registered primary (home) facility. Pre-auth processes may fire for urgent cases.
2. **Hospital Card (Case 2)**: Routes to the specific facility's queue. Patient self-pays.
3. **No Coverage (Case 3)**: Routes to a partner clinic or shared doctor pool. Serves as an enrolment funnel.

---

## 4. Data Model (Prisma Schema Blueprint)

The database schema reflects the separation of Contact, Patient, and Episode.

```prisma
model Facility {
  id               String    @id @default(uuid())
  name             String
  type             String    // 'hospital' | 'clinic'
  location         String?
  avgResponseMin   Int       @default(30)
  doctors          Doctor[]
  patients         Patient[]
  episodes         Episode[]
}

model Doctor {
  id                 String      @id @default(uuid())
  facilityId         String
  facility           Facility    @relation(fields: [facilityId], references: [id])
  email              String      @unique
  passwordHash       String
  fullName           String
  role               String
  mdcnLicense        String
  isVerified         Boolean     @default(false)
  isActive           Boolean     @default(true)
  mustResetPassword  Boolean     @default(true)
  episodes           Episode[]
  auditLogs          AuditLog[]
}

model Contact {
  id               String               @id @default(uuid())
  waPhone          String               @unique
  lastSeen         DateTime             @default(now())
  consents         Consent[]
  episodes         Episode[]
  patientLinks     ContactPatientLink[]
}

model Patient {
  id                 String               @id @default(uuid())
  facilityId         String?
  facility           Facility?            @relation(fields: [facilityId], references: [id])
  name               String
  dob                DateTime?
  sex                String
  facilityPatientId  String?
  contactLinks       ContactPatientLink[]
  episodes           Episode[]
}

model ContactPatientLink {
  id           String   @id @default(uuid())
  contactId    String
  patientId    String
  verifyStatus String
  contact      Contact  @relation(fields: [contactId], references: [id])
  patient      Patient  @relation(fields: [patientId], references: [id])
}

model Episode {
  id                   String                 @id @default(uuid())
  contactId            String
  contact              Contact                @relation(fields: [contactId], references: [id])
  patientId            String?
  patient              Patient?               @relation(fields: [patientId], references: [id])
  facilityId           String?
  facility             Facility?              @relation(fields: [facilityId], references: [id])
  doctorId             String?
  doctor               Doctor?                @relation(fields: [doctorId], references: [id])
  
  coverageCase         Int?                   // 1, 2, or 3
  triageBand           String?                // 'critical', 'emergency', 'urgent', 'routine', 'non_urgent'
  isCritical           Boolean                @default(false)
  reporterRelationship String                 // 'me', 'child', 'other_adult'
  subjectAge           Int?
  subjectSex           String?
  identityMismatch     Boolean                @default(false)
  
  status               String                 // 'awaiting_consent', 'identifying', 'interviewing', 'confirming', 'queued', 'in_review', 'resolved'
  outcome              String?
  queuedAt             DateTime?
  
  messages             Message[]
  observations         Observation[]
  hmoVerification      EnrolleeVerification?
  auditLogs            AuditLog[]
}

model Message {
  id             String        @id @default(uuid())
  episodeId      String
  episode        Episode       @relation(fields: [episodeId], references: [id])
  direction      String        // 'inbound' | 'outbound'
  body           String
  waMessageId    String        @unique
  createdAt      DateTime      @default(now())
  observations   Observation[]
}

model Observation {
  id               String   @id @default(uuid())
  episodeId        String
  episode          Episode  @relation(fields: [episodeId], references: [id])
  sourceMessageId  String
  message          Message  @relation(fields: [sourceMessageId], references: [id])
  code             String
  value            String
  sourceQuote      String
}

model EnrolleeVerification {
  id                 String   @id @default(uuid())
  episodeId          String   @unique
  episode            Episode  @relation(fields: [episodeId], references: [id])
  hmoId              String
  hmo                HMO      @relation(fields: [hmoId], references: [id])
  valid              Boolean
  enrolleeId         String
  enrolleeName       String
  planTier           String?
  homeFacilityId     String?
  coverageStatus     String
  verificationMethod String   // 'api' | 'list' | 'manual'
}

model HMO {
  id             String                 @id @default(uuid())
  name           String
  defaultMethod  String
  verifications  EnrolleeVerification[]
}

model Consent {
  id         String   @id @default(uuid())
  contactId  String
  contact    Contact  @relation(fields: [contactId], references: [id])
  scope      String
  grantedAt  DateTime @default(now())
}

model AuditLog {
  id         String   @id @default(uuid())
  episodeId  String
  episode    Episode  @relation(fields: [episodeId], references: [id])
  doctorId   String?
  doctor     Doctor?  @relation(fields: [doctorId], references: [id])
  action     String
  reason     String?
  createdAt  DateTime @default(now())
}
```

---

## 5. Endpoints & Workflows

### 5.1 Webhook & Patient Intake
- **`POST /api/twilio/webhook`**: Receives all WhatsApp messages.
  1. Deduplicates by `waMessageId`.
  2. Runs **Red-Flag Check** (halts if critical).
  3. Checks `Consent`. If missing, asks for consent.
  4. Resolves Identity (Who-for: Me, Child, Other Adult).
  5. Requests Coverage (HMO ID, Hospital Card, None).
  6. Hands over to AI Interview Loop (Triage Core).
  7. On completion, validates AI structured JSON, saves `Observations` with `sourceQuote`, sets `triageBand`, and invokes Routing Engine.

### 5.2 HMO Adapter Pattern Interface
```typescript
interface StandardEnrollee {
  valid: boolean;
  enrolleeId: string;
  patientName: string;
  hmoName: string;
  planTier: string | 'unknown';
  homeFacilityId: string | null;
  coverageStatus: 'active' | 'lapsed' | 'unknown';
  verificationMethod: 'api' | 'list' | 'manual';
}

interface IHMOAdapter {
  verifyEnrollee(hmoId: string): Promise<StandardEnrollee>;
}
```

### 5.3 Doctor Dashboard & Queue
- **`GET /api/cases`**: Scope restricted to the logged-in doctor's `facilityId`. Cases ordered by `triageBand` (SATS) and `queuedAt` (descending).
- **`GET /api/cases/:id`**: Returns Episode details, Observations (traced), EnrolleeVerification, and raw Transcript.
- **`POST /api/cases/:id/override`**: Allows doctor to change the `triageBand`. Requires a `reason` payload, triggering an `AuditLog` entry.
- **`POST /api/cases/:id/reply`**: Sends the doctor's message to the patient via Twilio. Updates Episode `status` and `outcome`.

### 5.4 Access Control
- **MedLink Admin**: System-wide configuration. Creates Facility Admins.
- **Facility Admin**: Can create Doctors, upload HMO enrollee lists, and view aggregate stats. Cannot read specific clinical reports unless treating the case.
- **Doctor**: Must have valid `mdcnLicense`. Can only access their facility's cases. Forces password reset on first login.

---

## 6. Escalation & Safety Nets
- **Escalation Worker**: A cron job/background worker that monitors the `Episode` table. If an `emergency` or `urgent` case waits beyond its threshold (`avgResponseMin` or SLA), it automatically escalates (e.g., SMS alerts to facility supervisor, automated WhatsApp message directing patient to go to ER immediately).

---

## 7. API Testing Guide (Thunder Client / Postman)

Here are ready-to-use payloads for testing the API endpoints locally on `http://localhost:6000`.

### 7.1 Authentication Endpoints

#### Register a Doctor
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/auth/register`
- **Body Type:** `Form/Multipart`
- **Fields:**
  - `email`: `doctor@medlink.com`
  - `password`: `password123`
  - `fullName`: `Dr. Jane Doe`
  - `role`: `doctor`
  - `facilityId`: `<uuid-of-facility>`
  - `mdcnLicense`: `[Attach a sample PDF or Image file]`

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/auth/register \
  -F "email=doctor@medlink.com" \
  -F "password=password123" \
  -F "fullName=Dr. Jane Doe" \
  -F "role=doctor" \
  -F "facilityId=<uuid-of-facility>" \
  -F "mdcnLicense=@/path/to/license.pdf"
```

#### Login
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/auth/login`
- **Body Type:** `JSON`
- **Payload:**
```json
{
  "email": "doctor@medlink.com",
  "password": "password123"
}
```

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@medlink.com","password":"password123"}'
```

#### Get Current User (Me)
- **Method:** `GET`
- **URL:** `http://localhost:6000/api/auth/me`
- **Headers:** 
  - `Authorization`: `Bearer <token_from_login_response>`

**cURL Equivalent:**
```bash
curl -X GET http://localhost:6000/api/auth/me \
  -H "Authorization: Bearer <token_from_login_response>"
```

#### Admin: Verify Doctor
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/auth/admin/verify`
- **Body Type:** `JSON`
- **Payload:**
```json
{
  "email": "doctor@medlink.com",
  "isVerified": true
}
```

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/auth/admin/verify \
  -H "Content-Type: application/json" \
  -d '{"email":"doctor@medlink.com","isVerified":true}'
```

#### Logout
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/auth/logout`
- **Headers:** 
  - `Authorization`: `Bearer <token>`

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/auth/logout \
  -H "Authorization: Bearer <token>"
```

### 7.2 Patient Interaction Endpoints

#### Twilio Webhook (Simulating a WhatsApp Message)
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/twilio/webhook`
- **Body Type:** `Form-encoded (application/x-www-form-urlencoded)`
- **Fields:**
  - `From`: `whatsapp:+1234567890`
  - `Body`: `Hello, I need to report some symptoms.`
  - `MessageSid`: `SM1234567890abcdef`

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/twilio/webhook \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=whatsapp:+1234567890" \
  -d "Body=Hello, I need to report some symptoms." \
  -d "MessageSid=SM1234567890abcdef"
```

#### Simulate Patient (JSON Webhook Alternative)
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/twilio/simulate-patient`
- **Body Type:** `JSON`
- **Payload:**
```json
{
  "patientPhone": "whatsapp:+1234567890",
  "message": "Yes, I consent to MedLink AI triage."
}
```

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/twilio/simulate-patient \
  -H "Content-Type: application/json" \
  -d '{"patientPhone":"whatsapp:+1234567890","message":"Yes, I consent to MedLink AI triage."}'
```

### 7.3 Doctor Dashboard Endpoints (Requires Bearer Token)

#### Ingest Pre-Triaged Case (Bulk Upload)
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/cases/ingest`
- **Headers:** 
  - `Authorization`: `Bearer <token>`
- **Body Type:** `JSON`
- **Payload:**
```json
{
  "patientPhone": "+234701xxxxxxx",
  "beneficiaryMode": "self",
  "coverageType": "hmo",
  "consentStatus": "accepted",
  "hmoNumber": "26264907",
  "hmoProvider": "unknown",
  "hmoVerification": {
    "provider": "unknown",
    "hmoNumber": "26264907",
    "verified": false,
    "verificationMode": "manual",
    "status": "manual_verification_required"
  },
  "urgencyBand": "routine",
  "triageStatus": "completed",
  "latestPatientMessage": "YES",
  "chatHistory": [ "Patient: Hi", "AI: Hello" ],
  "metadata": {
    "intent": "health_enquiry",
    "coverageCase": "case_1_hmo",
    "triageSummaryDraft": "..."
  }
}
```

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/cases/ingest \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"patientPhone":"+234701xxxxxxx","coverageType":"hmo","urgencyBand":"routine","latestPatientMessage":"YES","chatHistory":["Patient: Hi","AI: Hello"],"hmoVerification":{"verified":false,"hmoNumber":"26264907"}}'
```

#### Get Queue / Cases
- **Method:** `GET`
- **URL:** `http://localhost:6000/api/cases`
- **Headers:** 
  - `Authorization`: `Bearer <token>`

**cURL Equivalent:**
```bash
curl -X GET http://localhost:6000/api/cases \
  -H "Authorization: Bearer <token>"
```

#### Get Case Details
- **Method:** `GET`
- **URL:** `http://localhost:6000/api/cases/<episode_id>`
- **Headers:** 
  - `Authorization`: `Bearer <token>`

**cURL Equivalent:**
```bash
curl -X GET http://localhost:6000/api/cases/<episode_id> \
  -H "Authorization: Bearer <token>"
```

#### Reply to Case (Doctor to Patient)
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/cases/<episode_id>/reply`
- **Headers:** 
  - `Authorization`: `Bearer <token>`
- **Body Type:** `JSON`
- **Payload:**
```json
{
  "responseMessage": "Please come into the clinic immediately. We have prepared a bed for you.",
  "outcome": "needs_visit"
}
```

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/cases/<episode_id>/reply \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"responseMessage":"Please come into the clinic immediately. We have prepared a bed for you.","outcome":"needs_visit"}'
```

#### Override Triage Urgency Band
- **Method:** `POST`
- **URL:** `http://localhost:6000/api/cases/<episode_id>/override`
- **Headers:** 
  - `Authorization`: `Bearer <token>`
- **Body Type:** `JSON`
- **Payload:**
```json
{
  "urgencyBand": "critical",
  "reason": "Patient age and history indicate high risk of cardiac event."
}
```

**cURL Equivalent:**
```bash
curl -X POST http://localhost:6000/api/cases/<episode_id>/override \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"urgencyBand":"critical","reason":"Patient age and history indicate high risk of cardiac event."}'
```
