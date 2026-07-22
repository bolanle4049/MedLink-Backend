package services_test

import (
	"testing"
	"medlink_backend/services"
)

func TestCheckRedFlags(t *testing.T) {
	tests := []struct {
		message        string
		expectedHit    bool
		expectedRule   string
	}{
		{
			message:     "Hello, I have a mild headache",
			expectedHit: false,
		},
		{
			message:      "I have severe chest pain and I am sweating uncontrollably",
			expectedHit:  true,
			expectedRule: "Chest pain with cardiac warning signs",
		},
		{
			message:      "My brother had a seizure and is unresponsive on the floor",
			expectedHit:  true,
			expectedRule: "Neurological emergency or unresponsiveness",
		},
		{
			message:      "There is heavy bleeding from a deep leg cut",
			expectedHit:  true,
			expectedRule: "Uncontrolled acute hemorrhage",
		},
	}

	for _, tt := range tests {
		hit, rule := services.CheckRedFlags(tt.message)
		if hit != tt.expectedHit {
			t.Errorf("For message '%s': expected hit=%v, got %v", tt.message, tt.expectedHit, hit)
		}
		if tt.expectedHit && rule != tt.expectedRule {
			t.Errorf("For message '%s': expected rule '%s', got '%s'", tt.message, tt.expectedRule, rule)
		}
	}
}
