import { v4 as uuidv4 } from 'uuid';
import globalDB from './db';

/**
 * Generic repository that transparently persists to Prisma when a database
 * connection is available, otherwise falls back to the in-memory store.
 *
 * The `modelName` MUST match the camelCase Prisma client accessor
 * (e.g. "episode" -> prisma.episode) and the in-memory collection name.
 */
export class Repository<T extends { id: string }> {
  constructor(private readonly modelName: string) {}

  private prismaModel(): any {
    return (globalDB.prisma as any)?.[this.modelName];
  }

  async create(data: Partial<T>): Promise<T> {
    const record = { ...data } as T;
    if (!record.id) {
      (record as any).id = uuidv4();
    }

    if (globalDB.usePrisma()) {
      return (await this.prismaModel().create({ data: record })) as T;
    }

    globalDB.collection(this.modelName).set(record.id, record);
    return record;
  }

  async findById(id: string): Promise<T | null> {
    if (globalDB.usePrisma()) {
      return (await this.prismaModel().findUnique({ where: { id } })) as T | null;
    }
    return globalDB.collection(this.modelName).get(id) || null;
  }

  async findFirst(where: Partial<T>, orderByCreatedDesc = false): Promise<T | null> {
    if (globalDB.usePrisma()) {
      const args: any = { where };
      if (orderByCreatedDesc) args.orderBy = { createdAt: 'desc' };
      return (await this.prismaModel().findFirst(args)) as T | null;
    }
    const matches = this.memoryFilter(where);
    if (orderByCreatedDesc) {
      matches.sort((a, b) => this.createdAt(b) - this.createdAt(a));
    }
    return matches[0] || null;
  }

  async findMany(where: Partial<T> = {}): Promise<T[]> {
    if (globalDB.usePrisma()) {
      return (await this.prismaModel().findMany({ where })) as T[];
    }
    return this.memoryFilter(where);
  }

  async update(id: string, data: Partial<T>): Promise<T> {
    if (globalDB.usePrisma()) {
      return (await this.prismaModel().update({ where: { id }, data })) as T;
    }
    const existing = globalDB.collection(this.modelName).get(id);
    if (!existing) {
      throw new Error(`${this.modelName} not found`);
    }
    const merged = { ...existing, ...data };
    globalDB.collection(this.modelName).set(id, merged);
    return merged as T;
  }

  private memoryFilter(where: Partial<T>): T[] {
    const out: T[] = [];
    for (const rec of globalDB.collection(this.modelName).values()) {
      let ok = true;
      for (const [k, v] of Object.entries(where)) {
        if ((rec as any)[k] !== v) {
          ok = false;
          break;
        }
      }
      if (ok) out.push(rec);
    }
    return out;
  }

  private createdAt(rec: any): number {
    const d = rec?.createdAt;
    return d ? new Date(d).getTime() : 0;
  }
}
