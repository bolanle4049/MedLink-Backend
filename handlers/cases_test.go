package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"medlink_backend/config"
	"medlink_backend/database"
	"medlink_backend/handlers"
	"medlink_backend/middleware"
)

func setupFullTestApp() (*gin.Engine, string) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{
		Port:        "8080",
		JWTSecret:   "test-secret-key-cases-9999",
		Environment: "test",
	}

	database.InitDB(cfg)

	r := gin.New()
	authHandler := handlers.NewAuthHandler(cfg)
	twilioHandler := handlers.NewTwilioHandler(cfg)
	casesHandler := handlers.NewCasesHandler(cfg)

	// Auth
	r.POST("/api/auth/register", authHandler.Register)
	r.POST("/api/auth/login", authHandler.Login)
	r.POST("/api/auth/admin/verify", authHandler.AdminVerifyDoctor)

	// Twilio
	r.POST("/api/twilio/simulate-patient", twilioHandler.SimulatePatient)

	// Cases
	casesGroup := r.Group("/api/cases")
	casesGroup.Use(middleware.AuthMiddleware(cfg))
	{
		casesGroup.GET("", casesHandler.GetQueue)
		casesGroup.GET("/:id", casesHandler.GetByID)
		casesGroup.POST("/:id/reply", casesHandler.DoctorReply)
	}

	// Register & Login Doctor to get session token
	docEmail := "dr.testcases@hospital.org"
	regBody, _ := json.Marshal(gin.H{
		"email":              docEmail,
		"password":           "Password123!",
		"fullName":           "Dr. Test Cases",
		"medicalCredentials": "MD License 123",
	})
	wReg := httptest.NewRecorder()
	reqReg, _ := http.NewRequest("POST", "/api/auth/register", bytes.NewBuffer(regBody))
	reqReg.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(wReg, reqReg)

	// Verify doctor
	vBody, _ := json.Marshal(gin.H{"email": docEmail, "isVerified": true})
	wV := httptest.NewRecorder()
	reqV, _ := http.NewRequest("POST", "/api/auth/admin/verify", bytes.NewBuffer(vBody))
	reqV.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(wV, reqV)

	// Login doctor
	loginBody, _ := json.Marshal(gin.H{"email": docEmail, "password": "Password123!"})
	wL := httptest.NewRecorder()
	reqL, _ := http.NewRequest("POST", "/api/auth/login", bytes.NewBuffer(loginBody))
	reqL.Header.Set("Content-Type", "application/json")
	r.ServeHTTP(wL, reqL)

	var res map[string]interface{}
	_ = json.Unmarshal(wL.Body.Bytes(), &res)
	token := res["sessionToken"].(string)

	return r, token
}

func TestPatientToDoctorPipeline(t *testing.T) {
	router, doctorToken := setupFullTestApp()
	patientPhone := "whatsapp:+2348123456789"

	// 1. Simulate Routine Patient Chat
	t.Run("Patient Routine Intake", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"patientPhone": patientPhone,
			"message":      "My name is John Doe, I am 35 years old male. I have stomach cramps for 2 days.",
		})

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/twilio/simulate-patient", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 2. Simulate Red Flag Emergency Patient Chat
	emergencyPhone := "whatsapp:+2348999999999"
	t.Run("Patient Red Flag Emergency Intake", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"patientPhone": emergencyPhone,
			"message":      "Help! I have severe chest pain and sweating profusely!",
		})

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/twilio/simulate-patient", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d", w.Code)
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		caseObj := res["case"].(map[string]interface{})
		if caseObj["urgencyBand"] != "critical" {
			t.Errorf("Expected urgencyBand 'critical', got %v", caseObj["urgencyBand"])
		}
	})

	// 3. Doctor Dashboard Queue Fetch (GET /api/cases)
	var criticalCaseID string
	t.Run("Doctor Dashboard Queue Ordering", func(t *testing.T) {
		w := httptest.NewRecorder()
		req, _ := http.NewRequest("GET", "/api/cases", nil)
		req.Header.Set("Authorization", "Bearer "+doctorToken)
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		cases := res["cases"].([]interface{})
		if len(cases) < 2 {
			t.Fatalf("Expected at least 2 cases in queue, got %d", len(cases))
		}

		firstCase := cases[0].(map[string]interface{})
		if firstCase["urgencyBand"] != "critical" {
			t.Errorf("Expected first case in queue to be 'critical', got %v", firstCase["urgencyBand"])
		}
		criticalCaseID = firstCase["id"].(string)
	})

	// 4. Doctor Reply to Patient (POST /api/cases/:id/reply)
	t.Run("Doctor Reply via Twilio", func(t *testing.T) {
		replyBody, _ := json.Marshal(gin.H{
			"responseMessage": "Please go directly to St. Jude Emergency Room. An ambulance is alerted.",
			"outcome":         "needs_visit",
		})

		w := httptest.NewRecorder()
		req, _ := http.NewRequest("POST", "/api/cases/"+criticalCaseID+"/reply", bytes.NewBuffer(replyBody))
		req.Header.Set("Authorization", "Bearer "+doctorToken)
		req.Header.Set("Content-Type", "application/json")
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		caseObj := res["case"].(map[string]interface{})
		if caseObj["status"] != "needs_visit" {
			t.Errorf("Expected status 'needs_visit', got %v", caseObj["status"])
		}
	})
}
