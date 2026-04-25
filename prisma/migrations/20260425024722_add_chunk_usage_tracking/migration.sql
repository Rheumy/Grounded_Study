-- CreateTable
CREATE TABLE "ChunkUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChunkUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChunkUsage_userId_documentId_idx" ON "ChunkUsage"("userId", "documentId");

-- CreateIndex
CREATE INDEX "ChunkUsage_chunkId_idx" ON "ChunkUsage"("chunkId");
