package models

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"medlink_backend/database"
)

type TranscriptTurn struct {
	Sender    string    `json:"sender"`    // "patient" or "ai" or "doctor"
	Message   string    `json:"message"`   
	Timestamp time.Time `json:"timestamp"` 
}

type Case struct {
	ID               string           `json:"id"`
	PatientPhone     string           `json:"patientPhone"`
	PatientName      string           `json:"patientName"`
	PatientGender    string           `json:"patientGender"`
	PatientAge       string           `json:"patientAge"`
	PrimaryComplaint string           `json:"primaryComplaint"`
	Symptoms         string           `json:"symptoms"`
	Duration         string           `json:"duration"`
	UrgencyBand      string           `json:"urgencyBand"` // critical, emergency, urgent, routine, non_urgent
	RedFlagTriggered string           `json:"redFlagTriggered,omitempty"`
	RawTranscript    []TranscriptTurn `json:"rawTranscript"`
	Status           string           `json:"status"` // draft, queued, resolved, needs_visit, pending_followup
	DoctorReply      string           `json:"doctorReply,omitempty"`
	DoctorOutcome    string           `json:"doctorOutcome,omitempty"`
	AssignedDoctorID string           `json:"assignedDoctorId,omitempty"`
	CreatedAt        time.Time        `json:"createdAt"`
	UpdatedAt        time.Time        `json:"updatedAt"`
}

// In-Memory store for Cases
var (
	memoryCasesByID    = make(map[string]*Case)
	memoryActiveByPhone = make(map[string]*Case)
	casesLock          sync.RWMutex
)

// Urgency priority for sorting dashboard queue
var urgencyPriority = map[string]int{
	"critical":   1,
	"emergency":  2,
	"urgent":     3,
	"routine":    4,
	"non_urgent": 5,
}

func CreateOrUpdateCase(ctx context.Context, c *Case) error {
	db := database.GlobalDB
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	now := time.Now()
	if c.CreatedAt.IsZero() {
		c.CreatedAt = now
	}
	c.UpdatedAt = now

	transcriptJSON, err := json.Marshal(c.RawTranscript)
	if err != nil {
		transcriptJSON = []byte("[]")
	}

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		casesLock.Lock()
		defer casesLock.Unlock()

		memoryCasesByID[c.ID] = c
		if c.Status != "resolved" {
			memoryActiveByPhone[c.PatientPhone] = c
		} else {
			delete(memoryActiveByPhone, c.PatientPhone)
		}
		return nil
	}

	query := `
		INSERT INTO cases (
			id, patient_phone, patient_name, patient_gender, patient_age,
			primary_complaint, symptoms, duration, urgency_band, red_flag_triggered,
			raw_transcript, status, doctor_reply, doctor_outcome, assigned_doctor_id, created_at, updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		ON CONFLICT (id) DO UPDATE SET
			patient_name = EXCLUDED.patient_name,
			patient_gender = EXCLUDED.patient_gender,
			patient_age = EXCLUDED.patient_age,
			primary_complaint = EXCLUDED.primary_complaint,
			symptoms = EXCLUDED.symptoms,
			duration = EXCLUDED.duration,
			urgency_band = EXCLUDED.urgency_band,
			red_flag_triggered = EXCLUDED.red_flag_triggered,
			raw_transcript = EXCLUDED.raw_transcript,
			status = EXCLUDED.status,
			doctor_reply = EXCLUDED.doctor_reply,
			doctor_outcome = EXCLUDED.doctor_outcome,
			assigned_doctor_id = EXCLUDED.assigned_doctor_id,
			updated_at = EXCLUDED.updated_at
	`

	_, err = db.SQLDB.ExecContext(ctx, query,
		c.ID, c.PatientPhone, c.PatientName, c.PatientGender, c.PatientAge,
		c.PrimaryComplaint, c.Symptoms, c.Duration, c.UrgencyBand, c.RedFlagTriggered,
		string(transcriptJSON), c.Status, c.DoctorReply, c.DoctorOutcome, c.AssignedDoctorID, c.CreatedAt, c.UpdatedAt,
	)
	return err
}

func FindActiveCaseByPatientPhone(ctx context.Context, phone string) (*Case, error) {
	db := database.GlobalDB

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		casesLock.RLock()
		defer casesLock.RUnlock()

		c, exists := memoryActiveByPhone[phone]
		if !exists || c.Status == "resolved" {
			return nil, fmt.Errorf("active case not found")
		}
		return c, nil
	}

	query := `
		SELECT id, patient_phone, patient_name, patient_gender, patient_age,
		       primary_complaint, symptoms, duration, urgency_band, red_flag_triggered,
		       raw_transcript, status, doctor_reply, doctor_outcome, assigned_doctor_id, created_at, updated_at
		FROM cases
		WHERE patient_phone = $1 AND status != 'resolved'
		ORDER BY created_at DESC LIMIT 1
	`

	c := &Case{}
	var transcriptStr string
	err := db.SQLDB.QueryRowContext(ctx, query, phone).Scan(
		&c.ID, &c.PatientPhone, &c.PatientName, &c.PatientGender, &c.PatientAge,
		&c.PrimaryComplaint, &c.Symptoms, &c.Duration, &c.UrgencyBand, &c.RedFlagTriggered,
		&transcriptStr, &c.Status, &c.DoctorReply, &c.DoctorOutcome, &c.AssignedDoctorID, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	_ = json.Unmarshal([]byte(transcriptStr), &c.RawTranscript)
	return c, nil
}

func FindCaseByID(ctx context.Context, id string) (*Case, error) {
	db := database.GlobalDB

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		casesLock.RLock()
		defer casesLock.RUnlock()

		c, exists := memoryCasesByID[id]
		if !exists {
			return nil, fmt.Errorf("case not found")
		}
		return c, nil
	}

	query := `
		SELECT id, patient_phone, patient_name, patient_gender, patient_age,
		       primary_complaint, symptoms, duration, urgency_band, red_flag_triggered,
		       raw_transcript, status, doctor_reply, doctor_outcome, assigned_doctor_id, created_at, updated_at
		FROM cases
		WHERE id = $1
	`

	c := &Case{}
	var transcriptStr string
	err := db.SQLDB.QueryRowContext(ctx, query, id).Scan(
		&c.ID, &c.PatientPhone, &c.PatientName, &c.PatientGender, &c.PatientAge,
		&c.PrimaryComplaint, &c.Symptoms, &c.Duration, &c.UrgencyBand, &c.RedFlagTriggered,
		&transcriptStr, &c.Status, &c.DoctorReply, &c.DoctorOutcome, &c.AssignedDoctorID, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("case not found")
		}
		return nil, err
	}

	_ = json.Unmarshal([]byte(transcriptStr), &c.RawTranscript)
	return c, nil
}

func GetDoctorQueue(ctx context.Context, statusFilter, urgencyFilter string) ([]*Case, error) {
	db := database.GlobalDB
	var result []*Case

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		casesLock.RLock()
		defer casesLock.RUnlock()

		for _, c := range memoryCasesByID {
			if statusFilter != "" && c.Status != statusFilter {
				continue
			}
			if urgencyFilter != "" && c.UrgencyBand != urgencyFilter {
				continue
			}
			result = append(result, c)
		}
	} else {
		query := `
			SELECT id, patient_phone, patient_name, patient_gender, patient_age,
			       primary_complaint, symptoms, duration, urgency_band, red_flag_triggered,
			       raw_transcript, status, doctor_reply, doctor_outcome, assigned_doctor_id, created_at, updated_at
			FROM cases
			WHERE 1=1
		`
		var args []interface{}
		argIdx := 1

		if statusFilter != "" {
			query += fmt.Sprintf(" AND status = $%d", argIdx)
			args = append(args, statusFilter)
			argIdx++
		}
		if urgencyFilter != "" {
			query += fmt.Sprintf(" AND urgency_band = $%d", argIdx)
			args = append(args, urgencyFilter)
			argIdx++
		}

		rows, err := db.SQLDB.QueryContext(ctx, query, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		for rows.Next() {
			c := &Case{}
			var transcriptStr string
			err := rows.Scan(
				&c.ID, &c.PatientPhone, &c.PatientName, &c.PatientGender, &c.PatientAge,
				&c.PrimaryComplaint, &c.Symptoms, &c.Duration, &c.UrgencyBand, &c.RedFlagTriggered,
				&transcriptStr, &c.Status, &c.DoctorReply, &c.DoctorOutcome, &c.AssignedDoctorID, &c.CreatedAt, &c.UpdatedAt,
			)
			if err == nil {
				_ = json.Unmarshal([]byte(transcriptStr), &c.RawTranscript)
				result = append(result, c)
			}
		}
	}

	// Sort Queue: Critical first, then Emergency -> Urgent -> Routine -> Non-Urgent, then CreatedAt (Oldest waiting first)
	sort.Slice(result, func(i, j int) bool {
		p1 := urgencyPriority[result[i].UrgencyBand]
		p2 := urgencyPriority[result[j].UrgencyBand]
		if p1 == 0 {
			p1 = 99
		}
		if p2 == 0 {
			p2 = 99
		}

		if p1 != p2 {
			return p1 < p2
		}
		return result[i].CreatedAt.Before(result[j].CreatedAt)
	})

	return result, nil
}
