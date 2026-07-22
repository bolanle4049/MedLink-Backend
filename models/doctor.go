package models

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
	"medlink_backend/database"
)

type Doctor struct {
	ID                 string    `json:"id"`
	Email              string    `json:"email"`
	PasswordHash       string    `json:"-"`
	FullName           string    `json:"fullName"`
	MedicalCredentials string    `json:"medicalCredentials"`
	IsVerified         bool      `json:"isVerified"`
	IsActive           bool      `json:"isActive"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

type DoctorResponse struct {
	ID                 string `json:"id"`
	Email              string `json:"email"`
	FullName           string `json:"fullName"`
	MedicalCredentials string `json:"medicalCredentials"`
	IsVerified         bool   `json:"isVerified"`
	IsActive           bool   `json:"isActive"`
	CreatedAt          string `json:"createdAt"`
}

func (d *Doctor) ToResponse() *DoctorResponse {
	return &DoctorResponse{
		ID:                 d.ID,
		Email:              d.Email,
		FullName:           d.FullName,
		MedicalCredentials: d.MedicalCredentials,
		IsVerified:         d.IsVerified,
		IsActive:           d.IsActive,
		CreatedAt:          d.CreatedAt.Format(time.RFC3339),
	}
}

// In-Memory Fallback storage for doctors
var (
	memoryDoctorsByID    = make(map[string]*Doctor)
	memoryDoctorsByEmail = make(map[string]*Doctor)
)

func CreateDoctor(ctx context.Context, email, passwordHash, fullName, medicalCredentials string) (*Doctor, error) {
	db := database.GlobalDB
	id := uuid.New().String()
	now := time.Now()

	doc := &Doctor{
		ID:                 id,
		Email:              email,
		PasswordHash:       passwordHash,
		FullName:           fullName,
		MedicalCredentials: medicalCredentials,
		IsVerified:         false, // Default: awaiting manual verification
		IsActive:           true,
		CreatedAt:          now,
		UpdatedAt:          now,
	}

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		db.MemoryLock.Lock()
		defer db.MemoryLock.Unlock()

		if _, exists := memoryDoctorsByEmail[email]; exists {
			return nil, fmt.Errorf("email already registered")
		}
		memoryDoctorsByID[id] = doc
		memoryDoctorsByEmail[email] = doc
		return doc, nil
	}

	query := `
		INSERT INTO doctors (id, email, password_hash, full_name, medical_credentials, is_verified, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`
	_, err := db.SQLDB.ExecContext(ctx, query, id, email, passwordHash, fullName, medicalCredentials, false, true, now, now)
	if err != nil {
		return nil, fmt.Errorf("error creating doctor: %w", err)
	}

	return doc, nil
}

func FindDoctorByEmail(ctx context.Context, email string) (*Doctor, error) {
	db := database.GlobalDB

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		db.MemoryLock.RLock()
		defer db.MemoryLock.RUnlock()

		doc, exists := memoryDoctorsByEmail[email]
		if !exists {
			return nil, fmt.Errorf("doctor not found")
		}
		return doc, nil
	}

	query := `
		SELECT id, email, password_hash, full_name, medical_credentials, is_verified, is_active, created_at, updated_at
		FROM doctors
		WHERE email = $1
	`
	doc := &Doctor{}
	err := db.SQLDB.QueryRowContext(ctx, query, email).Scan(
		&doc.ID, &doc.Email, &doc.PasswordHash, &doc.FullName, &doc.MedicalCredentials,
		&doc.IsVerified, &doc.IsActive, &doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("doctor not found")
		}
		return nil, err
	}

	return doc, nil
}

func FindDoctorByID(ctx context.Context, id string) (*Doctor, error) {
	db := database.GlobalDB

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		db.MemoryLock.RLock()
		defer db.MemoryLock.RUnlock()

		doc, exists := memoryDoctorsByID[id]
		if !exists {
			return nil, fmt.Errorf("doctor not found")
		}
		return doc, nil
	}

	query := `
		SELECT id, email, password_hash, full_name, medical_credentials, is_verified, is_active, created_at, updated_at
		FROM doctors
		WHERE id = $1
	`
	doc := &Doctor{}
	err := db.SQLDB.QueryRowContext(ctx, query, id).Scan(
		&doc.ID, &doc.Email, &doc.PasswordHash, &doc.FullName, &doc.MedicalCredentials,
		&doc.IsVerified, &doc.IsActive, &doc.CreatedAt, &doc.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("doctor not found")
		}
		return nil, err
	}

	return doc, nil
}

func SetDoctorVerified(ctx context.Context, email string, isVerified bool) error {
	db := database.GlobalDB

	if db == nil || db.IsInMemory || db.SQLDB == nil {
		db.MemoryLock.Lock()
		defer db.MemoryLock.Unlock()

		doc, exists := memoryDoctorsByEmail[email]
		if !exists {
			return fmt.Errorf("doctor not found")
		}
		doc.IsVerified = isVerified
		return nil
	}

	query := `UPDATE doctors SET is_verified = $1, updated_at = $2 WHERE email = $3`
	res, err := db.SQLDB.ExecContext(ctx, query, isVerified, time.Now(), email)
	if err != nil {
		return err
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("doctor not found")
	}
	return nil
}
