package database

import (
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	_ "github.com/lib/pq"
	"medlink_backend/config"
)

type DB struct {
	SQLDB       *sql.DB
	IsInMemory  bool
	MemoryStore map[string]map[string]any
	MemoryLock  sync.RWMutex
}

var GlobalDB *DB

func InitDB(cfg *config.Config) *DB {
	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err == nil {
		err = db.Ping()
	}

	if err != nil {
		log.Printf("[WARN] PostgreSQL connection failed (%v). Falling back to Hackathon In-Memory Data Store.", err)
		GlobalDB = &DB{
			IsInMemory:  true,
			MemoryStore: make(map[string]map[string]any),
		}
		return GlobalDB
	}

	log.Println("[INFO] Connected to PostgreSQL database successfully.")
	GlobalDB = &DB{
		SQLDB:      db,
		IsInMemory: false,
	}

	if err := createTables(db); err != nil {
		log.Fatalf("[FATAL] Failed to run database migrations: %v", err)
	}

	return GlobalDB
}

func createTables(db *sql.DB) error {
	schema := `
	CREATE TABLE IF NOT EXISTS doctors (
		id VARCHAR(36) PRIMARY KEY,
		email VARCHAR(255) UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		full_name VARCHAR(255) NOT NULL,
		medical_credentials TEXT NOT NULL,
		is_verified BOOLEAN DEFAULT FALSE,
		is_active BOOLEAN DEFAULT TRUE,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS revoked_tokens (
		token TEXT PRIMARY KEY,
		revoked_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS cases (
		id VARCHAR(36) PRIMARY KEY,
		patient_phone VARCHAR(50) NOT NULL,
		patient_name VARCHAR(255) DEFAULT '',
		patient_gender VARCHAR(50) DEFAULT '',
		patient_age VARCHAR(50) DEFAULT '',
		primary_complaint TEXT NOT NULL,
		symptoms TEXT DEFAULT '',
		duration VARCHAR(255) DEFAULT '',
		urgency_band VARCHAR(50) DEFAULT 'routine',
		red_flag_triggered TEXT DEFAULT '',
		raw_transcript TEXT DEFAULT '[]',
		status VARCHAR(50) DEFAULT 'queued',
		doctor_reply TEXT DEFAULT '',
		doctor_outcome VARCHAR(50) DEFAULT '',
		assigned_doctor_id VARCHAR(36) DEFAULT '',
		created_at TIMESTAMPTZ DEFAULT NOW(),
		updated_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE INDEX IF NOT EXISTS idx_cases_status ON cases(status);
	CREATE INDEX IF NOT EXISTS idx_cases_urgency ON cases(urgency_band);
	`
	_, err := db.Exec(schema)
	if err != nil {
		return fmt.Errorf("failed creating tables: %w", err)
	}

	log.Println("[INFO] Database schema verified & migrated.")
	return nil
}

// Token Blacklist helper
var (
	revokedTokens = make(map[string]time.Time)
	tokenLock     sync.RWMutex
)

func RevokeToken(token string) {
	tokenLock.Lock()
	defer tokenLock.Unlock()
	revokedTokens[token] = time.Now()

	if GlobalDB != nil && !GlobalDB.IsInMemory && GlobalDB.SQLDB != nil {
		_, _ = GlobalDB.SQLDB.Exec("INSERT INTO revoked_tokens (token, revoked_at) VALUES ($1, $2) ON CONFLICT DO NOTHING", token, time.Now())
	}
}

func IsTokenRevoked(token string) bool {
	tokenLock.RLock()
	if _, exists := revokedTokens[token]; exists {
		tokenLock.RUnlock()
		return true
	}
	tokenLock.RUnlock()

	if GlobalDB != nil && !GlobalDB.IsInMemory && GlobalDB.SQLDB != nil {
		var exists bool
		err := GlobalDB.SQLDB.QueryRow("SELECT EXISTS(SELECT 1 FROM revoked_tokens WHERE token=$1)", token).Scan(&exists)
		if err == nil && exists {
			return true
		}
	}
	return false
}
