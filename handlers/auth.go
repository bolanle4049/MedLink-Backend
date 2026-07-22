package handlers

import (
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"medlink_backend/config"
	"medlink_backend/database"
	"medlink_backend/models"
	"medlink_backend/utils"
)

type AuthHandler struct {
	Config *config.Config
}

func NewAuthHandler(cfg *config.Config) *AuthHandler {
	return &AuthHandler{Config: cfg}
}

// ── Request Structs ──

type RegisterRequest struct {
	Email              string `json:"email" form:"email" binding:"required,email"`
	Password           string `json:"password" form:"password" binding:"required,min=6"`
	FullName           string `json:"fullName" form:"fullName" binding:"required"`
	MedicalCredentials string `json:"medicalCredentials" form:"medicalCredentials"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type VerifyDoctorRequest struct {
	Email      string `json:"email" binding:"required,email"`
	IsVerified *bool  `json:"isVerified"`
}

// POST /api/auth/register
func (h *AuthHandler) Register(c *gin.Context) {
	var req RegisterRequest

	// Handle both JSON and Multipart Form Data (for uploaded credential files)
	contentType := c.GetHeader("Content-Type")
	if strings.Contains(contentType, "multipart/form-data") {
		if err := c.ShouldBind(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
			return
		}

		// Handle file upload if medicalCredentials file was sent
		file, header, err := c.Request.FormFile("medicalCredentials")
		if err == nil && file != nil {
			defer file.Close()
			ext := filepath.Ext(header.Filename)
			fileName := fmt.Sprintf("credentials_%s%s", uuid.New().String()[:8], ext)
			filePath := filepath.Join("uploads", fileName)

			if saveErr := c.SaveUploadedFile(header, filePath); saveErr == nil {
				req.MedicalCredentials = filePath
			} else {
				// Fallback to text info
				req.MedicalCredentials = header.Filename
			}
		}
	} else {
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
			return
		}
	}

	if strings.TrimSpace(req.MedicalCredentials) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": "medicalCredentials is required"})
		return
	}

	// Hash password
	passwordHash, err := utils.HashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error", "message": "Failed to hash password"})
		return
	}

	// Create doctor account
	doctor, err := models.CreateDoctor(c.Request.Context(), req.Email, passwordHash, req.FullName, req.MedicalCredentials)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "registration_failed", "message": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Registration successful. Your account is pending manual verification.",
		"doctor":  doctor.ToResponse(),
		"step":    "manual_verification_pending",
	})
}

// POST /api/auth/login
func (h *AuthHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
		return
	}

	doctor, err := models.FindDoctorByEmail(c.Request.Context(), req.Email)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials", "message": "Invalid email or password"})
		return
	}

	// Verify password
	if !utils.CheckPasswordHash(req.Password, doctor.PasswordHash) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid_credentials", "message": "Invalid email or password"})
		return
	}

	// REQUIREMENT: Check isVerified flag before issuing token!
	if !doctor.IsVerified {
		c.JSON(http.StatusForbidden, gin.H{
			"error":      "account_unverified",
			"message":    "Account pending manual verification. Please wait for admin approval.",
			"isVerified": false,
		})
		return
	}

	if !doctor.IsActive {
		c.JSON(http.StatusForbidden, gin.H{
			"error":   "account_disabled",
			"message": "Account has been deactivated.",
		})
		return
	}

	// Generate JWT session token (valid for 24 hours)
	token, err := utils.GenerateToken(doctor.ID, doctor.Email, h.Config.JWTSecret, 24*time.Hour)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "server_error", "message": "Failed to generate session token"})
		return
	}

	// Set HTTP-only Cookie
	c.SetCookie(
		"auth_token", // Name
		token,        // Value
		86400,        // MaxAge (24 hours)
		"/",          // Path
		"",           // Domain
		false,        // Secure (false for http local dev, set true in prod)
		true,         // HttpOnly (CRITICAL for security)
	)

	c.JSON(http.StatusOK, gin.H{
		"message":      "Login successful",
		"sessionToken": token,
		"doctor":       doctor.ToResponse(),
	})
}

// GET /api/auth/me
func (h *AuthHandler) Me(c *gin.Context) {
	doctorIDVal, exists := c.Get("doctor_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": "Session invalid"})
		return
	}

	doctorID, ok := doctorIDVal.(string)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized", "message": "Invalid token subject"})
		return
	}

	doctor, err := models.FindDoctorByID(c.Request.Context(), doctorID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": "Doctor record not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"doctor": doctor.ToResponse(),
	})
}

// POST /api/auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	// Read existing token from context or headers/cookie
	tokenVal, exists := c.Get("session_token")
	if exists {
		if tokenStr, ok := tokenVal.(string); ok && tokenStr != "" {
			database.RevokeToken(tokenStr)
		}
	}

	// Clear HTTP-Only Cookie
	c.SetCookie("auth_token", "", -1, "/", "", false, true)

	c.JSON(http.StatusOK, gin.H{
		"message": "Logged out successfully",
	})
}

// POST /api/auth/admin/verify (Hackathon Demo Verification Helper)
func (h *AuthHandler) AdminVerifyDoctor(c *gin.Context) {
	var req VerifyDoctorRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad_request", "message": err.Error()})
		return
	}

	isVerified := true
	if req.IsVerified != nil {
		isVerified = *req.IsVerified
	}

	err := models.SetDoctorVerified(c.Request.Context(), req.Email, isVerified)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not_found", "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":    fmt.Sprintf("Doctor %s verification status updated to %v", req.Email, isVerified),
		"email":      req.Email,
		"isVerified": isVerified,
	})
}

// Silence unused package warning for io
var _ = io.EOF
