package handlers

import (
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"medlink_backend/config"
	"medlink_backend/models"
	"medlink_backend/services"
)

type CasesHandler struct {
	Config     *config.Config
	TwilioServ *services.TwilioService
}

func NewCasesHandler(cfg *config.Config) *CasesHandler {
	return &CasesHandler{
		Config:     cfg,
		TwilioServ: services.NewTwilioService(cfg),
	}
}

type OverrideUrgencyRequest struct {
	UrgencyBand string `json:"urgencyBand" binding:"required"` // critical, emergency, urgent, routine, non_urgent
	Reason      string `json:"reason"`
}

type DoctorReplyRequest struct {
	ResponseMessage string `json:"responseMessage" binding:"required"`
	Outcome         string `json:"outcome" binding:"required"` // resolved, needs_visit, pending_followup
}

// GET /api/cases
// Returns prioritized triage queue for Doctor Dashboard
func (h *CasesHandler) GetQueue(c *gin.Context) {
	statusFilter := c.Query("status")
	urgencyFilter := c.Query("urgency")

	cases, err := models.GetDoctorQueue(c.Request.Context(), statusFilter, urgencyFilter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"count": len(cases),
		"cases": cases,
	})
}

// GET /api/cases/:id
// Returns single case detail view with full transcript and report
func (h *CasesHandler) GetByID(c *gin.Context) {
	caseID := c.Param("id")

	caseData, err := models.FindCaseByID(c.Request.Context(), caseID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Case not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"case": caseData,
	})
}

// POST /api/cases/:id/override
// Allows doctor to override the AI-assigned urgency band
func (h *CasesHandler) OverrideUrgency(c *gin.Context) {
	caseID := c.Param("id")

	var req OverrideUrgencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
		return
	}

	caseData, err := models.FindCaseByID(c.Request.Context(), caseID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Case not found"})
		return
	}

	doctorIDVal, _ := c.Get("doctor_id")
	doctorID, _ := doctorIDVal.(string)

	oldUrgency := caseData.UrgencyBand
	caseData.UrgencyBand = req.UrgencyBand
	caseData.UpdatedAt = time.Now()

	// Record override entry in raw transcript
	overrideNote := fmt.Sprintf("Doctor ID %s overridden urgency from '%s' to '%s'. Reason: %s", doctorID, oldUrgency, req.UrgencyBand, req.Reason)
	caseData.RawTranscript = append(caseData.RawTranscript, models.TranscriptTurn{
		Sender:    "doctor_system",
		Message:   overrideNote,
		Timestamp: time.Now(),
	})

	if err := models.CreateOrUpdateCase(c.Request.Context(), caseData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    "Case urgency band updated successfully",
		"caseId":     caseData.ID,
		"oldUrgency": oldUrgency,
		"newUrgency": caseData.UrgencyBand,
	})
}

// POST /api/cases/:id/reply
// Doctor sends response message back to patient via Twilio WhatsApp
func (h *CasesHandler) DoctorReply(c *gin.Context) {
	caseID := c.Param("id")

	var req DoctorReplyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
		return
	}

	caseData, err := models.FindCaseByID(c.Request.Context(), caseID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Case not found"})
		return
	}

	doctorIDVal, _ := c.Get("doctor_id")
	doctorID, _ := doctorIDVal.(string)

	// Send message to patient via Twilio WhatsApp API
	whatsappMsg := fmt.Sprintf("💬 Doctor's Note:\n%s\n\nStatus: %s", req.ResponseMessage, req.Outcome)
	err = h.TwilioServ.SendWhatsAppMessage(c.Request.Context(), caseData.PatientPhone, whatsappMsg)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "twilio_delivery_failed", "message": err.Error()})
		return
	}

	// Update Case Record
	caseData.DoctorReply = req.ResponseMessage
	caseData.DoctorOutcome = req.Outcome
	caseData.AssignedDoctorID = doctorID
	caseData.Status = req.Outcome
	caseData.UpdatedAt = time.Now()

	caseData.RawTranscript = append(caseData.RawTranscript, models.TranscriptTurn{
		Sender:    "doctor",
		Message:   req.ResponseMessage,
		Timestamp: time.Now(),
	})

	if err := models.CreateOrUpdateCase(c.Request.Context(), caseData); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Doctor reply delivered to patient WhatsApp thread via Twilio",
		"case":    caseData,
	})
}
