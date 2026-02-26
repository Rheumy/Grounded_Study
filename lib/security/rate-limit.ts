import { LRUCache } from "lru-cache";
import { prisma } from "@/lib/db/prisma";

const localCache = new LRUCache<string, { count: number; resetAt: number }>({ max: 1000 });

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
};

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const now = Date.now();
  if (process.env.NODE_ENV !== "production") {
    const existing = localCache.get(key);
    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowMs;
      localCache.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt: new Date(resetAt) };
    }
    if (existing.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: new Date(existing.resetAt) };
    }
    existing.count += 1;
    localCache.set(key, existing);
    return { allowed: true, remaining: limit - existing.count, resetAt: new Date(existing.resetAt) };
  }

  const resetAt = new Date(now + windowMs);
  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.rateLimit.findUnique({ where: { key } });
    if (!record || record.resetAt.getTime() <= now) {
      const created = await tx.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, resetAt },
        update: { count: 1, resetAt }
      });
      return { allowed: true, remaining: limit - 1, resetAt: created.resetAt } as RateLimitResult;
    }
    if (record.count >= limit) {
      return { allowed: false, remaining: 0, resetAt: record.resetAt } as RateLimitResult;
    }
    const updated = await tx.rateLimit.update({
      where: { key },
      data: { count: { increment: 1 } }
    });
    return {
      allowed: true,
      remaining: Math.max(0, limit - updated.count),
      resetAt: updated.resetAt
    } as RateLimitResult;
  });

  return result;
}
