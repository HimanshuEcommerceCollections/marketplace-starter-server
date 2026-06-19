# Elevate Server

Backend API for the **Elevate** service booking platform.

**Stack:** Node.js · TypeScript · Express · Prisma · PostgreSQL · JWT · Zod
**Architecture:** feature/module-based (clean-architecture layering inside each module).

---

## Why feature-modules (not MVC)

Traditional MVC scatters one feature across `controllers/`, `models/`, `services/`
folders, so a single change touches many directories. Here, **each feature owns a
folder** containing its full vertical slice (controller → service → repository +
routes, validation, types). Adding "payments" later means adding one
`modules/payments/` folder — nothing else moves.

Inside every module the dependency direction is strict and one-way:

```
routes → controller → service → repository → Prisma
         (HTTP)       (business)  (data access)  (DB)
```

- **Controller** — HTTP only: read the (already-validated) request, call a service,
  shape the response. No business logic, no DB calls.
- **Service** — business rules, orchestration, authorization decisions. Knows
  nothing about HTTP (`req`/`res`).
- **Repository** — the only place that talks to Prisma. Swappable/audited in one spot.
- **validation** — Zod schemas; the single source of truth for request shapes.
- **types** — DTOs inferred from the Zod schemas (`z.infer`) so runtime validation
  and compile-time types never drift.

---

## Folder tree

```
Server/
├── prisma/
│   ├── schema.prisma          # Domain models + enums (source of truth for DB & enums)
│   ├── migrations/            # Generated migration history (commit these)
│   └── seed.ts                # Idempotent seed data (admin, category, sample service)
│
├── src/
│   ├── config/
│   │   └── env.ts             # Zod-validated environment; fails fast on bad config
│   │
│   ├── constants/             # App-wide constant values
│   │   ├── http-status.ts     #   named HTTP status codes
│   │   ├── messages.ts        #   centralized user-facing strings
│   │   ├── roles.ts           #   role groups (STAFF_ROLES…) + isStaffRole()
│   │   └── index.ts           #   barrel
│   │
│   ├── enums/                 # Enums
│   │   ├── app.enums.ts       #   app-only enums (SortOrder, TokenType)
│   │   └── index.ts           #   re-exports Prisma enums + app enums (one import path)
│   │
│   ├── types/                 # Shared TypeScript types
│   │   ├── express.d.ts       #   augments Express.Request with `req.user`
│   │   ├── common.types.ts    #   AuthUser, PaginationMeta, ApiSuccess/Failure
│   │   └── index.ts
│   │
│   ├── utils/                 # Shared, framework-agnostic helpers
│   │   ├── api-error.ts       #   ApiError class + factories (badRequest, notFound…)
│   │   ├── api-response.ts    #   sendSuccess() — standard response envelope
│   │   ├── async-handler.ts   #   wraps async routes so errors reach the error handler
│   │   ├── jwt.ts             #   sign/verify access & refresh tokens
│   │   ├── password.ts        #   bcrypt hash/compare
│   │   ├── pagination.ts      #   buildPagination()/buildMeta()
│   │   ├── logger.ts          #   leveled logger (swap for pino/winston later)
│   │   ├── user.ts            #   toPublicUser() — strips passwordHash
│   │   └── index.ts
│   │
│   ├── middleware/            # Cross-cutting Express middleware
│   │   ├── authenticate.ts    #   verify JWT → populate req.user (401 on failure)
│   │   ├── authorize.ts       #   RBAC: authorize(...roles) (403 on failure)
│   │   ├── validate.ts        #   validate+coerce body/query/params via Zod (422)
│   │   ├── error-handler.ts   #   global handler: ApiError/Zod/Prisma → JSON
│   │   ├── not-found.ts       #   404 fallback
│   │   ├── rate-limit.ts      #   general + stricter auth limiters
│   │   └── index.ts
│   │
│   ├── modules/               # ── FEATURE MODULES (the heart of the app) ──
│   │   ├── auth/              # register, login, refresh (rotation), logout, me
│   │   ├── users/             # profile self-service + admin user management
│   │   ├── services/          # service catalog CRUD
│   │   ├── bookings/          # create/list/get/cancel + staff status updates
│   │   ├── availability/      # provider/service time slots
│   │   ├── waitlist/          # join / list / leave a service waitlist
│   │   ├── reviews/           # submit (post-completion) + staff moderation
│   │   └── admin/             # dashboard aggregates (cross-table reads)
│   │       ├── <name>.routes.ts        # endpoint definitions + middleware chain
│   │       ├── <name>.controller.ts    # HTTP glue
│   │       ├── <name>.service.ts       # business logic
│   │       ├── <name>.repository.ts    # Prisma data access
│   │       ├── <name>.validation.ts    # Zod schemas
│   │       ├── <name>.types.ts         # DTOs (z.infer) + module types
│   │       └── index.ts                # exports the router (+ service for reuse)
│   │
│   ├── db/
│   │   └── client.ts          # PrismaClient singleton (reused across hot-reloads)
│   │
│   ├── routes/
│   │   └── index.ts           # API v1 aggregator: mounts every module router + /health
│   │
│   ├── app.ts                 # Express app factory (helmet, cors, json, rate-limit, routes)
│   └── server.ts              # entry point: listen + graceful shutdown
│
├── .env / .env.example        # environment (DATABASE_URL, JWT secrets, …)
├── .npmrc                     # script-shell=powershell (folder path contains "&")
├── tsconfig.json
└── package.json
```

### Cross-module rule

Modules may import another module's **service** (e.g. `bookings.service` calls
`services.service.getById`) but never another module's controller, routes, or
repository. This keeps the dependency graph acyclic and the HTTP layer thin.

---

## Data model (Prisma)

Core: `User`, `RefreshToken`, `ServiceProvider`, `ServiceCategory`, `Service`,
`Booking`, `AvailabilitySlot`, `WaitlistEntry`, `Review`.
Forward-looking (modelled now, no endpoints yet): `Payment`, `Notification`.

Built-in support for the features you flagged as "future":

| Future feature        | Already in place                                              |
| --------------------- | ------------------------------------------------------------ |
| Role-based access     | `UserRole` enum + `authorize()` + `roles.ts` groups          |
| Service providers     | `ServiceProvider` model + `SYSTEM_PROVIDER`/`SYSTEM_COORDINATOR` roles |
| Payments              | `Payment` model + `PaymentStatus` (add `modules/payments/`)  |
| Notifications         | `Notification` model + types (add `modules/notifications/`)  |
| Admin dashboard       | `modules/admin/` with aggregate repository                   |

---

## API surface (mounted under `/api/v1`)

| Module       | Key routes |
| ------------ | ---------- |
| auth         | `POST /auth/register` · `/login` · `/refresh` · `/logout` · `GET /auth/me` |
| users        | `GET/PATCH /users/me` · `GET /users` · `GET /users/:id` · `PATCH /users/:id/role|status` |
| services     | `GET /services` · `GET /services/:id` · `POST/PATCH/DELETE` (staff) |
| bookings     | `POST /bookings` · `GET /bookings` · `GET /bookings/:id` · `PATCH /:id/cancel` · `PATCH /:id/status` (staff) |
| availability | `GET /availability` · `POST /availability` · `DELETE /availability/:id` |
| waitlist     | `POST /waitlist` · `GET /waitlist` · `PATCH /waitlist/:id/leave` |
| reviews      | `GET /reviews` · `GET /reviews/:id` · `POST /reviews` · `PATCH /:id/moderate` (staff) |
| admin        | `GET /admin/dashboard` (admin/coordinator) |

Every response uses one envelope:
`{ success, message, data, meta? }` (success) / `{ success:false, message, errors? }` (error).

---

## Setup

```bash
cd Server
npm install

# 1. Configure .env — set DATABASE_URL + JWT secrets (see .env.example)
# 2. Create the schema in your database
npm run prisma:migrate      # dev: creates migration + applies it
npm run prisma:seed         # optional: seed admin + sample data
# 3. Run
npm run dev                 # http://localhost:4000  →  GET /api/v1/health
```

## Scripts

| Command                   | Description                            |
| ------------------------- | -------------------------------------- |
| `npm run dev`             | Hot-reload dev server (tsx watch)      |
| `npm run build` / `start` | Compile to `dist/` / run compiled      |
| `npm run typecheck`       | Type-check, no emit                    |
| `npm run prisma:migrate`  | Create & apply a dev migration         |
| `npm run prisma:deploy`   | Apply migrations (production)          |
| `npm run prisma:seed`     | Run the seed script                    |
| `npm run prisma:studio`   | Prisma Studio (DB GUI)                 |

## Adding a new feature module

1. `mkdir src/modules/payments` and add the 7 files (copy an existing module's shape).
2. Add any new models to `prisma/schema.prisma` → `npm run prisma:migrate`.
3. Mount the router in `src/routes/index.ts`: `apiRouter.use("/payments", paymentsRouter)`.

That's the whole change — no other files move.
