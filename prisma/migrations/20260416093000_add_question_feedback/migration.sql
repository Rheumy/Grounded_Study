-- CreateEnum
CREATE TYPE "QuestionFeedbackLabel" AS ENUM ('EASY', 'HARD', 'DISPUTED_INCORRECT');

-- CreateTable
CREATE TABLE "QuestionFeedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "attemptId" TEXT,
    "label" "QuestionFeedbackLabel" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionFeedback_userId_questionId_key" ON "QuestionFeedback"("userId", "questionId");

-- CreateIndex
CREATE INDEX "QuestionFeedback_questionId_idx" ON "QuestionFeedback"("questionId");

-- CreateIndex
CREATE INDEX "QuestionFeedback_attemptId_idx" ON "QuestionFeedback"("attemptId");

-- AddForeignKey
ALTER TABLE "QuestionFeedback" ADD CONSTRAINT "QuestionFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionFeedback" ADD CONSTRAINT "QuestionFeedback_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;
