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

func setupAuthTestRouter() (*gin.Engine, *config.Config) {
	gin.SetMode(gin.TestMode)
	cfg := &config.Config{
		Port:        "8080",
		JWTSecret:   "test-secret-key-auth-suite-12345",
		Environment: "test",
	}

	database.InitDB(cfg)

	r := gin.New()
	authHandler := handlers.NewAuthHandler(cfg)

	api := r.Group("/api/auth")
	{
		api.POST("/register", authHandler.Register)
		api.POST("/login", authHandler.Login)
		api.POST("/admin/verify", authHandler.AdminVerifyDoctor)

		protected := api.Group("")
		protected.Use(middleware.AuthMiddleware(cfg))
		{
			protected.GET("/me", authHandler.Me)
			protected.POST("/logout", authHandler.Logout)
		}
	}

	return r, cfg
}

func TestCompleteAuthSuite(t *testing.T) {
	router, _ := setupAuthTestRouter()

	testEmail := "doctor.johnson@medlink.org"
	testPassword := "SuperSecret123!"
	testFullName := "Dr. Alex Johnson"
	testCreds := "MD - Cardiology, License #CARD-998877"

	// 1. Test Doctor Registration (POST /api/auth/register)
	t.Run("1. Register Doctor (Creates Unverified Account)", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"email":              testEmail,
			"password":           testPassword,
			"fullName":           testFullName,
			"medicalCredentials": testCreds,
		})

		req, _ := http.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("Expected status 201 Created, got %d. Body: %s", w.Code, w.Body.String())
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		if res["step"] != "manual_verification_pending" {
			t.Errorf("Expected step 'manual_verification_pending', got %v", res["step"])
		}

		doctorData := res["doctor"].(map[string]interface{})
		if doctorData["isVerified"] != false {
			t.Errorf("Expected isVerified to be false upon registration, got %v", doctorData["isVerified"])
		}
	})

	// 2. Test Duplicate Email Registration (Must return 409 Conflict)
	t.Run("2. Register Duplicate Email (Must Fail 409)", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"email":              testEmail,
			"password":           testPassword,
			"fullName":           testFullName,
			"medicalCredentials": testCreds,
		})

		req, _ := http.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusConflict {
			t.Fatalf("Expected status 409 Conflict for duplicate email, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 3. Test Login with Wrong Password (Must return 401 Unauthorized)
	t.Run("3. Login Wrong Password (Must Fail 401)", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"email":    testEmail,
			"password": "WrongPassword123!",
		})

		req, _ := http.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusUnauthorized {
			t.Fatalf("Expected 401 Unauthorized for wrong password, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 4. Test Login Unverified Doctor (Must return 403 Forbidden)
	t.Run("4. Login Unverified Doctor (Must Fail 403)", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"email":    testEmail,
			"password": testPassword,
		})

		req, _ := http.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("Expected 403 Forbidden for unverified doctor, got %d. Body: %s", w.Code, w.Body.String())
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		if res["error"] != "account_unverified" {
			t.Errorf("Expected error code 'account_unverified', got %v", res["error"])
		}
	})

	// 5. Admin Approves Doctor (POST /api/auth/admin/verify)
	t.Run("5. Admin Verify Doctor Account", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"email":      testEmail,
			"isVerified": true,
		})

		req, _ := http.NewRequest(http.MethodPost, "/api/auth/admin/verify", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 6. Test Login Verified Doctor (Must return 200 OK + JWT + HTTP-only Cookie)
	var sessionToken string
	var authCookie *http.Cookie

	t.Run("6. Login Verified Doctor (Must Succeed 200)", func(t *testing.T) {
		body, _ := json.Marshal(gin.H{
			"email":    testEmail,
			"password": testPassword,
		})

		req, _ := http.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewBuffer(body))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)

		token, ok := res["sessionToken"].(string)
		if !ok || token == "" {
			t.Fatalf("Expected non-empty sessionToken in JSON response")
		}
		sessionToken = token

		for _, c := range w.Result().Cookies() {
			if c.Name == "auth_token" {
				authCookie = c
				break
			}
		}
		if authCookie == nil {
			t.Fatalf("Expected HTTP-Only cookie 'auth_token' to be set in response")
		}
	})

	// 7. Validate Session via GET /api/auth/me using Cookie
	t.Run("7. Session Validation via HTTP-Only Cookie", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.AddCookie(authCookie)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}

		var res map[string]interface{}
		_ = json.Unmarshal(w.Body.Bytes(), &res)
		doctorData := res["doctor"].(map[string]interface{})
		if doctorData["email"] != testEmail {
			t.Errorf("Expected doctor email %s, got %v", testEmail, doctorData["email"])
		}
	})

	// 8. Validate Session via GET /api/auth/me using Bearer Header
	t.Run("8. Session Validation via Authorization Bearer Header", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, "/api/auth/me", nil)
		req.Header.Set("Authorization", "Bearer "+sessionToken)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK, got %d. Body: %s", w.Code, w.Body.String())
		}
	})

	// 9. Test Logout (POST /api/auth/logout)
	t.Run("9. Logout (Destroys Session Token)", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodPost, "/api/auth/logout", nil)
		req.Header.Set("Authorization", "Bearer "+sessionToken)
		req.AddCookie(authCookie)
		w := httptest.NewRecorder()

		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("Expected 200 OK for logout, got %d. Body: %s", w.Code, w.Body.String())
		}

		// Subsequent GET /api/auth/me with revoked token must return 401 Unauthorized
		reqMe, _ := http.NewRequest(http.MethodGet, "/api/auth/me", nil)
		reqMe.Header.Set("Authorization", "Bearer "+sessionToken)
		wMe := httptest.NewRecorder()

		router.ServeHTTP(wMe, reqMe)

		if wMe.Code != http.StatusUnauthorized {
			t.Fatalf("Expected 401 Unauthorized after logout, got %d. Body: %s", wMe.Code, wMe.Body.String())
		}
	})
}
