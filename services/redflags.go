package services

import (
	"strings"
)

type RedFlagRule struct {
	Keywords []string
	Name     string
}

var redFlagRules = []RedFlagRule{
	{
		Keywords: []string{"chest pain", "sweating", "left arm pain", "heart attack"},
		Name:     "Chest pain with cardiac warning signs",
	},
	{
		Keywords: []string{"difficulty breathing", "cannot breathe", "can't breathe", "gasping", "suffocating"},
		Name:     "Severe respiratory distress",
	},
	{
		Keywords: []string{"heavy bleeding", "bleeding profusely", "gushing blood", "uncontrolled bleeding"},
		Name:     "Uncontrolled acute hemorrhage",
	},
	{
		Keywords: []string{"convulsion", "seizure", "unresponsive", "fainted", "unconscious"},
		Name:     "Neurological emergency or unresponsiveness",
	},
	{
		Keywords: []string{"infant fever", "newborn fever", "baby hot fever"},
		Name:     "High fever in infant under two months",
	},
	{
		Keywords: []string{"stroke", "slurred speech", "face drooping", "numbness one side"},
		Name:     "Acute stroke signs",
	},
}

// CheckRedFlags scans patient text before calling LLM
func CheckRedFlags(message string) (bool, string) {
	lowerMsg := strings.ToLower(message)
	for _, rule := range redFlagRules {
		for _, kw := range rule.Keywords {
			if strings.Contains(lowerMsg, kw) {
				return true, rule.Name
			}
		}
	}
	return false, ""
}
