-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "otp_expiry" TIMESTAMP(3),
ADD COLUMN     "ride_otp" INTEGER;
