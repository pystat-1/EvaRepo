-- AlterTable
ALTER TABLE "accounts" ADD COLUMN "googleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "accounts_googleId_key" ON "accounts"("googleId");
