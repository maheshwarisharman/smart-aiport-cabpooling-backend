/*
  Warnings:

  - You are about to drop the `RideShare` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "RideShare" DROP CONSTRAINT "RideShare_rideRequest_id_fkey";

-- DropForeignKey
ALTER TABLE "RideShare" DROP CONSTRAINT "RideShare_shared_user_id_fkey";

-- DropForeignKey
ALTER TABLE "Trips" DROP CONSTRAINT "Trips_cab_id_fkey";

-- AlterTable
ALTER TABLE "RideRequests" ADD COLUMN     "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Trips" ALTER COLUMN "cab_id" DROP NOT NULL;

-- DropTable
DROP TABLE "RideShare";

-- AddForeignKey
ALTER TABLE "Trips" ADD CONSTRAINT "Trips_cab_id_fkey" FOREIGN KEY ("cab_id") REFERENCES "Cabs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
