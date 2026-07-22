package config

import (
	"os"
	"github.com/joho/godotenv"
)

type Config struct {
	Port                 string
	DatabaseURL          string
	JWTSecret            string
	Environment          string
	TwilioAccountSID     string
	TwilioAuthToken      string
	TwilioWhatsAppNumber string
	AIAPIKey             string
}

func LoadConfig() *Config {
	_ = godotenv.Load()

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://postgres:postgres@localhost:5432/medlink?sslmode=disable"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		jwtSecret = "medlink-hackathon-super-secret-key-2026"
	}

	env := os.Getenv("ENV")
	if env == "" {
		env = "development"
	}

	twilioSID := os.Getenv("TWILIO_ACCOUNT_SID")
	twilioToken := os.Getenv("TWILIO_AUTH_TOKEN")
	twilioNumber := os.Getenv("TWILIO_WHATSAPP_NUMBER")
	if twilioNumber == "" {
		twilioNumber = "+14155238886" // Twilio Sandbox Default
	}

	aiKey := os.Getenv("GEMINI_API_KEY")
	if aiKey == "" {
		aiKey = os.Getenv("OPENAI_API_KEY")
	}

	return &Config{
		Port:                 port,
		DatabaseURL:          dbURL,
		JWTSecret:            jwtSecret,
		Environment:          env,
		TwilioAccountSID:     twilioSID,
		TwilioAuthToken:      twilioToken,
		TwilioWhatsAppNumber: twilioNumber,
		AIAPIKey:             aiKey,
	}
}
