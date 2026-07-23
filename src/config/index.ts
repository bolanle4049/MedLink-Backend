import dotenv from 'dotenv';

dotenv.config();

export interface Config {
  port: string;
  databaseUrl: string;
  jwtSecret: string;
  env: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioWhatsAppNumber: string;
  anthropicApiKey: string;
  anthropicModel: string;
  geminiApiKey: string;
  geminiModel: string;
  aiTextProvider: string;
  aiMediaProvider: string;
}

export const config: Config = {
  port: process.env.PORT || '7000',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/medlink?sslmode=disable',
  jwtSecret: process.env.JWT_SECRET || 'medlink-hackathon-super-secret-key-2026',
  env: process.env.ENV || process.env.NODE_ENV || 'development',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || '',
  twilioWhatsAppNumber: process.env.TWILIO_WHATSAPP_NUMBER || '+14155238886',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  aiTextProvider: process.env.AI_TEXT_PROVIDER || 'anthropic',
  aiMediaProvider: process.env.AI_MEDIA_PROVIDER || 'gemini'
};

export default config;
