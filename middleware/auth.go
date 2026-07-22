package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"medlink_backend/config"
	"medlink_backend/database"
	"medlink_backend/utils"
)

func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		var tokenString string

		// 1. Try to read from HTTP-only cookie 'auth_token'
		cookieToken, err := c.Cookie("auth_token")
		if err == nil && strings.TrimSpace(cookieToken) != "" {
			tokenString = cookieToken
		}

		// 2. Fallback to Authorization: Bearer <token> header
		if tokenString == "" {
			authHeader := c.GetHeader("Authorization")
			if authHeader != "" {
				parts := strings.Fields(authHeader)
				if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") {
					tokenString = parts[1]
				}
			}
		}

		if tokenString == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Missing authentication session token or Authorization header",
			})
			return
		}

		// Check if token was revoked via logout
		if database.IsTokenRevoked(tokenString) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Session has been logged out",
			})
			return
		}

		claims, err := utils.ValidateToken(tokenString, cfg.JWTSecret)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"error":   "unauthorized",
				"message": "Invalid or expired session token",
			})
			return
		}

		c.Set("doctor_id", claims.DoctorID)
		c.Set("email", claims.Email)
		c.Set("session_token", tokenString)
		c.Next()
	}
}
