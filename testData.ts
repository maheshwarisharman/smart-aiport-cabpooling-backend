/**
 * ─────────────────────────────────────────────────────────────
 *  Test Data — Ready-to-use payloads for testing the API
 *
 *  All user_ids match the deterministic IDs from prisma/seed.ts.
 *  Destinations are popular Delhi landmarks near the airport route.
 * ─────────────────────────────────────────────────────────────
 *
 *  USAGE:
 *
 *  1. WebSocket (connect + send REGISTER_RIDE):
 *     → Connect:  ws://localhost:3001/ws?userId=user-001
 *     → Send:     { "type": "REGISTER_RIDE", "no_of_passengers": 1, "luggage": 1, "latitude": 28.6562, "longitude": 77.2410 }
 *
 *  2. HTTP (POST /find-ride/trips):
 *     → POST http://localhost:3000/find-ride/trips
 *     → Body: { "user_id": "user-001" }
 * ─────────────────────────────────────────────────────────────
 */

// ── Seeded User IDs (from prisma/seed.ts) ──
export const USERS = {
    AARAV: 'user-001',  // Aarav Sharma  (Male, 28)
    PRIYA: 'user-002',  // Priya Patel   (Female, 25)
    ROHAN: 'user-003',  // Rohan Gupta   (Male, 32)
    ANANYA: 'user-004',  // Ananya Singh  (Female, 22)
    VIKRAM: 'user-005',  // Vikram Reddy  (Male, 35)
    SNEHA: 'user-006',  // Sneha Iyer    (Female, 29)
    ARJUN: 'user-007',  // Arjun Mehta   (Male, 26)
    KAVYA: 'user-008',  // Kavya Nair    (Female, 24)
    RAHUL: 'user-009',  // Rahul Verma   (Male, 30)
    DIYA: 'user-010',  // Diya Choudhury(Female, 27)
} as const

// ── Seeded Driver IDs ──
export const DRIVERS = {
    RAJESH: 'driver-001',  // Rajesh Kumar  — Sedan   DL-01-AB-1234
    SURESH: 'driver-002',  // Suresh Yadav  — SUV     DL-02-CD-5678
    MANOJ: 'driver-003',  // Manoj Tiwari  — Sedan   DL-03-EF-9012
    AMIT: 'driver-004',  // Amit Chauhan  — MiniVan DL-04-GH-3456
    DEEPAK: 'driver-005',  // Deepak Pandey — Hatch   DL-05-IJ-7890
} as const

// ── Seeded Cab IDs ──
export const CABS = {
    SEDAN_1: 'cab-001',
    SUV: 'cab-002',
    SEDAN_2: 'cab-003',
    MINI_VAN: 'cab-004',
    HATCH: 'cab-005',
} as const


// ─────────────────────────────────────────────────────────────
//  WebSocket Test Payloads — REGISTER_RIDE messages
//
//  Step 1: Connect → ws://localhost:3001/ws?userId=<user_id>
//  Step 2: Send the JSON payload below as a message
// ─────────────────────────────────────────────────────────────

export const WS_TEST_PAYLOADS = [
    {
        _label: 'Aarav → Red Fort (Central Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-001',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.6562,
            longitude: 77.2410,
        },
    },
    {
        _label: 'Priya → India Gate (Central Delhi — similar route to Red Fort)',
        _connect: 'ws://localhost:3001/ws?userId=user-002',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.6129,
            longitude: 77.2295,
        },
    },
    {
        _label: 'Rohan → Connaught Place (Central Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-003',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 2,
            latitude: 28.6328,
            longitude: 77.2197,
        },
    },
    {
        _label: 'Ananya → Qutub Minar (South Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-004',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.5244,
            longitude: 77.1855,
        },
    },
    {
        _label: 'Vikram → Lotus Temple (South Delhi — similar route to Qutub Minar)',
        _connect: 'ws://localhost:3001/ws?userId=user-005',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.5535,
            longitude: 77.2588,
        },
    },
    {
        _label: 'Sneha → Akshardham Temple (East Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-006',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 2,
            luggage: 2,
            latitude: 28.6127,
            longitude: 77.2773,
        },
    },
    {
        _label: 'Arjun → Jama Masjid (Old Delhi — similar route to Red Fort)',
        _connect: 'ws://localhost:3001/ws?userId=user-007',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.6507,
            longitude: 77.2334,
        },
    },
    {
        _label: 'Kavya → Bangla Sahib Gurudwara (Central Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-008',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.6296,
            longitude: 77.2114,
        },
    },
    {
        _label: 'Rahul → Safdarjung Tomb (South-Central Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-009',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 2,
            latitude: 28.5893,
            longitude: 77.2106,
        },
    },
    {
        _label: 'Diya → Chattarpur Mandir (Far South Delhi)',
        _connect: 'ws://localhost:3001/ws?userId=user-010',
        payload: {
            type: 'REGISTER_RIDE',
            no_of_passengers: 1,
            luggage: 1,
            latitude: 28.5083,
            longitude: 77.1724,
        },
    },
]


// ─────────────────────────────────────────────────────────────
//  HTTP Test Payloads — POST /find-ride/trips
// ─────────────────────────────────────────────────────────────

export const HTTP_TRIPS_PAYLOADS = [
    { _label: 'Get trips for Aarav', user_id: 'user-001' },
    { _label: 'Get trips for Priya', user_id: 'user-002' },
    { _label: 'Get trips for Rohan', user_id: 'user-003' },
    { _label: 'Get trips for Ananya', user_id: 'user-004' },
    { _label: 'Get trips for Vikram', user_id: 'user-005' },
    { _label: 'Get trips for Sneha', user_id: 'user-006' },
    { _label: 'Get trips for Arjun', user_id: 'user-007' },
    { _label: 'Get trips for Kavya', user_id: 'user-008' },
    { _label: 'Get trips for Rahul', user_id: 'user-009' },
    { _label: 'Get trips for Diya', user_id: 'user-010' },
]


// ─────────────────────────────────────────────────────────────
//  Match-Friendly Pairs — These destinations are close and
//  likely to match with each other during testing
// ─────────────────────────────────────────────────────────────

export const LIKELY_MATCH_PAIRS = {
    pair_1: {
        description: 'Central Delhi cluster — Red Fort / India Gate / Connaught Place',
        users: ['user-001', 'user-002', 'user-003'],
        note: 'Similar H3 route from airport → likely DIRECT or BEST_DETOUR match',
    },
    pair_2: {
        description: 'Old Delhi cluster — Red Fort / Jama Masjid',
        users: ['user-001', 'user-007'],
        note: 'Very close destinations — high chance of DIRECT match',
    },
    pair_3: {
        description: 'South Delhi cluster — Qutub Minar / Chattarpur',
        users: ['user-004', 'user-010'],
        note: 'Both south of airport — similar initial route',
    },
}
