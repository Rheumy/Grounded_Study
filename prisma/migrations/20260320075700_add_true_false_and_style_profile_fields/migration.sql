-- Add TRUE_FALSE to QuestionType enum
-- PostgreSQL allows additive enum changes without rebuilding dependent tables.
ALTER TYPE "QuestionType" ADD VALUE 'TRUE_FALSE';

-- Add instructionsText column to StyleProfile (nullable, no backfill needed)
ALTER TABLE "StyleProfile" ADD COLUMN "instructionsText" TEXT;

-- Add sampleFilesText column to StyleProfile (nullable, no backfill needed)
ALTER TABLE "StyleProfile" ADD COLUMN "sampleFilesText" TEXT;
