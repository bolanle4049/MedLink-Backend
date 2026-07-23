import dotenv from "dotenv";

dotenv.config();

export interface Config {
  port: string;
  databaseUrl: string;
  jwtSecret: string;
  env: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioWhatsAppNumber: string;
  aiApiKey: string;
  nodeEnv: string;
}

export const config: Config = {
  port: process.env.PORT || "7000",
  databaseUrl:
    process.env.DATABASE_URL ||
    "postgres://postgres:postgres@localhost:5432/medlink?sslmode=disable",
  jwtSecret:
    process.env.JWT_SECRET || "medlink-hackathon-super-secret-key-2026",
  env: process.env.ENV || process.env.NODE_ENV || "development",
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioWhatsAppNumber: process.env.TWILIO_WHATSAPP_NUMBER || "+14155238886",
  aiApiKey: process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || "",
  nodeEnv: process.env.NODE_ENV || "development",
};

export default config;
