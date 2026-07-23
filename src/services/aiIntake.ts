import config from '../config';

export interface StructuredObservation {
  code: string;
  value: string;
  sourceQuote: string;
}

export interface StructuredIntakeResult {
  observations: StructuredObservation[];
  triageBand: string | null; // 'critical', 'emergency', 'urgent', 'routine', 'non_urgent'
  nextQuestion: string;
  isComplete: boolean;
}

export async function processPatientTurn(
  patientName: string,
  subjectAge: number | null,
  subjectSex: string | null,
  previousTranscript: string,
  latestMsg: string
): Promise<StructuredIntakeResult> {
  if (!config.aiApiKey) {
    throw new Error("AI API Key is missing. Triage core requires Gemini AI.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.aiApiKey}`;

  const prompt = `You are MedLink's medical intake AI assistant.
Your goal is to conduct a payment-blind clinical interview, gathering symptoms to assign a South African Triage Scale (SATS) band.
You must ask ONE question at a time. Probe for vagueness.
Do NOT ask for insurance, payment, or facility details.

Patient Name: ${patientName}
Age: ${subjectAge || 'Unknown'}
Sex: ${subjectSex || 'Unknown'}

Previous Conversation:
${previousTranscript}

Latest Patient Message: "${latestMsg}"

Extract any new clinical observations from the latest message. For each observation, provide a short code (e.g., "SYMPTOM_ONSET"), the value, and the EXACT quote from the patient's message.
If you have enough information to assign a triage band ('emergency', 'urgent', 'routine', 'non_urgent'), set isComplete to true and provide the band. Otherwise, ask the nextQuestion and set isComplete to false.

Return ONLY valid JSON:
{
  "observations": [
    {
      "code": "string",
      "value": "string",
      "sourceQuote": "string"
    }
  ],
  "triageBand": "emergency|urgent|routine|non_urgent" | null,
  "nextQuestion": "string",
  "isComplete": boolean
}
`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
      }
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error("Gemini API Error:", errText);
    throw new Error("Failed to reach AI Triage Core.");
  }

  const data: any = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error("Empty response from AI.");

  return JSON.parse(rawText) as StructuredIntakeResult;
}

