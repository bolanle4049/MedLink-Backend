import { PrismaClient } from '@prisma/client';
import config from '../config';

export class DB {
  public prisma: PrismaClient | null = null;
  public isInMemory: boolean = true;
  public memoryStore = {
    doctorsByID: new Map<string, any>(),
    doctorsByEmail: new Map<string, any>(),
    casesByID: new Map<string, any>(),
    activeCasesByPhone: new Map<string, any>(),
    revokedTokens: new Set<string>(),
    // Generic collections keyed by prisma model name (camelCase)
    collections: new Map<string, Map<string, any>>()
  };

  collection(name: string): Map<string, any> {
    if (!this.memoryStore.collections.has(name)) {
      this.memoryStore.collections.set(name, new Map<string, any>());
    }
    return this.memoryStore.collections.get(name)!;
  }

  usePrisma(): boolean {
    return Boolean(this.prisma) && !this.isInMemory;
  }

  async init(): Promise<void> {
    try {
      this.prisma = new PrismaClient({
        datasources: {
          db: {
            url: config.databaseUrl
          }
        }
      });

      // Quick test query
      await this.prisma.$connect();

      this.isInMemory = false;
      console.log('[INFO] Connected to PostgreSQL via Prisma Client successfully.');
    } catch (err: any) {
      console.log(`[WARN] PostgreSQL connection failed (${err.message}). Falling back to Hackathon In-Memory Data Store.`);
      this.isInMemory = true;
      this.prisma = null;
    }
  }

  async revokeToken(token: string): Promise<void> {
    if (!token) return;
    this.memoryStore.revokedTokens.add(token);

    if (this.prisma && !this.isInMemory) {
      try {
        await this.prisma.revokedToken.upsert({
          where: { token },
          update: {},
          create: { token, revokedAt: new Date() }
        });
      } catch (err: any) {
        console.error('Error recording revoked token in DB:', err.message);
      }
    }
  }

  async isTokenRevoked(token: string): Promise<boolean> {
    if (!token) return false;
    if (this.memoryStore.revokedTokens.has(token)) {
      return true;
    }

    if (this.prisma && !this.isInMemory) {
      try {
        const found = await this.prisma.revokedToken.findUnique({
          where: { token }
        });
        return Boolean(found);
      } catch (err) {
        return false;
      }
    }

    return false;
  }
}

export const globalDB = new DB();
export default globalDB;
