package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"

	"medlink_backend/config"
	"medlink_backend/database"
	"medlink_backend/handlers"
	"medlink_backend/middleware"
)

func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin == "" {
			origin = "*"
		}
		c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

func main() {
	cfg := config.LoadConfig()

	// Create uploads directory if not exists
	_ = os.MkdirAll("uploads", 0755)

	// Initialize Database
	database.InitDB(cfg)

	r := gin.Default()
	r.Use(CORSMiddleware())

	authHandler := handlers.NewAuthHandler(cfg)
	twilioHandler := handlers.NewTwilioHandler(cfg)
	casesHandler := handlers.NewCasesHandler(cfg)

	// Public Twilio Webhook & Simulation Routes
	twilioRoutes := r.Group("/api/twilio")
	{
		twilioRoutes.POST("/webhook", twilioHandler.Webhook)
		twilioRoutes.POST("/simulate-patient", twilioHandler.SimulatePatient)
	}

	// Doctor Auth Routes
	authRoutes := r.Group("/api/auth")
	{
		authRoutes.POST("/register", authHandler.Register)
		authRoutes.POST("/login", authHandler.Login)
		authRoutes.POST("/admin/verify", authHandler.AdminVerifyDoctor)

		protectedAuth := authRoutes.Group("")
		protectedAuth.Use(middleware.AuthMiddleware(cfg))
		{
			protectedAuth.GET("/me", authHandler.Me)
			protectedAuth.POST("/logout", authHandler.Logout)
		}
	}

	// Doctor Dashboard Triage Queue Routes (Protected by Doctor Auth JWT)
	caseRoutes := r.Group("/api/cases")
	caseRoutes.Use(middleware.AuthMiddleware(cfg))
	{
		caseRoutes.GET("", casesHandler.GetQueue)
		caseRoutes.GET("/:id", casesHandler.GetByID)
		caseRoutes.POST("/:id/override", casesHandler.OverrideUrgency)
		caseRoutes.POST("/:id/reply", casesHandler.DoctorReply)
	}

	// Health Check Endpoint
	r.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok", "service": "MedLink Backend API"})
	})

	log.Printf("==================================================")
	log.Printf("🚀 MedLink AI Triage & Doctor Auth Backend on port %s", cfg.Port)
	log.Printf("📌 Health Check: GET http://localhost:%s/health", cfg.Port)
	log.Printf("📌 Twilio Webhook: POST http://localhost:%s/api/twilio/webhook", cfg.Port)
	log.Printf("📌 Patient Simulation: POST http://localhost:%s/api/twilio/simulate-patient", cfg.Port)
	log.Printf("📌 Doctor Auth:")
	log.Printf("   POST http://localhost:%s/api/auth/register", cfg.Port)
	log.Printf("   POST http://localhost:%s/api/auth/login", cfg.Port)
	log.Printf("   GET  http://localhost:%s/api/auth/me", cfg.Port)
	log.Printf("📌 Doctor Triage Queue (For Maaz Dashboard):")
	log.Printf("   GET  http://localhost:%s/api/cases", cfg.Port)
	log.Printf("   GET  http://localhost:%s/api/cases/:id", cfg.Port)
	log.Printf("   POST http://localhost:%s/api/cases/:id/reply", cfg.Port)
	log.Printf("==================================================")

	err := r.Run(fmt.Sprintf(":%s", cfg.Port))
	if err != nil {
		log.Fatalf("Server failed to start: %v", err)
	}
}
