package services

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"medlink_backend/config"
)

type TwilioService struct {
	Config *config.Config
}

func NewTwilioService(cfg *config.Config) *TwilioService {
	return &TwilioService{Config: cfg}
}

// SendWhatsAppMessage sends standard outbound free-form WhatsApp message via Twilio REST API
func (t *TwilioService) SendWhatsAppMessage(ctx context.Context, toPhone, messageBody string) error {
	if !strings.HasPrefix(toPhone, "whatsapp:") {
		toPhone = "whatsapp:" + toPhone
	}
	fromPhone := t.Config.TwilioWhatsAppNumber
	if !strings.HasPrefix(fromPhone, "whatsapp:") {
		fromPhone = "whatsapp:" + fromPhone
	}

	// Mock mode if Twilio Credentials are not configured
	if t.Config.TwilioAccountSID == "" || t.Config.TwilioAccountSID == "your_twilio_account_sid_here" {
		log.Printf("[MOCK TWILIO OUTBOUND WHATSAPP] To: %s | Message: %s", toPhone, messageBody)
		return nil
	}

	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", t.Config.TwilioAccountSID)

	data := url.Values{}
	data.Set("From", fromPhone)
	data.Set("To", toPhone)
	data.Set("Body", messageBody)

	return t.executeTwilioRequest(ctx, apiURL, data)
}

// SendWhatsAppTemplateMessage sends a pre-approved Twilio WhatsApp Content Template (ContentSid & ContentVariables)
func (t *TwilioService) SendWhatsAppTemplateMessage(ctx context.Context, toPhone, contentSid, contentVariablesJSON string) error {
	if !strings.HasPrefix(toPhone, "whatsapp:") {
		toPhone = "whatsapp:" + toPhone
	}
	fromPhone := t.Config.TwilioWhatsAppNumber
	if !strings.HasPrefix(fromPhone, "whatsapp:") {
		fromPhone = "whatsapp:" + fromPhone
	}

	if t.Config.TwilioAccountSID == "" || t.Config.TwilioAccountSID == "your_twilio_account_sid_here" {
		log.Printf("[MOCK TWILIO TEMPLATE WHATSAPP] To: %s | ContentSid: %s | Vars: %s", toPhone, contentSid, contentVariablesJSON)
		return nil
	}

	apiURL := fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", t.Config.TwilioAccountSID)

	data := url.Values{}
	data.Set("From", fromPhone)
	data.Set("To", toPhone)
	data.Set("ContentSid", contentSid)
	if contentVariablesJSON != "" {
		data.Set("ContentVariables", contentVariablesJSON)
	}

	return t.executeTwilioRequest(ctx, apiURL, data)
}

func (t *TwilioService) executeTwilioRequest(ctx context.Context, apiURL string, data url.Values) error {
	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, strings.NewReader(data.Encode()))
	if err != nil {
		return err
	}

	req.SetBasicAuth(t.Config.TwilioAccountSID, t.Config.TwilioAuthToken)
	req.Header.Add("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("twilio network error: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("twilio api returned status %d: %s", resp.StatusCode, string(respBody))
	}

	log.Printf("[INFO] Twilio WhatsApp API Success (Response: %s)", string(respBody))
	return nil
}

// FormatTwiMLResponse returns standard Twilio TwiML XML string for Webhook auto-replies
func FormatTwiMLResponse(messageBody string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>%s</Message></Response>`, escapeXML(messageBody))
}

func escapeXML(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}
