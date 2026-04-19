-- CreateEnum
CREATE TYPE "QuestionExposureMode" AS ENUM ('PRACTICE', 'EXAM');

-- CreateTable
CREATE TABLE "QuestionExposure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "firstServedAt" TIMESTAMP(3) NOT NULL,
    "lastServedAt" TIMESTAMP(3) NOT NULL,
    "timesServed" INTEGER NOT NULL DEFAULT 1,
    "lastServedMode" "QuestionExposureMode" NOT NULL,
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionExposure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionExposure_userId_questionId_key" ON "QuestionExposure"("userId", "questionId");

-- CreateIndex
CREATE INDEX "QuestionExposure_userId_hiddenAt_idx" ON "QuestionExposure"("userId", "hiddenAt");

-- CreateIndex
CREATE INDEX "QuestionExposure_questionId_idx" ON "QuestionExposure"("questionId");

-- AddForeignKey
ALTER TABLE "QuestionExposure" ADD CONSTRAINT "QuestionExposure_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionExposure" ADD CONSTRAINT "QuestionExposure_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

WITH "historical_events" AS (
    SELECT
        "userId",
        "questionId",
        "createdAt" AS "servedAt",
        'PRACTICE'::"QuestionExposureMode" AS "servedMode"
    FROM "PracticeAttempt"

    UNION ALL

    SELECT
        "ExamSession"."userId" AS "userId",
        "ExamSessionQuestion"."questionId" AS "questionId",
        "ExamSession"."startedAt" AS "servedAt",
        'EXAM'::"QuestionExposureMode" AS "servedMode"
    FROM "ExamSessionQuestion"
    INNER JOIN "ExamSession" ON "ExamSession"."id" = "ExamSessionQuestion"."sessionId"
),
"latest_modes" AS (
    SELECT DISTINCT ON ("userId", "questionId")
        "userId",
        "questionId",
        "servedMode"
    FROM "historical_events"
    ORDER BY "userId", "questionId", "servedAt" DESC, "servedMode" DESC
),
"aggregated" AS (
    SELECT
        "userId",
        "questionId",
        MIN("servedAt") AS "firstServedAt",
        MAX("servedAt") AS "lastServedAt",
        COUNT(*)::INTEGER AS "timesServed"
    FROM "historical_events"
    GROUP BY "userId", "questionId"
)
INSERT INTO "QuestionExposure" (
    "id",
    "userId",
    "questionId",
    "firstServedAt",
    "lastServedAt",
    "timesServed",
    "lastServedMode",
    "createdAt",
    "updatedAt"
)
SELECT
    md5("aggregated"."userId" || ':' || "aggregated"."questionId") AS "id",
    "aggregated"."userId",
    "aggregated"."questionId",
    "aggregated"."firstServedAt",
    "aggregated"."lastServedAt",
    "aggregated"."timesServed",
    "latest_modes"."servedMode",
    "aggregated"."firstServedAt",
    "aggregated"."lastServedAt"
FROM "aggregated"
INNER JOIN "latest_modes"
    ON "latest_modes"."userId" = "aggregated"."userId"
   AND "latest_modes"."questionId" = "aggregated"."questionId";
