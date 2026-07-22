# MedLink AI WhatsApp Triage & Doctor Auth Backend

A minimalistic, high-performance Go backend API for MedLink (Hackathon Edition).

Built using **Go 1.25**, **Gin Framework**, **Twilio WhatsApp Webhook**, **Deterministic Red Flag Safety Engine**, **AI Patient Intake**, **PostgreSQL** (with zero-config fallback to Hackathon In-Memory store), **JWT Authentication**, and **Bcrypt**.

---

## 🚀 Quick Start

### 1. Run Backend Server
```bash
go run main.go
```
The server will start on `http://localhost:8080`.

---

## 📱 Twilio & Patient Intake Endpoints

### 1. Twilio Inbound WhatsApp Webhook
**`POST /api/twilio/webhook`**  
Twilio calls this webhook when a patient sends a WhatsApp message.

**Content-Type**: `application/x-www-form-urlencoded`  
**Body Parameters**:
- `From`: `whatsapp:+2348123456789`
- `Body`: `"Hello, my name is John. I have stomach pain for 2 days."`

**Response (`200 OK` - TwiML XML)**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Thank you, John. Could you please share your age and gender?</Message>
</Response>
```

---

### 2. Patient Intake Simulator (Hackathon Demo Helper)
**`POST /api/twilio/simulate-patient`**  
Allows testing patient chat flow without configuring live Twilio webhooks.

**Payload**:
```json
{
  "patientPhone": "whatsapp:+2348123456789",
  "message": "My name is John Doe, I am 35 years old male. I have severe stomach cramps for 2 days."
}
```

---

## 🩺 Doctor Dashboard Triage Queue Endpoints (For Maaz)

All case endpoints require a valid Doctor Session token via **Cookie `auth_token`** or **Header: `Authorization: Bearer <token>`**.

### 1. Get Prioritized Triage Queue
**`GET /api/cases`**  
Returns queue sorted by Urgency Band (`critical` > `emergency` > `urgent` > `routine` > `non_urgent`), then by waiting time (oldest first).

**Query Filters**: `?status=queued` or `?urgency=critical`

**Response (`200 OK`)**:
```json
{
  "count": 2,
  "cases": [
    {
      "id": "c1f7a228-54c3-4d82-b88e-6447c293ba20",
      "patientPhone": "whatsapp:+2348999999999",
      "patientName": "Emergency Patient",
      "urgencyBand": "critical",
      "redFlagTriggered": "Chest pain with cardiac warning signs",
      "status": "queued",
      "createdAt": "2026-07-21T23:20:00Z"
    },
    {
      "id": "a9b1c2d3-1234-5678-90ab-cdef12345678",
      "patientPhone": "whatsapp:+2348123456789",
      "patientName": "John Doe",
      "patientAge": "35 years",
      "patientGender": "Male",
      "primaryComplaint": "stomach cramps for 2 days",
      "urgencyBand": "urgent",
      "status": "queued",
      "createdAt": "2026-07-21T23:18:00Z"
    }
  ]
}
```

---

### 2. Get Single Case Details & Full Transcript
**`GET /api/cases/:id`**

**Response (`200 OK`)**:
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
        "timestamp": "2026-07-21T23:20:00Z"
      },
      {
        "sender": "ai",
        "message": "⚠️ URGENT MEDICAL WARNING: Your reported symptoms indicate a potentially serious critical condition...",
        "timestamp": "2026-07-21T23:20:01Z"
      }
    ],
    "status": "queued"
  }
}
```

---

### 3. Doctor Override Urgency Band
**`POST /api/cases/:id/override`**

**Payload**:
```json
{
  "urgencyBand": "emergency",
  "reason": "Vitals entry indicates severe hypertension"
}
```

---

### 4. Reply to Patient via Twilio WhatsApp
**`POST /api/cases/:id/reply`**  
Sends the doctor's instructions directly to the patient's WhatsApp thread via Twilio and updates case status.

**Payload**:
```json
{
  "responseMessage": "Please report to St. Jude Emergency Room immediately. An ambulance team has been notified.",
  "outcome": "needs_visit"
}
```

**Response (`200 OK`)**:
```json
{
  "message": "Doctor reply delivered to patient WhatsApp thread via Twilio",
  "case": {
    "id": "c1f7a228-54c3-4d82-b88e-6447c293ba20",
    "status": "needs_visit",
    "doctorReply": "Please report to St. Jude Emergency Room immediately...",
    "doctorOutcome": "needs_visit"
  }
}
```

---

## 🔒 Doctor Auth Endpoints

- `POST /api/auth/register` (Account creation)
- `POST /api/auth/login` (Dashboard login - checks `is_verified` flag)
- `GET /api/auth/me` (Session validation)
- `POST /api/auth/logout` (Logout session)
- `POST /api/auth/admin/verify` (Demo verification toggle)

---

## 🧪 Run Automated Integration Tests

```bash
go test -v ./...
```
