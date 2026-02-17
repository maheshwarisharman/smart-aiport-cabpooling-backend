# Smart Airport Cab-Pooling — Backend

A real-time airport cab-pooling backend that matches passengers heading in similar directions using **H3 geo-indexing**, **Redis**, and **WebSockets**. Built with **Bun**, **Express**, **Prisma**, and **PostgreSQL**.

> **Full API Reference** → open `docs/index.html` in your browser or see [`openapi.yaml`](./openapi.yaml)

---

## Architecture at a Glance

| Layer | Tech | Port |
|---|---|---|
| HTTP API | Express 5 | `3000` |
| WebSocket | Bun native | `3001` |
| Database | PostgreSQL 16 | `5432` |
| Cache / Pub-Sub | Redis 7 | `6379` |
| Ride Matching | Worker threads (CPU-offloaded) | — |

---

## Run with Docker (Recommended)

> One command spins up **Postgres + Redis + App** with auto-migrations and seed data.

#Important: Make sure to update the .env file GOOGLE_ROUTES_API_KEY. 
(see .env.example for reference)

```bash
# Build & start (foreground)
docker compose up --build

# Or detached
docker compose up --build -d

# Tear down (removes volumes)
docker compose down -v
```

The Dockerfile uses a **multi-stage build** — Stage 1 installs all deps and generates the Prisma client, Stage 2 copies only production artifacts into a slim image. On startup the container automatically:
1. Waits for Postgres to be healthy (up to 30 retries)
2. Runs `prisma migrate deploy`
3. Seeds the database (`prisma/seed.ts` — idempotent)
4. Starts the Bun server

---

## Run Locally (without Docker)

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- PostgreSQL 16 running on `localhost:5432`
- Redis 7 running on `localhost:6379`

### Steps

```bash
# 1. Install dependencies
bun install

# 2. Configure environment — edit .env if your DB/Redis credentials differ
#    DATABASE_URL="postgresql://admin:admin@localhost:5432/mydb"

# 3. Run Prisma migrations
bunx prisma migrate deploy

# 4. Generate Prisma client
bunx prisma generate

# 5. Seed the database (idempotent — safe to re-run)
bun prisma/seed.ts

# 6. Start the server
bun run index.ts
```

The HTTP server will be at **http://localhost:3000** and the WebSocket server at **ws://localhost:3001/ws**.

---

## Quick Testing Guide

The project ships with **`testData.ts`** — ready-made payloads using the seeded user/driver IDs.

### 1 — Register a ride via WebSocket

Open a WebSocket client (e.g. [websocat](https://github.com/nickel-org/websocat), Postman, or a browser console) and connect:

```
ws://localhost:3001/ws?userId=user-001
```

Send a `REGISTER_RIDE` message:

```json
{
  "type": "REGISTER_RIDE",
  "no_of_passengers": 1,
  "luggage": 1,
  "latitude": 28.6562,
  "longitude": 77.2410
}
```

### 2 — Trigger a match

Open a **second** WebSocket connection for a user with a nearby destination and send a similar payload. These pairs are most likely to match:

| Pair | Users | Destinations |
|---|---|---|
| Central Delhi | `user-001`, `user-002`, `user-003` | Red Fort / India Gate / Connaught Place |
| Old Delhi | `user-001`, `user-007` | Red Fort / Jama Masjid |
| South Delhi | `user-004`, `user-010` | Qutub Minar / Chattarpur |

### 3 — Fetch trips via HTTP

```bash
curl -X POST http://localhost:3000/find-ride/trips \
  -H "Content-Type: application/json" \
  -d '{"user_id": "user-001"}'
```

---

## Database Schema

The core logic revolves around **Trips** (a session of a cab ride) and **RideRequests** (passengers joining that trip).

```mermaid
erDiagram
    Users ||--o{ RideRequests : "makes"
    Drivers ||--|| Cabs : "drives (1:1)"
    Cabs ||--o{ Trips : "assigned to"
    Trips ||--|{ RideRequests : "contains"

    Users {
        String id PK
        String name
        String email UK
        String password
        DateTime createdAt
        String gender
        Int age
        Int ride_otp
        DateTime otp_expiry
    }

    Drivers {
        String id PK
        String name
        String email UK
        String password
        DateTime createdAt
        String gender
        Int age
    }

    Cabs {
        String id PK
        String cab_number UK
        String cab_type
        Int no_of_seats
        Int luggage_capacity
        String status
        String driver_id FK
    }

    Trips {
        String id PK
        String status
        Int fare_each
        Int no_of_passengers
        Int total_luggage
        DateTime created_at
        String cab_id FK
    }

    RideRequests {
        String id PK
        String status
        Int no_of_passengers
        Int luggage_capacity
        Int issued_price
        DateTime joined_at
        String user_id FK
        String trip_id FK
    }
```

---

## Ride Matching Strategy (Low Level Design)

The matching logic is implemented in `src/utils/redisCaching.ts` and runs on worker threads to prevent blocking the main event loop. It uses **H3 (Hexagonal Hierarchical Spatial Index)** to treat routes as strings of characters, enabling efficient prefix-based matching in Redis.

![High Level Architecture](./docs/2.png)
![High Level Architecture](./docs/3.png)
![High Level Architecture](./docs/1.png)


### Core Concept: Route Linearization

1.  **Route Digitization**:
    *   Fetch route points (Polyline) from **Google Routes API**.
    *   Convert points to **H3 indices** (Resolution 8, ~460m edge length).
    *   **Fill Gaps**: Interpolate between points to ensure a continuous chain of hexagons.
    *   **Result**: A unique string signature representing the path (e.g., `883da1...883da2...`).

2.  **Storage (Redis Sorted Sets)**:
    *   Stores route signatures in a Lexicographically Sorted Set (`ZSET`).
    *   Key: `h3:airport_pool`
    *   Member: `route_signature::user_id`
    *   Score: `0` (we rely purely on lexicographical ordering).

### Matching Steps

The algorithm performs a two-step search to find the best candidate:

#### Step 1: Geometric Overlap (The "Fast Path")
We look for candidates whose routes are geometrically aligned with ours using Redis `ZRANGE` with `BY: LEX`.

*   **Superset Match (You contain me)**:
    *   We search for routes that **start with** our route signature.
    *   Query: `ZRANGE [my_route_signature` to `[my_route_signature\xff`
    *   *Logic*: If a candidate's string starts with my string, their route is a continuation of mine. I can drop them off first.

*   **Subset Match (I contain you)**:
    *   We search for routes that are **prefixes** of our route signature.
    *   Query: We check immediate neighbors (predecessors and successors) in the sorted set.
    *   *Logic*: If my string starts with a candidate's string, my route covers their entire path. I can pick them up and drop them off on my way.

#### Step 2: Split-Point & Detour Analysis (The "Smart Path")
If no perfect overlap is found, we analyze nearby candidates to see if a slight detour is viable.

1.  **Find Candidates**: Fetch nearest neighbors in the sorted set (lexicographically similar routes).
2.  **Find Split Point**:
    *   Compare the user's route string with the candidate's.
    *   Identify the **Longest Common Prefix**—this represents the shared portion of the journey.
    *   The point where the strings diverge is the **Split Point**.
3.  **Calculate Detour**:
    *   Extract the H3 index of the Split Point.
    *   Extract the H3 index of the Candidate's Destination.
    *   Calculate the **real-world driving distance** from Split Point → Candidate Destination using Google Routes API.
4.  **Threshold Check**:
    *   If `Detour Distance < 3 km`, it's a match!
    *   We select the candidate with the minimal detour.

### Persistence & Consistency

Once a match is identified in Redis:

1.  **Atomic Cleanup**:
    *   The two users are removed from the available pool (`ZREM`, `DEL`).
    *   A temporary `TRIP...` key is created in Redis with the combined metadata.
2.  **Price Adjustment**:
    *   A **70% discount** is applied to *both* users' original issued prices.
3.  **DB Transaction**:
    *   A Prisma Interactive Transaction (`prisma.$transaction`) creates a `Trips` row and two `RideRequests` rows in PostgreSQL.
    *   This ensures that either the entire match is persisted, or (in rare failures) rolled back to avoid data inconsistency.
4.  **Notification**:
    *   The match details are published via **Redis Pub/Sub** to notify the WebSocket server, which pushes the update to the connected clients.

---

## Concurrency Handling Strategy

Ride matching involves heavy array manipulation and string processing (looping over H3 indices, comparing 15-char substrings). Running this on the **Node.js/Bun main thread** would block the Event Loop, causing lag for HTTP/WebSocket requests.

### Solution: Worker Threads

We use a custom **Worker Pool** (`src/workers/workerPool.ts`) to offload CPU-intensive tasks.

1.  **Main Thread**: Handles I/O (Express, WebSockets) and delegates "MATCH_RIDE" tasks.
2.  **Worker Threads**:
    *   Independent **Bun Workers**.
    *   Each worker has its **own isolated Redis & Prisma connection**.
    *   Tasks are distributed **Round-Robin**.
3.  **Synchronization**:
    *   **Redis ZSET** provides atomic operations (`ZADD`, `ZREM`) to prevent race conditions when multiple workers access the pool.
    *   **Prisma Interactive Transactions** (`prisma.$transaction`) ensure that `Trips` and `RideRequests` are created atomically in Postgres.

---

## Pricing Approach

Located in `src/utils/redisCaching.ts`.

1.  **Base Fare**:
    *   `Total Distance (km) * ₹10`.
    *   Example: 25km ride = ₹250.

2.  **Cab-Pooling Discount**:
    *   If a match is found, **both users** receive a **70% price factor** (i.e., they pay **70%** of the original fare, saving 30%).
    *   Example: ₹250 becomes `ceil(250 * 0.7) = ₹175`.

3.  **Consistency**:
    *   Prices are calculated in Redis during the matching phase.
    *   The *discounted* price is permanently stored in the `RideRequests` table (`issued_price` column) upon match persistence.

---

## Project Structure

```
├── index.ts               # Entry — Express HTTP + Bun WebSocket servers
├── src/
│   ├── routes/            # findRide, signup, startRide, cancelRide
│   ├── rideMatching/      # H3-based matching logic
│   ├── utils/             # Redis caching, Pub/Sub, helpers
│   └── workers/           # Worker pool for CPU-heavy matching
├── prisma/                # Schema, migrations, seed
├── lib/                   # Prisma client singleton
├── docs/                  # Generated API documentation (HTML)
└── openapi.yaml           # OpenAPI 3.x spec
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://admin:admin@localhost:5432/mydb` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |
| `GOOGLE_ROUTES_API_KEY` | *(set in `.env`)* | Google Routes API key for distance computation |

---

## License

MIT
