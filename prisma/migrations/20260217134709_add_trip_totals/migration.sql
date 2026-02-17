-- AlterTable
ALTER TABLE "Trips" ADD COLUMN     "no_of_passengers" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_luggage" INTEGER NOT NULL DEFAULT 0;
