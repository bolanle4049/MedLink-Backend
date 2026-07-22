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

  const adminEmail = 'root@medlink.org';
  const adminPassword = 'RootSecret123!';

  const faEmail = 'admin@stjude.org';
  const faTempPassword = 'TempPass123!';
  const faNewPassword = 'FacilityAdmin123!';

  const docEmail = 'dr.johnson@stjude.org';
  const docTempPassword = 'DocTemp123!';
  const docNewPassword = 'DoctorSecret123!';

  let adminToken = '';
  let faToken = '';
  let doctorToken = '';
  let facilityId = '';
  let criticalCaseId = '';
  let routineCaseId = '';

  const routinePhone = 'whatsapp:+2348123456789';

  async function post(path: string, body: any, token?: string) {
    return fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    });
  }

  async function patientSay(message: string, phone = routinePhone) {
    const res = await post('/api/twilio/simulate-patient', { patientPhone: phone, message });
    return res.json() as Promise<any>;
  }

  // --- Access model (Spec Section 12) ---------------------------------------

  it('1. Bootstrap: first register creates the MedLink root admin', async () => {
    const res = await post('/api/auth/register', {
      email: adminEmail,
      password: adminPassword,
      fullName: 'MedLink Root',
      medicalCredentials: 'root'
    });
    assert.strictEqual(res.status, 201);
    const data: any = await res.json();
    assert.strictEqual(data.role, 'medlink_admin');
    assert.strictEqual(data.doctor.isVerified, true);
  });

  it('2. Self-registration is disabled after bootstrap (403)', async () => {
    const res = await post('/api/auth/register', {
      email: 'someone@evil.org',
      password: 'Password123!',
      fullName: 'Nope',
      medicalCredentials: 'x'
    });
    assert.strictEqual(res.status, 403);
    const data: any = await res.json();
    assert.strictEqual(data.error, 'self_registration_disabled');
  });

  it('3. Admin logs in (no reset required)', async () => {
    const res = await post('/api/auth/login', { email: adminEmail, password: adminPassword });
    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.ok(data.sessionToken);
    adminToken = data.sessionToken;
  });

  it('4. Admin onboards a facility + facility admin', async () => {
    const res = await post('/api/facilities', {
      name: 'St Jude Hospital',
      type: 'hospital',
      location: 'Lagos',
      adminEmail: faEmail,
      adminFullName: 'Jane Admin',
      adminTempPassword: faTempPassword
    }, adminToken);
    assert.strictEqual(res.status, 201);
    const data: any = await res.json();
    facilityId = data.facility.id;
    assert.ok(facilityId);
    assert.strictEqual(data.facilityAdmin.role, 'facility_admin');
    assert.strictEqual(data.facilityAdmin.mustResetPassword, true);
  });

  it('5. Facility admin first login is forced to reset password', async () => {
    const res = await post('/api/auth/login', { email: faEmail, password: faTempPassword });
    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.mustResetPassword, true);
  });

  it('6. Facility admin completes first-login reset and is logged in', async () => {
    const res = await post('/api/auth/first-login-reset', {
      email: faEmail,
      currentPassword: faTempPassword,
      newPassword: faNewPassword
    });
    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.ok(data.sessionToken);
    faToken = data.sessionToken;
  });

  it('7. Facility admin enrols a doctor into their facility', async () => {
    const res = await post('/api/facilities/doctors', {
      email: docEmail,
      fullName: 'Dr Alex Johnson',
      mdcnLicense: 'MDCN-99887',
      tempPassword: docTempPassword
    }, faToken);
    assert.strictEqual(res.status, 201);
    const data: any = await res.json();
    assert.strictEqual(data.doctor.facilityId, facilityId);
    assert.strictEqual(data.doctor.mustResetPassword, true);
  });

  it('8. Doctor resets password on first login', async () => {
    const login = await post('/api/auth/login', { email: docEmail, password: docTempPassword });
    const loginData: any = await login.json();
    assert.strictEqual(loginData.mustResetPassword, true);

    const reset = await post('/api/auth/first-login-reset', {
      email: docEmail,
      currentPassword: docTempPassword,
      newPassword: docNewPassword
    });
    assert.strictEqual(reset.status, 200);
    const resetData: any = await reset.json();
    doctorToken = resetData.sessionToken;
    assert.ok(doctorToken);
  });

  // --- Deterministic red-flag halt (Spec Section 3) -------------------------

  it('9. Red-flag on any message halts to a Critical emergency episode', async () => {
    const data = await patientSay(
      'Help! I have severe chest pain and sweating profusely!',
      'whatsapp:+2348999999999'
    );
    assert.strictEqual(data.episode.state, 'Critical');
    assert.strictEqual(data.episode.isCritical, true);
    assert.strictEqual(data.episode.triageBand, 'emergency');
    criticalCaseId = data.episode.id;
  });

  // --- Full payment-blind episode lifecycle (Sections 7, 8, 10) -------------

  it('10. Consent gate is presented on first contact', async () => {
    const data = await patientSay('Hello');
    assert.match(data.aiReply.toLowerCase(), /consent/);
    assert.strictEqual(data.episode.state, 'AwaitingConsent');
  });

  it('11. Consent -> who-for -> age/sex -> coverage -> interview', async () => {
    const consent = await patientSay('yes');
    assert.strictEqual(consent.episode.state, 'Identifying');

    await patientSay('1'); // self
    await patientSay('35, male'); // subject age + sex
    const coverage = await patientSay('none'); // Case 3
    assert.strictEqual(coverage.episode.state, 'Interviewing');
  });

  it('12. Interview collects complaint, symptoms, duration then confirms', async () => {
    await patientSay('I have stomach cramps');
    await patientSay('nausea and bloating');
    const beforeConfirm = await patientSay('it has been going on for 2 days');
    assert.strictEqual(beforeConfirm.episode.state, 'Confirming');

    const confirmed = await patientSay('yes');
    assert.strictEqual(confirmed.episode.state, 'Queued');
    assert.strictEqual(confirmed.episode.coverage.coverageCase, 3);
    assert.strictEqual(confirmed.episode.facilityId, facilityId);
    assert.ok(confirmed.episode.report.length >= 1);
    routineCaseId = confirmed.episode.id;
  });

  // --- Facility-scoped queue + doctor actions (Sections 9, 12, 18) ----------

  it('13. Doctor queue is scoped to their own facility', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    const ids = data.cases.map((c: any) => c.id);
    assert.ok(ids.includes(routineCaseId));
    // The unrouted critical case has no facility, so it must NOT appear here.
    assert.ok(!ids.includes(criticalCaseId));
    data.cases.forEach((c: any) => assert.strictEqual(c.facilityId, facilityId));
  });

  it('14. Doctor cannot open a case outside their facility (403)', async () => {
    const res = await fetch(`${baseUrl}/api/cases/${criticalCaseId}`, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    assert.strictEqual(res.status, 403);
  });

  it('15. Band override is recorded in the audit trail', async () => {
    const res = await post(`/api/cases/${routineCaseId}/override`, {
      urgencyBand: 'emergency',
      reason: 'Persistent pain plus dehydration warrants urgent review'
    }, doctorToken);
    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.newBand, 'emergency');

    const detail = await fetch(`${baseUrl}/api/cases/${routineCaseId}`, {
      headers: { Authorization: `Bearer ${doctorToken}` }
    });
    const detailData: any = await detail.json();
    const actions = detailData.case.auditTrail.map((a: any) => a.action);
    assert.ok(actions.includes('band_override'));
  });

  it('16. Doctor reply resolves the episode', async () => {
    const res = await post(`/api/cases/${routineCaseId}/reply`, {
      responseMessage: 'Stay hydrated and monitor; visit if pain worsens.',
      outcome: 'follow_up'
    }, doctorToken);
    assert.strictEqual(res.status, 200);
    const data: any = await res.json();
    assert.strictEqual(data.case.state, 'Resolved');
    assert.strictEqual(data.case.outcome, 'follow_up');
  });

  it('17. Admin (unscoped) can see the global critical case', async () => {
    const res = await fetch(`${baseUrl}/api/cases`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data: any = await res.json();
    const ids = data.cases.map((c: any) => c.id);
    assert.ok(ids.includes(criticalCaseId));
  });
});
