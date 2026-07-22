import config from '../config';
import { Case } from '../models/caseModel';

export interface StructuredIntakeResult {
  patientName: string;
  patientGender: string;
  patientAge: string;
  primaryComplaint: string;
  symptoms: string;
  duration: string;
  urgencyBand: string;
  nextQuestion: string;
  isComplete: boolean;
}

export async function processPatientTurn(existingCase: Partial<Case>, latestMsg: string): Promise<StructuredIntakeResult> {
  if (config.aiApiKey) {
    try {
      const res = await callGeminiIntake(existingCase, latestMsg);
      if (res) {
        return res;
      }
    } catch (err) {
      // Fallback to rule based engine
    }
  }

  return processRuleBasedIntake(existingCase, latestMsg);
}

export function processRuleBasedIntake(existingCase: Partial<Case>, latestMsg: string): StructuredIntakeResult {
  const res: StructuredIntakeResult = {
    patientName: existingCase.patientName || '',
    patientGender: existingCase.patientGender || '',
    patientAge: existingCase.patientAge || '',
    primaryComplaint: existingCase.primaryComplaint || '',
    symptoms: existingCase.symptoms || '',
    duration: existingCase.duration || '',
    urgencyBand: existingCase.urgencyBand || 'routine',
    nextQuestion: '',
    isComplete: false
  };

  const msgLower = latestMsg.toLowerCase();

  // Step 1: Extract Name if missing
  if (!res.patientName) {
    if (msgLower.includes('my name is ')) {
      const parts = msgLower.split('my name is ');
      if (parts[1]) {
        const rawName = parts[1].trim().split(/\s+/)[0];
        res.patientName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      }
    } else if (latestMsg.trim().split(/\s+/).length <= 3 && !msgLower.includes('pain') && !msgLower.includes('fever')) {
      res.patientName = latestMsg.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
  }

  // Step 2: Extract Age/Gender if mentioned
  if (!res.patientAge) {
    const ageMatch = msgLower.match(/\b(\d{1,2})\s*(years|yr|yrs|old)?\b/);
    if (ageMatch && ageMatch[1]) {
      res.patientAge = `${ageMatch[1]} years`;
    }
  }

  if (!res.patientGender) {
    if (msgLower.includes('male') || msgLower.includes('man') || msgLower.includes('boy')) {
      res.patientGender = 'Male';
    } else if (msgLower.includes('female') || msgLower.includes('woman') || msgLower.includes('girl')) {
      res.patientGender = 'Female';
    }
  }

  // Step 3: Extract Complaint & Duration
  if (!res.primaryComplaint) {
    res.primaryComplaint = latestMsg;
  } else {
    res.symptoms = res.symptoms ? `${res.symptoms} | ${latestMsg}` : latestMsg;
  }

  if (!res.duration) {
    if (msgLower.includes('day') || msgLower.includes('week') || msgLower.includes('hour') || msgLower.includes('month')) {
      res.duration = latestMsg;
    }
  }

  // Urgency Heuristics
  if (msgLower.includes('severe') || msgLower.includes('high fever') || msgLower.includes('vomiting blood')) {
    res.urgencyBand = 'emergency';
  } else if (msgLower.includes('moderate') || msgLower.includes('worse') || msgLower.includes('cramp')) {
    res.urgencyBand = 'urgent';
  }

  // Conversational Loop logic
  if (!res.patientName) {
    res.nextQuestion = 'Hello! Welcome to MedLink. To get started, please tell me your full name.';
    res.isComplete = false;
  } else if (!res.patientAge || !res.patientGender) {
    res.nextQuestion = `Thank you, ${res.patientName}. Could you please share your age and gender?`;
    res.isComplete = false;
  } else if (!res.duration) {
    res.nextQuestion = 'Got it. How long have you experienced these symptoms or complaint?';
    res.isComplete = false;
  } else {
    res.nextQuestion = 'Thank you for providing these details. I have summarized your case and sent it directly to the on-duty doctor on the MedLink dashboard. A doctor will review and reply to you here shortly.';
    res.isComplete = true;
  }

  return res;
}

async function callGeminiIntake(existingCase: Partial<Case>, latestMsg: string): Promise<StructuredIntakeResult | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.aiApiKey}`;

  const prompt = `You are MedLink's medical intake AI assistant.
Current Known Patient Info:
Name: ${existingCase.patientName || ''}
Gender: ${existingCase.patientGender || ''}
Age: ${existingCase.patientAge || ''}
Complaint: ${existingCase.primaryComplaint || ''}
Symptoms: ${existingCase.symptoms || ''}
Duration: ${existingCase.duration || ''}

Latest Patient Message: "${latestMsg}"

Extract updated structured JSON fields:
{
  "patientName": "string",
  "patientGender": "string",
  "patientAge": "string",
  "primaryComplaint": "string",
  "symptoms": "string",
  "duration": "string",
  "urgencyBand": "emergency|urgent|routine|non_urgent",
  "nextQuestion": "string",
  "isComplete": boolean
}
Return ONLY valid JSON without markdown formatting.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    return null;
  }

  const data: any = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) return null;

  const cleaned = rawText
    .replace(/^```json/i, '')
    .replace(/^```/i, '')
    .replace(/```$/i, '')
    .trim();

  return JSON.parse(cleaned) as StructuredIntakeResult;
}
