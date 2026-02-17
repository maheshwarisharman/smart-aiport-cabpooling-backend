# 🛫 Smart Airport Cab-Pooling — Backend

A real-time airport cab-pooling backend that matches passengers heading in similar directions using **H3 geo-indexing**, **Redis**, and **WebSockets**. Built with **Bun**, **Express**, **Prisma**, and **PostgreSQL**.

> **📖 Full API Reference →** open `docs/index.html` in your browser or see [`openapi.yaml`](./openapi.yaml)

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

## 🐳 Run with Docker (Recommended)

> One command spins up **Postgres + Redis + App** with auto-migrations and seed data.

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

## 🖥️ Run Locally (without Docker)

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

## 🧪 Quick Testing Guide

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
