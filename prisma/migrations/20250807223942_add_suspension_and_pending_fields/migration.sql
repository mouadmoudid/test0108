-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityType" ADD VALUE 'ORDER_DELIVERED';
ALTER TYPE "ActivityType" ADD VALUE 'ORDER_PENDING';
ALTER TYPE "ActivityType" ADD VALUE 'ORDER_CONFIRMED';
ALTER TYPE "ActivityType" ADD VALUE 'CUSTOMER_ADDED';
ALTER TYPE "ActivityType" ADD VALUE 'CUSTOMER_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'CUSTOMER_DELETED';
ALTER TYPE "ActivityType" ADD VALUE 'DELIVERY_ASSIGNED';
ALTER TYPE "ActivityType" ADD VALUE 'DELIVERY_COMPLETED';
ALTER TYPE "ActivityType" ADD VALUE 'DELIVERY_CANCELED';
ALTER TYPE "ActivityType" ADD VALUE 'PRODUCT_CREATED';
ALTER TYPE "ActivityType" ADD VALUE 'PRODUCT_ADDED';
ALTER TYPE "ActivityType" ADD VALUE 'PRODUCT_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'PRODUCT_DELETED';
ALTER TYPE "ActivityType" ADD VALUE 'ADDRESS_ADDED';
ALTER TYPE "ActivityType" ADD VALUE 'ADDRESS_UPDATED';
ALTER TYPE "ActivityType" ADD VALUE 'ADDRESS_DELETED';
ALTER TYPE "ActivityType" ADD VALUE 'ANALYTICS_GENERATED';

-- AlterEnum
ALTER TYPE "LaundryStatus" ADD VALUE 'PENDING';

-- AlterTable
ALTER TABLE "laundries" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "emailVerified" TIMESTAMP(3),
ADD COLUMN     "image" TEXT,
ADD COLUMN     "password" TEXT,
ADD COLUMN     "suspendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "laundry_suspensions" (
    "id" TEXT NOT NULL,
    "laundryId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "suspendedBy" TEXT NOT NULL,
    "suspendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "liftedAt" TIMESTAMP(3),
    "liftedBy" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "laundry_suspensions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_provider_providerAccountId_key" ON "accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionToken_key" ON "sessions"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_token_key" ON "verification_tokens"("token");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "laundry_suspensions" ADD CONSTRAINT "laundry_suspensions_laundryId_fkey" FOREIGN KEY ("laundryId") REFERENCES "laundries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
