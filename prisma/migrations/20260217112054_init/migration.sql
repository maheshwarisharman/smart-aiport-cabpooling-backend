-- CreateTable
CREATE TABLE "Users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gender" TEXT NOT NULL,
    "age" INTEGER NOT NULL,

    CONSTRAINT "Users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Drivers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gender" TEXT NOT NULL,
    "age" INTEGER NOT NULL,

    CONSTRAINT "Drivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cabs" (
    "id" TEXT NOT NULL,
    "cab_number" TEXT NOT NULL,
    "cab_type" TEXT NOT NULL,
    "no_of_seats" INTEGER NOT NULL,
    "luggage_capacity" INTEGER NOT NULL,
    "driver_id" TEXT NOT NULL,

    CONSTRAINT "Cabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trips" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "fare_each" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cab_id" TEXT NOT NULL,

    CONSTRAINT "Trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideRequests" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "no_of_passengers" INTEGER NOT NULL,
    "luggage_capacity" INTEGER NOT NULL,
    "issued_price" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "trip_id" TEXT NOT NULL,

    CONSTRAINT "RideRequests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideShare" (
    "id" TEXT NOT NULL,
    "rideRequest_id" TEXT NOT NULL,
    "shared_user_id" TEXT NOT NULL,

    CONSTRAINT "RideShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_email_key" ON "Users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Drivers_email_key" ON "Drivers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Cabs_cab_number_key" ON "Cabs"("cab_number");

-- CreateIndex
CREATE UNIQUE INDEX "Cabs_driver_id_key" ON "Cabs"("driver_id");

-- AddForeignKey
ALTER TABLE "Cabs" ADD CONSTRAINT "Cabs_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "Drivers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trips" ADD CONSTRAINT "Trips_cab_id_fkey" FOREIGN KEY ("cab_id") REFERENCES "Cabs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequests" ADD CONSTRAINT "RideRequests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideRequests" ADD CONSTRAINT "RideRequests_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "Trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideShare" ADD CONSTRAINT "RideShare_rideRequest_id_fkey" FOREIGN KEY ("rideRequest_id") REFERENCES "RideRequests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideShare" ADD CONSTRAINT "RideShare_shared_user_id_fkey" FOREIGN KEY ("shared_user_id") REFERENCES "Users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
