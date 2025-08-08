/*
  Warnings:

  - Added the required column `updatedAt` to the `laundry_suspensions` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "laundry_suspensions" DROP CONSTRAINT "laundry_suspensions_laundryId_fkey";

-- AlterTable
ALTER TABLE "laundry_suspensions" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AddForeignKey
ALTER TABLE "laundry_suspensions" ADD CONSTRAINT "laundry_suspensions_laundryId_fkey" FOREIGN KEY ("laundryId") REFERENCES "laundries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
