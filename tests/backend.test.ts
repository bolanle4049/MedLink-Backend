import assert from 'node:assert';
import { before, describe, it } from 'node:test';
import { app, startServer } from '../src/index';

let server: any;
let baseUrl: string;

describe('MedLink Backend API Complete Suite', () => {
  before(async () => {
    process.env.NODE_ENV = 'test';
    server = await startServer();
    const address: any = server.address();
    baseUrl = `http://localhost:${address.port}`;
  });

  const testEmail = 'dr.johnson@medlink.org';
  const testPassword = 'SuperSecret123!';
  const testFullName = 'Dr. Alex Johnson';
  const testCreds = 'MD - Cardiology, License #CARD-998877';

  let sessionToken = '';
  let authCookieHeader = '';
  let criticalCaseId = '';

  it('1. Register Doctor (Creates Unverified Account)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        fullName: testFullName,
        medicalCredentials: testCreds
      })
    });

    assert.strictEqual(res.status, 201);
    const data: any = await res.json();
    assert.strictEqual(data.step, 'manual_verification_pending');
    assert.strictEqual(data.doctor.isVerified, false);
  });

  it('2. Register Duplicate Email (Must Fail 409)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        fullName: testFullName,
        medicalCredentials: testCreds
      })
    });

    assert.strictEqual(res.status, 409);
    const data: any = await res.json();
    assert.strictEqual(data.error, 'registration_failed');
  });

  it('3. Login Wrong Password (Must Fail 401)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'WrongPassword123!'
      })
    });

    assert.strictEqual(res.status, 401);
  });

  it('4. Login Unverified Doctor (Must Fail 403)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword
      })
    });

    assert.strictEqual(res.status, 403);
    const data: any = await res.json();
    assert.strictEqual(data.error, 'account_unverified');
  });

  it('5. Admin Verify Doctor Account', async () => {
    const res = await fetch(`${baseUrl}/api/auth/admin/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        isVerified: true
      })
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.isVerified, true);
  });

  it('6. Login Verified Doctor (Must Succeed 200 + JWT + Cookie)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword
      })
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.ok(data.sessionToken);
    sessionToken = data.sessionToken;

    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie?.includes('auth_token='));
    authCookieHeader = cookie || '';
  });

  it('7. Session Validation via Authorization Bearer Header', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.doctor.email, testEmail);
  });

  it('8. Session Validation via HTTP-Only Cookie', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Cookie': authCookieHeader
      }
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.doctor.email, testEmail);
  });

  it('9. Patient Red Flag Emergency Intake (Triggers critical urgency)', async () => {
    const res = await fetch(`${baseUrl}/api/twilio/simulate-patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientPhone: 'whatsapp:+2348999999999',
        message: 'Help! I have severe chest pain and sweating profusely!'
      })
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.case.urgencyBand, 'critical');
    assert.strictEqual(data.case.status, 'queued');
  });

  it('10. Patient Routine Intake', async () => {
    const res = await fetch(`${baseUrl}/api/twilio/simulate-patient`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientPhone: 'whatsapp:+2348123456789',
        message: 'My name is John Doe, I am 35 years old male. I have stomach cramps for 2 days.'
      })
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.ok(data.aiReply);
  });

  it('11. Doctor Dashboard Queue Ordering (Critical first)', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.ok(data.cases.length >= 2);
    assert.strictEqual(data.cases[0].urgencyBand, 'critical');
    criticalCaseId = data.cases[0].id;
  });

  it('12. Doctor Urgency Override', async () => {
    const res = await fetch(`${baseUrl}/api/cases/${criticalCaseId}/override`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        urgencyBand: 'emergency',
        reason: 'Vitals indicate severe hypertension'
      })
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.oldUrgency, 'critical');
    assert.strictEqual(data.newUrgency, 'emergency');
  });

  it('13. Doctor Reply via Twilio', async () => {
    const res = await fetch(`${baseUrl}/api/cases/${criticalCaseId}/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`
      },
      body: JSON.stringify({
        responseMessage: 'Please go directly to St. Jude Emergency Room.',
        outcome: 'needs_visit'
      })
    });

    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.case.status, 'needs_visit');
  });

  it('14. Logout (Destroys Session Token)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    assert.strictEqual(res.status, 200);

    const resMe = await fetch(`${baseUrl}/api/auth/me`, {
      headers: {
        'Authorization': `Bearer ${sessionToken}`
      }
    });

    assert.strictEqual(resMe.status, 401);
  });
});
