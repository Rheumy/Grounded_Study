-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS "vector";

-- Create enums
DO $$ BEGIN
  CREATE TYPE "PlanTier" AS ENUM ('FREE', 'PRO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED', 'TRIALING', 'INCOMPLETE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED', 'OCR_PENDING', 'OCR_DISABLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentSourceType" AS ENUM ('PDF', 'IMAGE', 'TEXT');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "QuestionType" AS ENUM ('MCQ', 'SHORT_ANSWER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "VerifierStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'INSUFFICIENT_EVIDENCE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Core tables
CREATE TABLE IF NOT EXISTS "User" (
  "id" text PRIMARY KEY,
  "name" text,
  "email" text UNIQUE,
  "emailVerified" timestamp,
  "image" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "Account" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "providerAccountId" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

CREATE TABLE IF NOT EXISTS "Session" (
  "id" text PRIMARY KEY,
  "sessionToken" text NOT NULL UNIQUE,
  "userId" text NOT NULL,
  "expires" timestamp NOT NULL,
  CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "VerificationToken" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" timestamp NOT NULL,
  CONSTRAINT "VerificationToken_token_key" UNIQUE ("token"),
  CONSTRAINT "VerificationToken_identifier_token_key" UNIQUE ("identifier", "token")
);

CREATE TABLE IF NOT EXISTS "Subscription" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
  "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "stripeCustomerId" text,
  "stripeSubId" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Subscription_userId_idx" ON "Subscription"("userId");

CREATE TABLE IF NOT EXISTS "Document" (
  "id" text PRIMARY KEY,
  "ownerId" text NOT NULL,
  "title" text NOT NULL,
  "sourceType" "DocumentSourceType" NOT NULL,
  "contentType" text NOT NULL,
  "storageKey" text NOT NULL,
  "status" "DocumentStatus" NOT NULL DEFAULT 'QUEUED',
  "pageCount" integer,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Document_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "Document_ownerId_idx" ON "Document"("ownerId");
CREATE INDEX IF NOT EXISTS "Document_status_idx" ON "Document"("status");

CREATE TABLE IF NOT EXISTS "DocumentChunk" (
  "id" text PRIMARY KEY,
  "documentId" text NOT NULL,
  "content" text NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "page" integer,
  "chunkIndex" integer NOT NULL,
  "hash" text NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "DocumentChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "DocumentChunk_documentId_idx" ON "DocumentChunk"("documentId");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentChunk_documentId_chunkIndex_key" ON "DocumentChunk"("documentId", "chunkIndex");
CREATE UNIQUE INDEX IF NOT EXISTS "DocumentChunk_documentId_hash_key" ON "DocumentChunk"("documentId", "hash");

CREATE TABLE IF NOT EXISTS "IngestionJob" (
  "id" text PRIMARY KEY,
  "documentId" text NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" integer NOT NULL DEFAULT 0,
  "lastError" text,
  "lockedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "IngestionJob_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "IngestionJob_status_idx" ON "IngestionJob"("status");
CREATE INDEX IF NOT EXISTS "IngestionJob_lockedAt_idx" ON "IngestionJob"("lockedAt");

CREATE TABLE IF NOT EXISTS "StyleProfile" (
  "id" text PRIMARY KEY,
  "ownerId" text NOT NULL,
  "name" text NOT NULL,
  "schemaJson" jsonb NOT NULL,
  "examplesText" text,
  "examplesImagesText" text,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "StyleProfile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "Question" (
  "id" text PRIMARY KEY,
  "ownerId" text NOT NULL,
  "styleProfileId" text,
  "difficulty" integer NOT NULL,
  "type" "QuestionType" NOT NULL,
  "stem" text NOT NULL,
  "optionsJson" jsonb,
  "answer" text NOT NULL,
  "rationale" text NOT NULL,
  "citationsJson" jsonb NOT NULL,
  "verifierStatus" "VerifierStatus" NOT NULL DEFAULT 'PENDING',
  "tagsJson" jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "Question_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "Question_styleProfileId_fkey" FOREIGN KEY ("styleProfileId") REFERENCES "StyleProfile"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "Question_ownerId_idx" ON "Question"("ownerId");
CREATE INDEX IF NOT EXISTS "Question_difficulty_idx" ON "Question"("difficulty");

CREATE TABLE IF NOT EXISTS "PracticeAttempt" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "questionId" text NOT NULL,
  "selectedAnswer" text,
  "correct" boolean NOT NULL,
  "timeSpentSec" integer NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "PracticeAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "PracticeAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "PracticeAttempt_userId_idx" ON "PracticeAttempt"("userId");
CREATE INDEX IF NOT EXISTS "PracticeAttempt_questionId_idx" ON "PracticeAttempt"("questionId");

CREATE TABLE IF NOT EXISTS "ExamSession" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "modeConfigJson" jsonb NOT NULL,
  "startedAt" timestamp NOT NULL DEFAULT now(),
  "endedAt" timestamp,
  CONSTRAINT "ExamSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "ExamSessionQuestion" (
  "id" text PRIMARY KEY,
  "sessionId" text NOT NULL,
  "questionId" text NOT NULL,
  "order" integer NOT NULL,
  "selectedAnswer" text,
  "correct" boolean,
  CONSTRAINT "ExamSessionQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExamSession"("id") ON DELETE CASCADE,
  CONSTRAINT "ExamSessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "ExamSessionQuestion_sessionId_idx" ON "ExamSessionQuestion"("sessionId");

CREATE TABLE IF NOT EXISTS "SpacedRepetitionSchedule" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "questionId" text NOT NULL,
  "dueAt" timestamp NOT NULL,
  "intervalDays" integer NOT NULL,
  "easeFactor" double precision NOT NULL,
  CONSTRAINT "SpacedRepetitionSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "SpacedRepetitionSchedule_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE,
  CONSTRAINT "SpacedRepetitionSchedule_userId_questionId_key" UNIQUE ("userId", "questionId")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" text PRIMARY KEY,
  "actorId" text NOT NULL,
  "action" text NOT NULL,
  "targetType" text NOT NULL,
  "targetId" text NOT NULL,
  "metadataJson" jsonb,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_idx" ON "AuditLog"("targetType");

CREATE TABLE IF NOT EXISTS "UsageCounter" (
  "id" text PRIMARY KEY,
  "userId" text NOT NULL,
  "day" timestamp NOT NULL,
  "uploads" integer NOT NULL DEFAULT 0,
  "questions" integer NOT NULL DEFAULT 0,
  "storageBytes" bigint NOT NULL DEFAULT 0,
  CONSTRAINT "UsageCounter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UsageCounter_userId_day_key" UNIQUE ("userId", "day")
);

CREATE TABLE IF NOT EXISTS "RateLimit" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL DEFAULT 0,
  "resetAt" timestamp NOT NULL
);

-- Vector index placeholder (ivfflat) - created after data load to avoid slow inserts
-- CREATE INDEX document_chunk_embedding_idx ON "DocumentChunk" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
