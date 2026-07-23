const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'MedLink Backend API',
    version: '1.0.0',
    description:
      'Detailed OpenAPI documentation for MedLink doctor authentication, triage case management, and Twilio WhatsApp intake endpoints.'
  },
  servers: [
    {
      url: '/',
      description: 'Current server origin'
    }
  ],
  tags: [
    { name: 'System', description: 'System and health endpoints' },
    { name: 'Auth', description: 'Doctor authentication and session management' },
    { name: 'Twilio', description: 'Twilio inbound webhook and simulation APIs' },
    { name: 'Cases', description: 'Doctor triage queue and case handling APIs' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Paste the sessionToken from login response'
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'auth_token',
        description: 'HTTP-only cookie returned by POST /api/auth/login'
      }
    },
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'bad_request' },
          message: { type: 'string', example: 'Invalid request payload' }
        },
        required: ['error', 'message']
      },
      DoctorProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', example: 'b18b4e72-2d8c-4a37-b9c1-8408cf59623e' },
          email: { type: 'string', format: 'email', example: 'dr.sarah@hospital.org' },
          fullName: { type: 'string', example: 'Dr. Sarah Jenkins' },
          mdcnLicense: { type: 'string', example: 'MD987654' },
          isVerified: { type: 'boolean', example: true },
          isActive: { type: 'boolean', example: true },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'email', 'fullName', 'isVerified', 'isActive', 'createdAt']
      },
      RegisterRequestJson: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          fullName: { type: 'string', minLength: 1 },
          mdcnLicense: { type: 'string', description: 'MDCN license string value' }
        },
        required: ['email', 'password', 'fullName']
      },
      RegisterRequestMultipart: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 6 },
          fullName: { type: 'string', minLength: 1 },
          mdcnLicense: {
            type: 'string',
            format: 'binary',
            description: 'Optional license file upload (accepted by route middleware)'
          }
        },
        required: ['email', 'password', 'fullName']
      },
      RegisterSuccessResponse: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'Registration successful. Your account is pending manual verification.'
          },
          doctor: { $ref: '#/components/schemas/DoctorProfile' },
          step: { type: 'string', example: 'manual_verification_pending' }
        },
        required: ['message', 'doctor', 'step']
      },
      LoginRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 }
        },
        required: ['email', 'password']
      },
      LoginSuccessResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Login successful' },
          sessionToken: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
          },
          doctor: { $ref: '#/components/schemas/DoctorProfile' }
        },
        required: ['message', 'sessionToken', 'doctor']
      },
      VerifyDoctorRequest: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          isVerified: { type: 'boolean', example: true }
        },
        required: ['email']
      },
      VerifyDoctorResponse: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'Doctor dr.sarah@hospital.org verification status updated to true'
          },
          email: { type: 'string', format: 'email' },
          isVerified: { type: 'boolean', example: true }
        },
        required: ['message', 'email', 'isVerified']
      },
      MeResponse: {
        type: 'object',
        properties: {
          doctor: { $ref: '#/components/schemas/DoctorProfile' }
        },
        required: ['doctor']
      },
      LogoutResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Logged out successfully' }
        },
        required: ['message']
      },
      SimulatePatientRequest: {
        type: 'object',
        properties: {
          patientPhone: { type: 'string', example: 'whatsapp:+2348123456789' },
          message: {
            type: 'string',
            example: 'My name is John Doe, I am 35 years old male. I have stomach cramps for 2 days.'
          }
        },
        required: ['patientPhone', 'message']
      },
      SimulatePatientResponse: {
        type: 'object',
        properties: {
          reply: {
            type: 'string',
            example: 'Thank you. Do you have an HMO number or a Hospital Card?'
          }
        },
        required: ['reply']
      },
      CaseSummary: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          patientPhone: { type: 'string', example: 'whatsapp:+2348123456789' },
          patientName: { type: 'string', example: 'John Doe' },
          patientGender: { type: 'string', example: 'Male' },
          patientAge: { type: 'string', example: '35 years' },
          primaryComplaint: { type: 'string', example: 'stomach cramps for 2 days' },
          urgencyBand: {
            type: 'string',
            enum: ['critical', 'emergency', 'urgent', 'routine', 'non_urgent']
          },
          redFlagTriggered: { type: 'string', example: 'Red Flag matched' },
          status: { type: 'string', example: 'queued' },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'patientPhone', 'patientName', 'urgencyBand', 'status', 'createdAt']
      },
      CasesListResponse: {
        type: 'object',
        properties: {
          count: { type: 'integer', example: 2 },
          cases: {
            type: 'array',
            items: { $ref: '#/components/schemas/CaseSummary' }
          }
        },
        required: ['count', 'cases']
      },
      CaseObservation: {
        type: 'object',
        properties: {
          code: { type: 'string', example: 'COMPLAINT' },
          value: { type: 'string', example: 'stomach cramps for 2 days' },
          sourceQuote: { type: 'string', example: 'I have stomach cramps for 2 days' }
        }
      },
      TranscriptMessage: {
        type: 'object',
        properties: {
          sender: { type: 'string', enum: ['patient', 'ai'] },
          message: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' }
        },
        required: ['sender', 'message', 'timestamp']
      },
      CaseDetail: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          patientPhone: { type: 'string' },
          patientName: { type: 'string' },
          urgencyBand: {
            type: 'string',
            enum: ['critical', 'emergency', 'urgent', 'routine', 'non_urgent']
          },
          isCritical: { type: 'boolean' },
          identityMismatch: { type: 'boolean', nullable: true },
          observations: {
            type: 'array',
            items: { $ref: '#/components/schemas/CaseObservation' }
          },
          hmoVerification: {
            type: 'object',
            nullable: true,
            additionalProperties: true
          },
          rawTranscript: {
            type: 'array',
            items: { $ref: '#/components/schemas/TranscriptMessage' }
          },
          status: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' }
        },
        required: ['id', 'patientPhone', 'patientName', 'urgencyBand', 'status', 'createdAt']
      },
      CaseDetailResponse: {
        type: 'object',
        properties: {
          case: { $ref: '#/components/schemas/CaseDetail' }
        },
        required: ['case']
      },
      OverrideUrgencyRequest: {
        type: 'object',
        properties: {
          urgencyBand: {
            type: 'string',
            enum: ['critical', 'emergency', 'urgent', 'routine', 'non_urgent']
          },
          reason: {
            type: 'string',
            minLength: 1,
            example: 'Vitals indicate severe deterioration'
          }
        },
        required: ['urgencyBand', 'reason']
      },
      OverrideUrgencyResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Case urgency band updated successfully' },
          caseId: { type: 'string', format: 'uuid' },
          oldUrgency: { type: 'string' },
          newUrgency: { type: 'string' }
        },
        required: ['message', 'caseId', 'oldUrgency', 'newUrgency']
      },
      ReplyToCaseRequest: {
        type: 'object',
        properties: {
          responseMessage: {
            type: 'string',
            minLength: 1,
            example: 'Please report to the nearest emergency room immediately.'
          },
          outcome: {
            type: 'string',
            enum: ['resolved', 'needs_visit', 'pending_followup']
          }
        },
        required: ['responseMessage', 'outcome']
      },
      ReplyToCaseResponse: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            example: 'Doctor reply delivered to patient WhatsApp thread via Twilio'
          },
          case: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              status: { type: 'string' },
              doctorReply: { type: 'string' },
              doctorOutcome: { type: 'string' },
              assignedDoctorId: { type: 'string', format: 'uuid', nullable: true }
            },
            required: ['id', 'status', 'doctorReply', 'doctorOutcome']
          }
        },
        required: ['message', 'case']
      },
      IngestCaseRequest: {
        type: 'object',
        properties: {
          patientPhone: { type: 'string', example: 'whatsapp:+2348123456789' },
          urgencyBand: {
            type: 'string',
            enum: ['critical', 'emergency', 'urgent', 'routine', 'non_urgent'],
            default: 'routine'
          },
          coverageType: {
            type: 'string',
            enum: ['hmo', 'card', 'none'],
            description: 'Mapped internally to numeric coverageCase'
          },
          chatHistory: {
            type: 'array',
            items: {
              oneOf: [{ type: 'string' }, { type: 'object', additionalProperties: true }]
            }
          },
          latestPatientMessage: { type: 'string' },
          hmoVerification: {
            type: 'object',
            properties: {
              verified: { type: 'boolean' },
              hmoNumber: { type: 'string' },
              status: { type: 'string', example: 'active' },
              verificationMode: { type: 'string', example: 'manual' }
            }
          }
        },
        required: ['patientPhone']
      },
      IngestCaseResponse: {
        type: 'object',
        properties: {
          message: { type: 'string', example: 'Case ingested successfully' },
          episodeId: { type: 'string', format: 'uuid' }
        },
        required: ['message', 'episodeId']
      }
    }
  },
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        description: 'Returns backend service health status.',
        operationId: 'getHealth',
        responses: {
          200: {
            description: 'Service is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ok' },
                    service: { type: 'string', example: 'MedLink Backend API' }
                  },
                  required: ['status', 'service']
                }
              }
            }
          }
        }
      }
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register doctor account',
        description:
          'Creates a doctor account pending manual verification. Accepts either JSON payload or multipart form data. Multipart file upload is accepted on mdcnLicense field by route middleware.',
        operationId: 'registerDoctor',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RegisterRequestJson' }
            },
            'multipart/form-data': {
              schema: { $ref: '#/components/schemas/RegisterRequestMultipart' }
            }
          }
        },
        responses: {
          201: {
            description: 'Registration created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/RegisterSuccessResponse' }
              }
            }
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          409: {
            description: 'Email already registered',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Doctor login',
        description:
          'Authenticates doctor credentials. Requires doctor to be manually verified before token issuance. Returns a session token and sets auth_token cookie.',
        operationId: 'loginDoctor',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Login successful',
            headers: {
              'Set-Cookie': {
                description: 'HTTP-only auth_token cookie',
                schema: { type: 'string' }
              }
            },
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LoginSuccessResponse' }
              }
            }
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          401: {
            description: 'Invalid email or password',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          403: {
            description: 'Doctor account is not verified',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/ErrorResponse' },
                    {
                      type: 'object',
                      properties: {
                        isVerified: { type: 'boolean', example: false }
                      },
                      required: ['isVerified']
                    }
                  ]
                }
              }
            }
          }
        }
      }
    },
    '/api/auth/admin/verify': {
      post: {
        tags: ['Auth'],
        summary: 'Admin doctor verification toggle',
        description:
          'Hackathon helper endpoint for toggling doctor verification status.',
        operationId: 'verifyDoctor',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/VerifyDoctorRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Verification status updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/VerifyDoctorResponse' }
              }
            }
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Get authenticated doctor session profile',
        description:
          'Returns doctor profile for the current authenticated session. Accepts auth token via cookie or bearer token.',
        operationId: 'getCurrentDoctor',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: {
            description: 'Authenticated doctor profile',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MeResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout doctor session',
        description:
          'Revokes current session token and clears auth_token cookie.',
        operationId: 'logoutDoctor',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        responses: {
          200: {
            description: 'Logout successful',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/LogoutResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/twilio/webhook': {
      post: {
        tags: ['Twilio'],
        summary: 'Inbound Twilio WhatsApp webhook',
        description:
          'Processes incoming WhatsApp messages from Twilio, updates patient episode state, and returns TwiML XML response.',
        operationId: 'twilioWebhook',
        requestBody: {
          required: true,
          content: {
            'application/x-www-form-urlencoded': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    required: ['From', 'Body'],
                    properties: {
                      From: { type: 'string', example: 'whatsapp:+2348123456789' },
                      Body: { type: 'string', example: 'I have severe chest pain' },
                      MessageSid: { type: 'string', example: 'SM123' },
                      SmsMessageSid: { type: 'string', example: 'SM123' }
                    }
                  },
                  {
                    type: 'object',
                    required: ['from', 'body'],
                    properties: {
                      from: { type: 'string', example: 'whatsapp:+2348123456789' },
                      body: { type: 'string', example: 'I have severe chest pain' },
                      MessageSid: { type: 'string', example: 'SM123' },
                      SmsMessageSid: { type: 'string', example: 'SM123' }
                    }
                  }
                ]
              }
            }
          }
        },
        responses: {
          200: {
            description: 'TwiML response containing AI reply',
            content: {
              'application/xml': {
                schema: {
                  type: 'string',
                  example:
                    '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thank you for your consent. Who are you reporting these symptoms for?</Message></Response>'
                }
              }
            }
          },
          400: {
            description: 'Missing sender or message field (From/from and Body/body)',
            content: {
              'text/plain': {
                schema: { type: 'string', example: 'Missing From or Body form field' }
              }
            }
          }
        }
      }
    },
    '/api/twilio/simulate-patient': {
      post: {
        tags: ['Twilio'],
        summary: 'Simulate patient message',
        description:
          'Testing endpoint to run patient intake flow without a live Twilio webhook.',
        operationId: 'simulatePatient',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/SimulatePatientRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Simulation reply returned',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/SimulatePatientResponse' }
              }
            }
          },
          400: {
            description: 'Missing patientPhone or message',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/cases': {
      get: {
        tags: ['Cases'],
        summary: 'List triage cases for authenticated doctor facility',
        description:
          'Returns triage queue scoped to the authenticated doctor facility. Optional status and urgency filters are supported.',
        operationId: 'listCases',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string' },
            description: 'Filter cases by status'
          },
          {
            name: 'urgency',
            in: 'query',
            required: false,
            schema: {
              type: 'string',
              enum: ['critical', 'emergency', 'urgent', 'routine', 'non_urgent']
            },
            description: 'Filter by triage urgency band'
          }
        ],
        responses: {
          200: {
            description: 'Case list retrieved',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CasesListResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/cases/ingest': {
      post: {
        tags: ['Cases'],
        summary: 'Ingest pre-triaged case',
        description:
          'Creates a queued case directly for dashboard workflows and test imports.',
        operationId: 'ingestCase',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/IngestCaseRequest' }
            }
          }
        },
        responses: {
          201: {
            description: 'Case ingested successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IngestCaseResponse' }
              }
            }
          },
          400: {
            description: 'Missing patientPhone',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/cases/{id}': {
      get: {
        tags: ['Cases'],
        summary: 'Get case details by id',
        description:
          'Returns detailed case payload including observations, HMO verification, and transcript.',
        operationId: 'getCaseById',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Episode id'
          }
        ],
        responses: {
          200: {
            description: 'Case details retrieved',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/CaseDetailResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          404: {
            description: 'Case not found or unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/cases/{id}/override': {
      post: {
        tags: ['Cases'],
        summary: 'Override case urgency band',
        description:
          'Allows doctor to manually override triage urgency while writing an audit reason.',
        operationId: 'overrideCaseUrgency',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Episode id'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/OverrideUrgencyRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Urgency updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/OverrideUrgencyResponse' }
              }
            }
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          404: {
            description: 'Case not found or unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    },
    '/api/cases/{id}/reply': {
      post: {
        tags: ['Cases'],
        summary: 'Reply to case via WhatsApp and update outcome',
        description:
          'Sends doctor response to patient via Twilio, appends transcript message, updates case status/outcome, and records audit log.',
        operationId: 'replyToCase',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: 'Episode id'
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReplyToCaseRequest' }
            }
          }
        },
        responses: {
          200: {
            description: 'Reply delivered and case updated',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ReplyToCaseResponse' }
              }
            }
          },
          400: {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          401: {
            description: 'Missing, invalid, expired, or revoked token',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          404: {
            description: 'Case not found or unauthorized',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          },
          500: {
            description: 'Twilio delivery failure',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' }
              }
            }
          }
        }
      }
    }
  }
} as const;

export default openApiSpec;
