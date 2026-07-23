// Hand-authored OpenAPI 3.0 spec for the MedLink backend. Served as Swagger UI
// at /docs and as raw JSON at /openapi.json. Kept in sync with the routes and
// the frontend spec (frontend_technical_spec.md §12).

const caseExample = {
  id: '2581239e-0a1c-4e0b-9d2a-2f1e6c7b8a90',
  state: 'Queued',
  patientPhone: 'whatsapp:+2348123456789',
  subject: { reporterRelationship: 'self', age: 35, sex: 'male', identityMismatch: false },
  primaryComplaint: 'stomach cramps',
  triageBand: 'urgent',
  isCritical: false,
  redFlagTriggered: '',
  coverage: { coverageCase: 3, coverageType: 'none', verification: null },
  facilityId: 'bfb521d1-4a0c-4313-be34-e99fee52f49d',
  doctorId: null,
  outcome: null,
  queuedAt: '2026-07-22T20:39:00.000Z',
  report: [
    {
      code: 'duration',
      value: 'approximately 2 days, intermittent',
      sourceQuote: 'it started about 2 days ago and comes and goes',
      sourceMessageId: 'a1b2c3d4-0000-0000-0000-000000000001'
    }
  ],
  transcript: [
    { direction: 'inbound', body: 'Hello', at: '2026-07-22T20:35:00.000Z' },
    { direction: 'outbound', body: 'Welcome to MedLink...', at: '2026-07-22T20:35:01.000Z' }
  ],
  media: [
    {
      id: 'm1a2b3c4-0000-0000-0000-000000000001',
      kind: 'document',
      mimeType: 'application/pdf',
      sizeBytes: 84210,
      analysis: 'Lab report: WBC 14.2 (high), CRP 48 mg/L (high); other values within range.',
      at: '2026-07-22T20:37:00.000Z',
      url: '/api/cases/2581239e-0a1c-4e0b-9d2a-2f1e6c7b8a90/media/m1a2b3c4-0000-0000-0000-000000000001'
    }
  ],
  auditTrail: [
    { action: 'band_assigned', reason: 'SATS urgent discriminator: "cramp"', doctorId: null, at: '2026-07-22T20:39:00.000Z' }
  ],
  createdAt: '2026-07-22T20:35:00.000Z',
  updatedAt: '2026-07-22T20:39:00.000Z'
};

const doctorExample = {
  id: 'd0c70000-0000-0000-0000-000000000001',
  email: 'drkemi@clinic.test',
  fullName: 'Dr Kemi',
  medicalCredentials: 'MDCN 12345',
  facilityId: 'bfb521d1-4a0c-4313-be34-e99fee52f49d',
  role: 'doctor',
  mdcnLicense: '12345',
  mustResetPassword: false,
  isVerified: true,
  isActive: true,
  createdAt: '2026-07-22T09:00:00.000Z'
};

const openapiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'MedLink AI — Backend API',
    version: '1.0.0',
    description:
      'Payment-blind WhatsApp triage backend. Patients interact over WhatsApp (no account); ' +
      'facility staff use these endpoints. Auth is a JWT bearer token (or the `auth_token` ' +
      'httpOnly cookie the server sets at login). All bodies are JSON unless noted.'
  },
  servers: [
    { url: 'https://medlink-backend-capn.onrender.com', description: 'Render (production)' },
    { url: 'http://localhost:7100', description: 'Local dev' }
  ],
  tags: [
    { name: 'Auth', description: 'Login, first-login reset, session' },
    { name: 'Cases', description: 'Doctor triage queue & actions (facility-scoped)' },
    { name: 'Facilities', description: 'Facility admin: doctors, enrollees, stats' },
    { name: 'Intake', description: 'WhatsApp webhook & patient simulator' },
    { name: 'System', description: 'Health' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string' }, message: { type: 'string' } },
        example: { error: 'unauthorized', message: 'Invalid or expired session token' }
      },
      DoctorResponse: { type: 'object', example: doctorExample },
      LoginResponse: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          sessionToken: { type: 'string' },
          mustResetPassword: { type: 'boolean' },
          resetToken: { type: 'string' },
          doctor: { $ref: '#/components/schemas/DoctorResponse' }
        }
      },
      Case: {
        type: 'object',
        description: 'Assembled case (same shape from queue and detail).',
        example: caseExample
      },
      QueueResponse: {
        type: 'object',
        properties: {
          count: { type: 'integer' },
          cases: { type: 'array', items: { $ref: '#/components/schemas/Case' } }
        },
        example: { count: 1, cases: [caseExample] }
      }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { example: { status: 'ok', service: 'MedLink Backend API' } } }
          }
        }
      }
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Bootstrap the first MedLink admin (only works when no accounts exist)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              example: { email: 'root@medlink.test', password: 'rootpass123', fullName: 'Root Admin' }
            }
          }
        },
        responses: {
          '201': { description: 'Root admin created', content: { 'application/json': { example: { message: 'Root MedLink admin created.', doctor: doctorExample, role: 'medlink_admin' } } } },
          '403': { description: 'Self-registration disabled (an account already exists)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in with email + password',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { email: 'drkemi@clinic.test', password: 'doctorpass123' } } }
        },
        responses: {
          '200': {
            description: 'Logged in, or reset required',
            content: {
              'application/json': {
                examples: {
                  loggedIn: { summary: 'Normal login', value: { message: 'Login successful', sessionToken: 'eyJhbGciOi...', doctor: doctorExample } },
                  resetRequired: { summary: 'First login — reset required', value: { message: 'Password reset required before first use.', mustResetPassword: true, resetToken: 'eyJhbGciOi...', doctor: { ...doctorExample, mustResetPassword: true } } }
                }
              }
            }
          },
          '401': { description: 'Bad credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '403': { description: 'Account unverified or deactivated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/auth/first-login-reset': {
      post: {
        tags: ['Auth'],
        summary: 'Complete forced first-login password reset',
        security: [],
        requestBody: {
          required: true,
          content: { 'application/json': { example: { email: 'drkemi@clinic.test', currentPassword: 'temp123456', newPassword: 'doctorpass123' } } }
        },
        responses: {
          '200': { description: 'Reset complete, logged in', content: { 'application/json': { example: { message: 'Password reset successful. You are now logged in.', sessionToken: 'eyJhbGciOi...' } } } },
          '401': { description: 'Bad current credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current doctor',
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { doctor: doctorExample } } } }, '401': { description: 'Unauthorized' } }
      }
    },
    '/api/auth/logout': {
      post: { tags: ['Auth'], summary: 'Log out (revokes the token)', responses: { '200': { description: 'OK', content: { 'application/json': { example: { message: 'Logged out successfully' } } } } } }
    },
    '/api/cases': {
      get: {
        tags: ['Cases'],
        summary: 'Facility-scoped triage queue (band, then longest wait; critical first)',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['Queued', 'Critical', 'InReview', 'Resolved', 'Confirming', 'Interviewing', 'Identifying', 'AwaitingConsent', 'Declined', 'Abandoned'] }, description: 'Filter to a single state' },
          { name: 'urgency', in: 'query', schema: { type: 'string', enum: ['emergency', 'urgent', 'routine', 'non_urgent'] }, description: 'Filter to a single band' }
        ],
        responses: { '200': { description: 'Queue', content: { 'application/json': { schema: { $ref: '#/components/schemas/QueueResponse' } } } }, '401': { description: 'Unauthorized' } }
      }
    },
    '/api/cases/{id}': {
      get: {
        tags: ['Cases'],
        summary: 'Case detail (report + transcript + audit embedded)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Case', content: { 'application/json': { example: { case: caseExample } } } },
          '403': { description: "Another facility's case, or admin who isn't the treating clinician", content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          '404': { description: 'Not found' }
        }
      }
    },
    '/api/cases/{id}/media/{mediaId}': {
      get: {
        tags: ['Cases'],
        summary: 'Stream a patient-sent media asset (photo, PDF result, voice note, video)',
        description: 'Returns the raw bytes with the original Content-Type. Facility-scoped via the parent case. IDs come from the case `media[]` array.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'mediaId', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Media bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } }, 'image/*': {}, 'application/pdf': {} } },
          '403': { description: "Another facility's case" },
          '404': { description: 'Media not found for this case' }
        }
      }
    },
    '/api/cases/{id}/claim': {
      post: {
        tags: ['Cases'],
        summary: 'Open/assign a case (Queued → InReview)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Claimed', content: { 'application/json': { example: { message: 'Case claimed and marked in review', caseId: caseExample.id } } } } }
      }
    },
    '/api/cases/{id}/override': {
      post: {
        tags: ['Cases'],
        summary: 'Override triage band (reason required; audited)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { example: { urgencyBand: 'emergency', reason: 'Persistent pain plus dehydration warrants urgent review' } } } },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { example: { message: 'Triage band updated', caseId: caseExample.id, oldBand: 'urgent', newBand: 'emergency' } } } },
          '400': { description: 'Unknown band or missing reason', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/cases/{id}/reply': {
      post: {
        tags: ['Cases'],
        summary: 'Reply to patient WhatsApp AND resolve with an outcome',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { example: { responseMessage: 'Please start oral rehydration and monitor for 24h. Come in if pain worsens.', outcome: 'needs_visit' } } } },
        responses: {
          '200': { description: 'Delivered + resolved', content: { 'application/json': { example: { message: 'Doctor reply delivered to patient WhatsApp thread', case: { ...caseExample, state: 'Resolved', outcome: 'needs_visit' } } } } },
          '400': { description: 'Empty message or invalid outcome' },
          '502': { description: 'WhatsApp delivery failed', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
        }
      }
    },
    '/api/facilities': {
      post: {
        tags: ['Facilities'],
        summary: 'Create a facility + its facility-admin (medlink_admin only)',
        requestBody: { required: true, content: { 'application/json': { example: { name: 'Test Clinic', type: 'clinic', location: 'Abuja', adminEmail: 'facadmin@clinic.test', adminFullName: 'Facility Admin', adminTempPassword: 'temp123456' } } } },
        responses: { '201': { description: 'Created', content: { 'application/json': { example: { message: 'Facility created with a facility-admin account. Admin must reset password on first login.', facility: { id: caseExample.facilityId, name: 'Test Clinic', type: 'clinic' }, facilityAdmin: { ...doctorExample, role: 'facility_admin', mustResetPassword: true } } } } } }
      }
    },
    '/api/facilities/{facilityId}/doctors': {
      post: {
        tags: ['Facilities'],
        summary: 'Enroll a doctor (facility_admin or medlink_admin)',
        parameters: [{ name: 'facilityId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { example: { email: 'drtunde@clinic.test', fullName: 'Dr Tunde', mdcnLicense: 'MDCN-67890', tempPassword: 'temp123456' } } } },
        responses: { '201': { description: 'Enrolled', content: { 'application/json': { example: { message: 'Doctor enrolled. They must reset their password on first login.', doctor: { ...doctorExample, mustResetPassword: true } } } } }, '409': { description: 'Email taken' } }
      },
      get: {
        tags: ['Facilities'],
        summary: 'List facility doctors',
        parameters: [{ name: 'facilityId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { count: 1, doctors: [doctorExample] } } } } }
      }
    },
    '/api/facilities/{facilityId}/enrollees': {
      post: {
        tags: ['Facilities'],
        summary: 'Upload HMO/enrollee list (JSON, not CSV)',
        parameters: [{ name: 'facilityId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { required: true, content: { 'application/json': { example: { enrollees: [{ enrolleeId: 'HMO-1001', patientName: 'Amaka Eze', hmoName: 'Reliance', planTier: 'gold', coverageStatus: 'active' }] } } } },
        responses: { '200': { description: 'Uploaded', content: { 'application/json': { example: { message: 'Enrollee list uploaded', count: 1 } } } } }
      }
    },
    '/api/facilities/{facilityId}/stats': {
      get: {
        tags: ['Facilities'],
        summary: 'Aggregate stats (no clinical detail)',
        parameters: [{ name: 'facilityId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK', content: { 'application/json': { example: { facilityId: caseExample.facilityId, totalEpisodes: 12, byBand: { emergency: 2, urgent: 4, routine: 6 }, byState: { Queued: 3, Resolved: 9 } } } } } }
      }
    },
    '/api/twilio/webhook': {
      post: {
        tags: ['Intake'],
        summary: 'Twilio WhatsApp inbound webhook (signature-verified; text + media)',
        security: [],
        requestBody: { content: { 'application/x-www-form-urlencoded': { example: { From: 'whatsapp:+2348123456789', Body: 'Hello, I have a headache', MessageSid: 'SM123', NumMedia: '0' } } } },
        responses: { '200': { description: 'TwiML reply', content: { 'application/xml': { example: '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Welcome to MedLink...</Message></Response>' } } }, '403': { description: 'Invalid signature' } }
      }
    },
    '/api/twilio/simulate-patient': {
      post: {
        tags: ['Intake'],
        summary: 'Dev-only patient simulator (drives the real pipeline; supports media)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              examples: {
                text: { summary: 'Text message', value: { patientPhone: 'whatsapp:+2348123456789', message: 'Hello' } },
                media: { summary: 'With media (base64) — image/video/audio/pdf', value: { patientPhone: 'whatsapp:+2348123456789', message: 'here is a photo of my rash', media: [{ mimeType: 'image/jpeg', dataBase64: '<base64 bytes>' }] } }
              }
            }
          }
        },
        responses: { '200': { description: 'Reply + assembled episode', content: { 'application/json': { example: { patientPhone: 'whatsapp:+2348123456789', userMessage: 'Hello', aiReply: 'Welcome to MedLink...', episode: caseExample } } } } }
      }
    }
  }
} as const;

export default openapiSpec;
