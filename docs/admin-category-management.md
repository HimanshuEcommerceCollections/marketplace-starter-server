# Admin Category Management — MVP Design

> Backend + UX design for managing service **Categories** on the Elevate platform.
> Aligned to the existing server conventions: per-feature module folders, `ApiError`
> factories, the `{ success, message, data, meta? }` response envelope,
> `buildPagination`/`buildMeta`, zod `validate({ body, query, params })`, and
> role-guarded routes (`authenticate` + `authorize`).
>
> **Key alignment decision:** the spec's `Category` maps onto the **existing
> `ServiceCategory` Prisma model** (`Server/prisma/schema.prisma`) — we extend it,
> not add a parallel table. Money is stored as **`Int` minor units (cents)** to match
> `Service.priceAmount`. Images/icons are **not** in the DB — resolved from a config
> file by `slug` (see §6.3).

---

## 0. Design decisions (MVP)

| Decision | Choice | Why |
|---|---|---|
| Entity | Extend existing `ServiceCategory` | Services already FK to it; no migration of relations |
| Price unit | `Int` cents (`basePrice`) | Matches `Service.priceAmount` / catalog `from_price` |
| Status | New `CategoryStatus` enum `DRAFT \| ACTIVE \| INACTIVE` | Mirrors `BookingStatus` (Prisma owns enums) |
| Status changes | Dedicated `POST /:id/publish` & `/:id/deactivate` | Guarded transitions beat a free-form `status` field |
| Create "Publish" button | `POST /categories { publish: true }` | One create endpoint, draft-by-default |
| Delete | **Not in MVP** | Lifecycle ends at INACTIVE; services are retained |
| Visibility | Reads are role-aware: anon → `ACTIVE` only; staff → any status | Satisfies "only ACTIVE visible to customers" |
| Images/icons | Config file keyed by slug | Per entity note — not DB columns |

---

## 1. User Flow Diagram

### 1.1 Admin task flow

```
                         ┌─────────────────────────────┐
                         │   Category Listing Page      │
                         │  (search · filter · sort ·   │
                         │   paginate · actions menu)   │
                         └──────────────┬───────────────┘
            ┌──────────────┬────────────┼───────────────┬───────────────┐
            ▼              ▼             ▼               ▼               ▼
       [+ Create]      [View]        [Edit]         [Publish]      [Deactivate]
            │              │             │               │               │
            ▼              ▼             ▼               ▼               ▼
   ┌────────────────┐ ┌─────────┐ ┌────────────┐  ┌──────────┐   ┌────────────┐
   │ Create Form    │ │ Details │ │ Edit Form  │  │ confirm? │   │  confirm?  │
   │ name*          │ │ page    │ │ name/slug/ │  └────┬─────┘   └─────┬──────┘
   │ description    │ │ + #svcs │ │ desc/price │       │               │
   │ basePrice*     │ └─────────┘ └─────┬──────┘       ▼               ▼
   │ (slug preview) │                   │        DRAFT|INACTIVE     ACTIVE
   └───┬────────┬───┘                   │            →ACTIVE         →INACTIVE
       │        │                       │               │               │
 [Save Draft] [Publish]                 ▼               └───────┬───────┘
       │        │              validate + persist               │
       ▼        ▼              (unique name/slug,                ▼
  ┌──────────────────┐         basePrice > 0)            back to Listing
  │ validate server  │                │                  (status updated)
  │ • name unique?   │                ▼
  │ • slug unique?   │           back to Details/Listing
  │ • basePrice > 0? │
  └───┬──────────┬───┘
   ok │          │ fail
      ▼          ▼
  201 Created  4xx error
  (DRAFT or    (inline field
   ACTIVE)      errors shown)
```

### 1.2 Status lifecycle (state machine)

```
   create
     │
     ▼
 ┌────────┐   publish    ┌────────┐  deactivate  ┌──────────┐
 │ DRAFT  │ ───────────▶ │ ACTIVE │ ───────────▶ │ INACTIVE │
 └────────┘              └────────┘              └────┬─────┘
                              ▲                        │
                              │        publish         │
                              └────────────────────────┘

Allowed transitions:
  DRAFT     ──publish────▶  ACTIVE
  ACTIVE    ──deactivate─▶  INACTIVE
  INACTIVE  ──publish────▶  ACTIVE      (re-activate)
Any other transition → 409 Conflict ("Invalid status transition").
Customer website shows ACTIVE only. DRAFT + INACTIVE are hidden.
INACTIVE retains its linked services (no cascade).
```

---

## 2. Admin UI Wireframes (text)

### 2.1 Listing page  `/admin/categories`

```
┌───────────────────────────────────────────────────────────────────────────┐
│  Categories                                              [ + New Category ] │
├───────────────────────────────────────────────────────────────────────────┤
│  🔍 [ Search by name…            ]   Status:[ All ▾ ]   Sort:[ Newest ▾ ]   │
├──────────────┬───────────────┬───────────┬──────────┬──────────┬───────────┤
│ NAME         │ SLUG          │ BASE PRICE│ STATUS   │ CREATED  │ ⋮ ACTIONS │
├──────────────┼───────────────┼───────────┼──────────┼──────────┼───────────┤
│ Massage      │ massage       │ $109.00   │ ●ACTIVE  │ Jun 02   │    ⋮      │
│ Therapy      │ therapy       │ $165.00   │ ○DRAFT   │ Jun 10   │    ⋮      │
│ Beauty       │ beauty        │ $75.00    │ ◌INACTIVE│ May 21   │    ⋮      │
├──────────────┴───────────────┴───────────┴──────────┴──────────┴───────────┤
│  Showing 1–20 of 34        [‹ Prev]   1  2  [Next ›]    Rows: [20 ▾]        │
└───────────────────────────────────────────────────────────────────────────┘

   ⋮ Actions menu (row-status-aware):
      ┌─────────────────┐
      │ View            │  always
      │ Edit            │  always
      │ Publish         │  if DRAFT or INACTIVE
      │ Deactivate      │  if ACTIVE
      └─────────────────┘
```

### 2.2 Create form  `/admin/categories/new`

```
┌──────────────────────────────────────────────┐
│  New Category                                  │
├──────────────────────────────────────────────┤
│  Name *          [ Deep Tissue Massage      ]  │
│  Slug            [ deep-tissue-massage      ]  │  ← auto-filled from name,
│                  (auto-generated, editable)    │     editable; live preview
│  Description     [ ........................ ]  │
│                  [ ........................ ]  │
│  Base Price *    [ $ ] [ 109.00 ]  USD         │  ← entered as dollars, sent as cents
├──────────────────────────────────────────────┤
│            [ Cancel ]  [ Save as Draft ]  [ Publish ] │
└──────────────────────────────────────────────┘
   Inline errors under each field on 409/422 (e.g. "Name already exists").
```

### 2.3 Edit form  `/admin/categories/:id/edit`

```
┌──────────────────────────────────────────────┐
│  Edit Category                  Status: ACTIVE │
├──────────────────────────────────────────────┤
│  Name *          [ Massage                  ]  │
│  Slug *          [ massage                  ]  │  ← editable; uniqueness re-checked
│  Description     [ ........................ ]  │
│  Base Price *    [ $ ] [ 109.00 ]  USD         │
├──────────────────────────────────────────────┤
│  Lifecycle:   [ Deactivate ]   (ACTIVE → INACTIVE) │  ← calls transition endpoint,
│                                                     │     not the PATCH body
├──────────────────────────────────────────────┤
│                       [ Cancel ]  [ Save Changes ] │
└──────────────────────────────────────────────┘
```

### 2.4 Details page  `/admin/categories/:id`

```
┌───────────────────────────────────────────────────────────────┐
│  Massage                                    ●ACTIVE   [ Edit ▾ ]│
├───────────────────────────────────────────────────────────────┤
│  Slug          massage                                          │
│  Base Price    $109.00 USD                                      │
│  Description    Massage and recovery services.                  │
│  ───────────────────────────────────────────────────────────── │
│  Linked Services      6 services                                │
│  Created             Jun 02, 2026  09:14                        │
│  Updated             Jun 18, 2026  16:40                        │
├───────────────────────────────────────────────────────────────┤
│  [ Deactivate ]   (visible because status = ACTIVE)             │
└───────────────────────────────────────────────────────────────┘
```

---

## 3. REST API Endpoints

Base: `/api/v1/categories` (registered in `src/routes/index.ts` alongside `services`).

| # | Method & Path | Auth | Purpose |
|---|---|---|---|
| 1 | `GET /categories` | public* | List (search, status filter, sort, paginate). *Anon → ACTIVE only; staff → any status. |
| 2 | `GET /categories/:id` | staff | Details incl. linked services count. |
| 3 | `POST /categories` | staff | Create (DRAFT by default; `publish:true` → ACTIVE). |
| 4 | `PATCH /categories/:id` | staff | Edit name / slug / description / basePrice. |
| 5 | `POST /categories/:id/publish` | staff | Transition DRAFT\|INACTIVE → ACTIVE. |
| 6 | `POST /categories/:id/deactivate` | staff | Transition ACTIVE → INACTIVE. |

`staff` = `authenticate` + `authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR)`
(publish/deactivate may be tightened to `SYSTEM_ADMIN` only — see services `DELETE` precedent).

> Delete is intentionally omitted in MVP. "Removal" = Deactivate, which preserves linked services.

---

## 4. Request / Response DTOs

All responses use the shared envelope from `utils/api-response.ts`:

```ts
// success
{ "success": true, "message": string, "data": T, "meta"?: PaginationMeta }
// error (from global error-handler)
{ "success": false, "message": string, "details"?: unknown }

interface PaginationMeta { page: number; limit: number; total: number; totalPages: number; }
```

### 4.1 Category resource (response shape)

```ts
interface CategoryResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  basePrice: number;                 // minor units (cents), e.g. 10900 = $109.00
  status: "DRAFT" | "ACTIVE" | "INACTIVE";
  createdAt: string;                 // ISO-8601
  updatedAt: string;                 // ISO-8601
}

// Details adds the linked-services count (via prisma _count)
interface CategoryDetailsResponse extends CategoryResponse {
  servicesCount: number;
}
```

### 4.2 Create — `POST /categories`

```ts
// Request body
interface CreateCategoryDto {
  name: string;                      // required
  description?: string;
  basePrice: number;                 // required, cents, > 0
  slug?: string;                     // optional; auto-generated from name if omitted
  publish?: boolean;                 // default false → DRAFT; true → create then ACTIVE
}
// 201 → { success, message:"Category created", data: CategoryResponse }
```

### 4.3 Update — `PATCH /categories/:id`

```ts
// Request body (all optional; ≥1 required)
interface UpdateCategoryDto {
  name?: string;
  slug?: string;
  description?: string | null;
  basePrice?: number;                // cents, > 0
}
// Note: status is NOT updatable here — use publish/deactivate.
// 200 → { success, message:"Category updated", data: CategoryResponse }
```

### 4.4 List — `GET /categories`

```ts
// Query params
interface ListCategoriesQuery {
  page?: number;       // default 1
  limit?: number;      // default 20, max 100
  search?: string;     // case-insensitive contains on name
  status?: "DRAFT" | "ACTIVE" | "INACTIVE";   // staff only; ignored/forced ACTIVE for anon
  sort?: "asc" | "desc";                       // by createdAt, default "desc" (Newest)
}
// 200 → { success, message:"Categories fetched", data: CategoryResponse[], meta: PaginationMeta }
```

### 4.5 Transitions

```ts
// POST /categories/:id/publish      (no body)
// 200 → { success, message:"Category published",   data: CategoryResponse(status:ACTIVE) }
// POST /categories/:id/deactivate   (no body)
// 200 → { success, message:"Category deactivated", data: CategoryResponse(status:INACTIVE) }
```

---

## 5. Validation Rules

### 5.1 Field validation (zod, in `categories.validation.ts`)

| Field | Rule |
|---|---|
| `name` | string, trimmed, 2–80 chars, **required** on create |
| `slug` | string, regex `^[a-z0-9]+(?:-[a-z0-9]+)*$`, 2–80 chars; optional on create |
| `description` | string, ≤ 2000 chars, optional (nullable on update) |
| `basePrice` | integer, **> 0** (`z.number().int().positive()`), cents |
| `publish` | boolean, optional (default false) |
| `status` (query) | enum `DRAFT\|ACTIVE\|INACTIVE`, optional |
| `page`/`limit` | coerced int; page ≥ 1; limit 1–100 (via `buildPagination`) |
| `sort` | enum `asc\|desc`, default `desc` |
| `:id` (params) | `z.string().uuid()` (matches `serviceIdSchema`) |
| update body | `.partial()` + `.refine(obj ⇒ Object.keys(obj).length > 0, "No fields to update")` |

### 5.2 Business rules (service layer)

1. **Name unique** — pre-check `findByName`; conflict → `ApiError.conflict("Category name already exists")`. (DB unique index is the backstop.)
2. **Slug unique** — auto-generate from name via `slugify()` when omitted; pre-check `findBySlug` (exclude self on update); conflict → `ApiError.conflict("Slug already exists")`. *(MVP optional nicety: auto-suffix `-2`, `-3` when auto-generated.)*
3. **basePrice > 0** — enforced by zod; defense-in-depth check in service.
4. **New category defaults to DRAFT**; `publish:true` performs create-then-publish in one service call (single transaction).
5. **Transition guard** — a single `assertTransition(from, to)` used by publish/deactivate; illegal transition → `ApiError.conflict("Invalid status transition")`.
6. **Visibility** — list/read for unauthenticated callers forces `status = ACTIVE`; the `status` query param is honored only for authenticated staff.

---

## 6. Database Schema

### 6.1 Prisma diff (extend the existing model)

```prisma
// NEW enum — Prisma owns domain enums; re-export from src/enums/index.ts
enum CategoryStatus {
  DRAFT
  ACTIVE
  INACTIVE
}

model ServiceCategory {
  id          String         @id @default(uuid())
  name        String         @unique
  slug        String         @unique
  description String?
  basePrice   Int            @default(0)            // + NEW: minor units (cents); app enforces > 0 on write
  status      CategoryStatus @default(DRAFT)        // + NEW
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  services Service[]                                // unchanged — retained on INACTIVE

  @@index([status])                                 // + NEW: status filter
}
```

> **`basePrice @default(0)`** is a migration-safety choice: it lets the column be added
> to a table that may already hold category rows without a manual backfill. `0` is never
> a *valid* business value — the API rejects `basePrice <= 0` on create/update — so any
> legacy `0` simply means "needs a price set" and an admin can edit it.

Then: add `CategoryStatus` to the re-export block in `src/enums/index.ts`, and run
`prisma migrate dev --name add_category_status_baseprice` (or `npm run db:push` in dev).

### 6.2 Field mapping (spec → model)

| Spec `Category` | Model | Note |
|---|---|---|
| `id, name, slug, description, createdAt, updatedAt` | already present | `name`/`slug` already `@unique` |
| `basePrice: number` | `basePrice Int` | stored as cents |
| `status` | `status CategoryStatus` | default DRAFT |
| `coverImagePath`, `iconPath` | — | **not in DB** (see §6.3) |

### 6.3 Images / icons (not in DB)

Resolved at read time from a static config keyed by slug, e.g.
`config/category-assets.json`:

```jsonc
{ "massage": { "coverImagePath": "/img/cat/massage.jpg", "iconPath": "HandHelping" } }
```

A small `resolveCategoryAssets(slug)` helper merges these into the response if/when the
UI needs them. Unknown slug → fall back to a default asset entry. Keeps the DB clean and
lets design swap art without migrations.

---

## 7. Error Handling Scenarios

Errors are thrown as `ApiError.*` and serialized by the global error handler into
`{ success:false, message, details? }`.

| Scenario | Factory | HTTP | Message |
|---|---|---|---|
| Missing/invalid body field (zod) | `validate` middleware → `ApiError.unprocessable` | 422 | "Validation failed" (+ field `details`) |
| `basePrice <= 0` | zod / `badRequest` | 422 / 400 | "Base price must be greater than 0" |
| Duplicate name | `ApiError.conflict` | 409 | "Category name already exists" |
| Duplicate slug | `ApiError.conflict` | 409 | "Slug already exists" |
| Update with empty body | `ApiError.badRequest` | 400 | "No fields to update" |
| Category id not found | `ApiError.notFound` | 404 | "Category not found" |
| Illegal transition (e.g. DRAFT→INACTIVE, ACTIVE→ACTIVE) | `ApiError.conflict` | 409 | "Invalid status transition" |
| Not authenticated | `authenticate` → `ApiError.unauthorized` | 401 | "Unauthorized" |
| Authenticated but wrong role | `authorize` → `ApiError.forbidden` | 403 | "Forbidden" |
| Anon requests `status=DRAFT` | silently forced to ACTIVE | 200 | (filter ignored) |
| Prisma unique violation (race, P2002) | mapped → `ApiError.conflict` | 409 | "Category name/slug already exists" |
| Unexpected | `ApiError.internal` | 500 | "Internal server error" |

---

## 8. Recommended Folder Structure

Mirror the existing feature-module layout (`modules/services/*`). New + touched files:

```
Server/
├─ prisma/
│  └─ schema.prisma                         # + CategoryStatus enum, + basePrice/status/@@index
├─ config/
│  └─ category-assets.json                  # NEW: slug → { coverImagePath, iconPath }
└─ src/
   ├─ enums/
   │  └─ index.ts                           # + re-export CategoryStatus from @prisma/client
   ├─ routes/
   │  └─ index.ts                           # + apiRouter.use("/categories", categoriesRouter)
   ├─ utils/
   │  └─ slugify.ts                         # NEW: name → url slug (shared util)
   └─ modules/
      └─ categories/                        # NEW module (follows services/* pattern)
         ├─ categories.validation.ts        # zod: create / update / list / idParam schemas
         ├─ categories.types.ts             # DTO types inferred from zod schemas
         ├─ categories.repository.ts        # thin Prisma wrapper (findMany/count/findById/
         │                                  #   findByName/findBySlug/create/update + _count)
         ├─ categories.service.ts           # business rules, uniqueness, transition guard,
         │                                  #   role-aware visibility, asset resolution
         ├─ categories.controller.ts        # arrow handlers → sendSuccess(...)
         ├─ categories.routes.ts            # Router + authenticate/authorize/validate
         └─ index.ts                        # export { categoriesRouter }
```

### 8.1 Responsibility per file (matches existing modules)

- **validation** — `createCategorySchema`, `updateCategorySchema` (`.partial()` + non-empty refine), `listCategoriesSchema`, `categoryIdSchema`.
- **repository** — `findMany(args)`, `count(where)`, `findById(id)` (with `_count.services`), `findByName`, `findBySlug`, `create`, `update`. No business logic.
- **service** — `list` (build `where` with search/status/visibility, `buildPagination`+`buildMeta`), `getById` (404 + `servicesCount`), `create` (slug-gen, uniqueness, optional publish), `update` (uniqueness-excluding-self, empty-body guard), `publish`/`deactivate` (`assertTransition`).
- **controller** — `list / getById / create / update / publish / deactivate`, each calling `sendSuccess`.
- **routes** — table in §3, `validate({...})` per route, `asyncHandler` wrap.

---

## 9. Open questions / future (post-MVP)

- **Reactivate semantics:** MVP allows INACTIVE → ACTIVE via publish. Confirm that's desired vs. requiring an explicit "reactivate".
- **Cascade visibility:** ✅ implemented — public `GET /services` and `GET /services/:id` now hide services whose parent category is not ACTIVE (via `optionalAuthenticate`; staff bypass the filter). Existing bookings are untouched (no data change), and staff still see/manage everything.
- **Hard delete:** out of scope; add a guarded `DELETE` (blocked when `servicesCount > 0`) only if product needs it.
- **Audit trail:** `publishedAt` / who-changed-status fields if compliance needs it later.
```
