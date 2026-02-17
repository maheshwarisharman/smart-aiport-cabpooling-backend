import { prisma } from '../lib/prisma'

/**
 * Seed the database with initial users, drivers, and cabs.
 *
 * Idempotent — uses upsert so it can be run multiple times safely.
 * All data is realistic for a Delhi airport cab-pooling scenario.
 */
async function main() {
    console.log(' Seeding database...\n')

    // ── Users (fixed IDs for easy testing) ──
    const users = [
        { id: 'user-001', name: 'Aarav Sharma', email: 'aarav.sharma@gmail.com', password: 'hashed_password_1', gender: 'Male', age: 28 },
        { id: 'user-002', name: 'Priya Patel', email: 'priya.patel@gmail.com', password: 'hashed_password_2', gender: 'Female', age: 25 },
        { id: 'user-003', name: 'Rohan Gupta', email: 'rohan.gupta@gmail.com', password: 'hashed_password_3', gender: 'Male', age: 32 },
        { id: 'user-004', name: 'Ananya Singh', email: 'ananya.singh@gmail.com', password: 'hashed_password_4', gender: 'Female', age: 22 },
        { id: 'user-005', name: 'Vikram Reddy', email: 'vikram.reddy@gmail.com', password: 'hashed_password_5', gender: 'Male', age: 35 },
        { id: 'user-006', name: 'Sneha Iyer', email: 'sneha.iyer@gmail.com', password: 'hashed_password_6', gender: 'Female', age: 29 },
        { id: 'user-007', name: 'Arjun Mehta', email: 'arjun.mehta@gmail.com', password: 'hashed_password_7', gender: 'Male', age: 26 },
        { id: 'user-008', name: 'Kavya Nair', email: 'kavya.nair@gmail.com', password: 'hashed_password_8', gender: 'Female', age: 24 },
        { id: 'user-009', name: 'Rahul Verma', email: 'rahul.verma@gmail.com', password: 'hashed_password_9', gender: 'Male', age: 30 },
        { id: 'user-010', name: 'Diya Choudhury', email: 'diya.choudhury@gmail.com', password: 'hashed_password_10', gender: 'Female', age: 27 },
    ]

    console.log('👤 Seeding users...')
    for (const user of users) {
        const result = await prisma.users.upsert({
            where: { email: user.email },
            update: {},
            create: user,
        })
        console.log(`   ✓ ${result.name} (${result.id})`)
    }

    // ── Drivers (fixed IDs) ──
    const drivers = [
        { id: 'driver-001', name: 'Rajesh Kumar', email: 'rajesh.driver@gmail.com', password: 'hashed_driver_1', gender: 'Male', age: 40 },
        { id: 'driver-002', name: 'Suresh Yadav', email: 'suresh.driver@gmail.com', password: 'hashed_driver_2', gender: 'Male', age: 38 },
        { id: 'driver-003', name: 'Manoj Tiwari', email: 'manoj.driver@gmail.com', password: 'hashed_driver_3', gender: 'Male', age: 45 },
        { id: 'driver-004', name: 'Amit Chauhan', email: 'amit.driver@gmail.com', password: 'hashed_driver_4', gender: 'Male', age: 35 },
        { id: 'driver-005', name: 'Deepak Pandey', email: 'deepak.driver@gmail.com', password: 'hashed_driver_5', gender: 'Male', age: 42 },
    ]

    console.log('\n🚗 Seeding drivers...')
    const createdDrivers = []
    for (const driver of drivers) {
        const result = await prisma.drivers.upsert({
            where: { email: driver.email },
            update: {},
            create: driver,
        })
        createdDrivers.push(result)
        console.log(`   ✓ ${result.name} (${result.id})`)
    }

    // ── Cabs (fixed IDs, one per driver) ──
    const cabs = [
        { id: 'cab-001', cab_number: 'DL-01-AB-1234', cab_type: 'Sedan', no_of_seats: 3, luggage_capacity: 3, status: 'AVAILABLE' },
        { id: 'cab-002', cab_number: 'DL-02-CD-5678', cab_type: 'SUV', no_of_seats: 4, luggage_capacity: 5, status: 'AVAILABLE' },
        { id: 'cab-003', cab_number: 'DL-03-EF-9012', cab_type: 'Sedan', no_of_seats: 3, luggage_capacity: 3, status: 'AVAILABLE' },
        { id: 'cab-004', cab_number: 'DL-04-GH-3456', cab_type: 'Mini Van', no_of_seats: 6, luggage_capacity: 8, status: 'AVAILABLE' },
        { id: 'cab-005', cab_number: 'DL-05-IJ-7890', cab_type: 'Hatchback', no_of_seats: 2, luggage_capacity: 2, status: 'AVAILABLE' },
    ]

    console.log('\n Seeding cabs...')
    for (let i = 0; i < cabs.length; i++) {
        const cab = cabs[i]!
        const driver = createdDrivers[i]!

        const result = await prisma.cabs.upsert({
            where: { cab_number: cab.cab_number },
            update: {},
            create: {
                ...cab,
                driver_id: driver.id,
            },
        })
        console.log(`   ✓ ${result.cab_type} ${result.cab_number} → Driver: ${driver.name}`)
    }

    console.log('\nSeeding complete!\n')
}

main()
    .catch((e) => {
        console.error('Seed failed:', e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
