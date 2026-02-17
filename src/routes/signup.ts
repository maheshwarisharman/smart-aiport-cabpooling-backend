import { Router } from 'express';
import { prisma } from '../../lib/prisma';

const router = Router();

// ── User Sign Up ──
router.post('/user', async (req, res) => {
    try {
        const { name, email, password, gender, age } = req.body;

        const user = await prisma.users.create({
            data: {
                name,
                email,
                password,
                gender,
                age,
            },
        });

        res.status(201).json({ message: 'User created successfully', user });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Driver Sign Up ──
router.post('/driver', async (req, res) => {
    try {
        const { name, email, password, gender, age } = req.body;

        const driver = await prisma.drivers.create({
            data: {
                name,
                email,
                password,
                gender,
                age,
            },
        });

        res.status(201).json({ message: 'Driver created successfully', driver });
    } catch (error) {
        console.error('Error creating driver:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// ── Add Cab (linked to a driver) ──
router.post('/cab', async (req, res) => {
    try {
        const { cab_number, cab_type, no_of_seats, luggage_capacity, driver_id } = req.body;

        const cab = await prisma.cabs.create({
            data: {
                cab_number,
                cab_type,
                no_of_seats,
                luggage_capacity,
                driver_id,
            },
        });

        res.status(201).json({ message: 'Cab added successfully', cab });
    } catch (error) {
        console.error('Error adding cab:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

export default router;
