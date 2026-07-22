package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"medlink_backend/config"
	"medlink_backend/models"
)

type StructuredIntakeResult struct {
	PatientName      string `json:"patientName"`
	PatientGender    string `json:"patientGender"`
	PatientAge       string `json:"patientAge"`
	PrimaryComplaint string `json:"primaryComplaint"`
	Symptoms         string `json:"symptoms"`
	Duration         string `json:"duration"`
	UrgencyBand      string `json:"urgencyBand"` // emergency, urgent, routine, non_urgent
	NextQuestion     string `json:"nextQuestion"`
	IsComplete       bool   `json:"isComplete"`
}

type AIIntakeService struct {
	Config *config.Config
}

func NewAIIntakeService(cfg *config.Config) *AIIntakeService {
	return &AIIntakeService{Config: cfg}
}

// ProcessPatientTurn handles natural language chat turn by turn
func (s *AIIntakeService) ProcessPatientTurn(ctx context.Context, existingCase *models.Case, latestMsg string) (*StructuredIntakeResult, error) {
	// If Gemini or OpenAI API Key is present, attempt LLM call
	if s.Config.AIAPIKey != "" {
		res, err := s.callGeminiIntake(ctx, existingCase, latestMsg)
		if err == nil {
			return res, nil
		}
	}

	// Fallback Smart Rule-Based Engine (Guarantees zero-config hackathon execution)
	return s.processRuleBasedIntake(existingCase, latestMsg), nil
}

func (s *AIIntakeService) processRuleBasedIntake(existingCase *models.Case, latestMsg string) *StructuredIntakeResult {
	res := &StructuredIntakeResult{
		PatientName:      existingCase.PatientName,
		PatientGender:    existingCase.PatientGender,
		PatientAge:       existingCase.PatientAge,
		PrimaryComplaint: existingCase.PrimaryComplaint,
		Symptoms:         existingCase.Symptoms,
		Duration:         existingCase.Duration,
		UrgencyBand:      existingCase.UrgencyBand,
	}

	if res.UrgencyBand == "" {
		res.UrgencyBand = "routine"
	}

	msgLower := strings.ToLower(latestMsg)

	// Step 1: Extract Name if missing
	if res.PatientName == "" {
		if strings.Contains(msgLower, "my name is ") {
			parts := strings.Split(msgLower, "my name is ")
			if len(parts) > 1 {
				res.PatientName = strings.Title(strings.TrimSpace(strings.Fields(parts[1])[0]))
			}
		} else if len(strings.Fields(latestMsg)) <= 3 && !strings.Contains(msgLower, "pain") && !strings.Contains(msgLower, "fever") {
			res.PatientName = strings.Title(latestMsg)
		}
	}

	// Step 2: Extract Age/Gender if mentioned
	if res.PatientAge == "" {
		reAge := regexp.MustCompile(`\b(\d{1,2})\s*(years|yr|yrs|old)?\b`)
		matches := reAge.FindStringSubmatch(msgLower)
		if len(matches) > 1 {
			res.PatientAge = matches[1] + " years"
		}
	}
	if res.PatientGender == "" {
		if strings.Contains(msgLower, "male") || strings.Contains(msgLower, "man") || strings.Contains(msgLower, "boy") {
			res.PatientGender = "Male"
		} else if strings.Contains(msgLower, "female") || strings.Contains(msgLower, "woman") || strings.Contains(msgLower, "girl") {
			res.PatientGender = "Female"
		}
	}

	// Step 3: Extract Complaint & Duration
	if res.PrimaryComplaint == "" {
		res.PrimaryComplaint = latestMsg
	} else {
		res.Symptoms += " | " + latestMsg
	}

	if res.Duration == "" {
		if strings.Contains(msgLower, "day") || strings.Contains(msgLower, "week") || strings.Contains(msgLower, "hour") || strings.Contains(msgLower, "month") {
			res.Duration = latestMsg
		}
	}

	// Urgency Heuristics
	if strings.Contains(msgLower, "severe") || strings.Contains(msgLower, "high fever") || strings.Contains(msgLower, "vomiting blood") {
		res.UrgencyBand = "emergency"
	} else if strings.Contains(msgLower, "moderate") || strings.Contains(msgLower, "worse") || strings.Contains(msgLower, "cramp") {
		res.UrgencyBand = "urgent"
	}

	// Conversational Loop logic
	if res.PatientName == "" {
		res.NextQuestion = "Hello! Welcome to MedLink. To get started, please tell me your full name."
		res.IsComplete = false
	} else if res.PatientAge == "" || res.PatientGender == "" {
		res.NextQuestion = fmt.Sprintf("Thank you, %s. Could you please share your age and gender?", res.PatientName)
		res.IsComplete = false
	} else if res.Duration == "" {
		res.NextQuestion = "Got it. How long have you experienced these symptoms or complaint?"
		res.IsComplete = false
	} else {
		res.NextQuestion = "Thank you for providing these details. I have summarized your case and sent it directly to the on-duty doctor on the MedLink dashboard. A doctor will review and reply to you here shortly."
		res.IsComplete = true
	}

	return res
}

func (s *AIIntakeService) callGeminiIntake(ctx context.Context, existingCase *models.Case, latestMsg string) (*StructuredIntakeResult, error) {
	url := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=%s", s.Config.AIAPIKey)

	prompt := fmt.Sprintf(`You are MedLink's medical intake AI assistant.
Current Known Patient Info:
Name: %s
Gender: %s
Age: %s
Complaint: %s
Symptoms: %s
Duration: %s

Latest Patient Message: "%s"

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
Return ONLY valid JSON without markdown formatting.`, existingCase.PatientName, existingCase.PatientGender, existingCase.PatientAge, existingCase.PrimaryComplaint, existingCase.Symptoms, existingCase.Duration, latestMsg)

	reqBody := map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": prompt}}},
		},
	}

	jsonBytes, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewBuffer(jsonBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemini api error: %s", string(body))
	}

	var geminiResp struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	if err := json.Unmarshal(body, &geminiResp); err != nil || len(geminiResp.Candidates) == 0 {
		return nil, fmt.Errorf("failed to parse gemini response")
	}

	rawText := geminiResp.Candidates[0].Content.Parts[0].Text
	rawText = strings.TrimPrefix(rawText, "```json")
	rawText = strings.TrimPrefix(rawText, "```")
	rawText = strings.TrimSuffix(rawText, "```")
	rawText = strings.TrimSpace(rawText)

	var res StructuredIntakeResult
	if err := json.Unmarshal([]byte(rawText), &res); err != nil {
		return nil, err
	}

	return &res, nil
}

// Silence unused strconv
var _ = strconv.Atoi
