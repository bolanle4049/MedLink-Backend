package handlers

import (
	"context"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"medlink_backend/config"
	"medlink_backend/models"
	"medlink_backend/services"
)

type TwilioHandler struct {
	Config     *config.Config
	AIIntake   *services.AIIntakeService
	TwilioServ *services.TwilioService
}

func NewTwilioHandler(cfg *config.Config) *TwilioHandler {
	return &TwilioHandler{
		Config:     cfg,
		AIIntake:   services.NewAIIntakeService(cfg),
		TwilioServ: services.NewTwilioService(cfg),
	}
}

// POST /api/twilio/webhook
// Receives inbound WhatsApp webhook from Twilio
func (h *TwilioHandler) Webhook(c *gin.Context) {
	fromPhone := c.PostForm("From")
	body := strings.TrimSpace(c.PostForm("Body"))

	if fromPhone == "" || body == "" {
		c.String(http.StatusBadRequest, "Missing From or Body form field")
		return
	}

	replyMessage := h.processInboundMessage(c.Request.Context(), fromPhone, body)

	// Return TwiML XML to Twilio
	c.Header("Content-Type", "application/xml")
	c.String(http.StatusOK, services.FormatTwiMLResponse(replyMessage))
}

// POST /api/twilio/simulate-patient
// Helper endpoint for hackathon demo testing without live Twilio setup
type SimulatePatientRequest struct {
	PatientPhone string `json:"patientPhone" binding:"required"`
	Message      string `json:"message" binding:"required"`
}

func (h *TwilioHandler) SimulatePatient(c *gin.Context) {
	var req SimulatePatientRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
		return
	}

	replyMessage := h.processInboundMessage(c.Request.Context(), req.PatientPhone, req.Message)

	activeCase, _ := models.FindActiveCaseByPatientPhone(c.Request.Context(), req.PatientPhone)

	c.JSON(http.StatusOK, gin.H{
		"patientPhone": req.PatientPhone,
		"userMessage":  req.Message,
		"aiReply":      replyMessage,
		"case":         activeCase,
	})
}

func (h *TwilioHandler) processInboundMessage(ctx context.Context, fromPhone, body string) string {
	log.Printf("[TWILIO INBOUND] Phone: %s | Message: %s", fromPhone, body)

	// Load or initialize patient active case
	activeCase, err := models.FindActiveCaseByPatientPhone(ctx, fromPhone)
	if err != nil || activeCase == nil {
		activeCase = &models.Case{
			PatientPhone: fromPhone,
			UrgencyBand:  "routine",
			Status:       "draft",
			CreatedAt:    time.Now(),
		}
	}

	// Add patient turn to raw transcript
	activeCase.RawTranscript = append(activeCase.RawTranscript, models.TranscriptTurn{
		Sender:    "patient",
		Message:   body,
		Timestamp: time.Now(),
	})

	// STEP 1: Deterministic Red Flag Safety Check FIRST
	isRedFlag, redFlagRule := services.CheckRedFlags(body)
	if isRedFlag {
		activeCase.UrgencyBand = "critical"
		activeCase.RedFlagTriggered = redFlagRule
		activeCase.Status = "queued" // Escalate immediately to doctor queue

		emergencyReply := "⚠️ URGENT MEDICAL WARNING: Your reported symptoms indicate a potentially serious critical condition (" + redFlagRule + "). Please go to the nearest emergency clinic or hospital immediately. An on-duty clinician has also been alerted on our system."

		activeCase.RawTranscript = append(activeCase.RawTranscript, models.TranscriptTurn{
			Sender:    "ai",
			Message:   emergencyReply,
			Timestamp: time.Now(),
		})

		_ = models.CreateOrUpdateCase(ctx, activeCase)
		return emergencyReply
	}

	// STEP 2: Process AI Intake
	intakeRes, err := h.AIIntake.ProcessPatientTurn(ctx, activeCase, body)
	if err == nil {
		if intakeRes.PatientName != "" {
			activeCase.PatientName = intakeRes.PatientName
		}
		if intakeRes.PatientGender != "" {
			activeCase.PatientGender = intakeRes.PatientGender
		}
		if intakeRes.PatientAge != "" {
			activeCase.PatientAge = intakeRes.PatientAge
		}
		if intakeRes.PrimaryComplaint != "" {
			activeCase.PrimaryComplaint = intakeRes.PrimaryComplaint
		}
		if intakeRes.Symptoms != "" {
			activeCase.Symptoms = intakeRes.Symptoms
		}
		if intakeRes.Duration != "" {
			activeCase.Duration = intakeRes.Duration
		}
		if intakeRes.UrgencyBand != "" {
			activeCase.UrgencyBand = intakeRes.UrgencyBand
		}

		if intakeRes.IsComplete {
			activeCase.Status = "queued" // Case ready for doctor dashboard queue
		}

		replyText := intakeRes.NextQuestion

		activeCase.RawTranscript = append(activeCase.RawTranscript, models.TranscriptTurn{
			Sender:    "ai",
			Message:   replyText,
			Timestamp: time.Now(),
		})

		_ = models.CreateOrUpdateCase(ctx, activeCase)
		return replyText
	}

	fallbackReply := "Thank you. We have recorded your message and forwarded it to our triage team."
	_ = models.CreateOrUpdateCase(ctx, activeCase)
	return fallbackReply
}
