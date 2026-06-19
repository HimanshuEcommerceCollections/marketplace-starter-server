# Service Configuration Model — MVP Design

> Server-side design for **configurable services** on the Elevate platform: the
> `Service` entity and its two new children, `ServiceConfigGroup` (a configurable
> dimension like *Duration* or *Add-Ons*) and `ServiceConfigOption` (a choice within
> a group like *60 min* or *Hot Stones*, carrying a signed **price delta** in cents).
>
> Aligned to the existing server conventions: per-feature module folders, `ApiError`
> factories, the `{ success, message, data, meta? }` envelope, `buildPagination` /
> `buildMeta`, zod `validate({ body, query, params })`, role-guarded routes
> (`authenticate` + `authorize`), and the **Categories module as the reference
> implementation** (serialization step, lifecycle guards, role-aware visibility).
>
> **Key alignment decisions.** Money is `Int` minor units (cents) everywhere, matching
> `Service.priceAmount`. The migration **joins two client files by matching ids**
> (re-verified against current source — the two are now aligned, e.g. massage `duration` →
> `60`/`90`/`120` in both):
> - `Client/brands/elevate/services.json` → `services[].config_options[]` supplies the
>   **group/option structure**: `id`, `label`, `input` (select/multiselect), `required`, and
>   `choices[{id,label}]`. It also carries the service-level catalog fields (summary, category,
>   `from_price`, `min_booking`, badges, …).
> - `Client/brands/elevate/pricing.v1.json` → `services[pricingRef].modifiers[]` supplies the
>   **money**: each option's `delta` (cents) and the modifier's `applies`.
>
> Neither file alone is complete — `config_options` has no deltas; `pricing.v1.json` has no
> `required` flag. The seed maps `config_option` → `ServiceConfigGroup` and `choice` →
> `ServiceConfigOption`, looking up `priceDelta` from `pricing.v1.json` by
> `(pricingRef, group.key, option.key)`. (`services-content-extract.md` §3 is an older prose
> summary and should not be used as the import source.)
>
> **The id-alignment contract** (research §3, verified against the JSON): a group's `key`
> equals the pricing **modifier id** and an option's `key` equals the modifier **option
> id**, *resolved within the service's `pricing_ref` entry* — `pricing.v1.json.services[pricingRef].modifiers[].id` /
> `.options[].id`. These ids are hand-authored short ids (`duration`, `people`, `60`,
> `pack-4`, `swedish`, `3-plus`) and are **NOT** slugs of their labels, so keys are
> carried verbatim from the source, never auto-slugged (see §0).
>
> **The canonical pricing engine is `Client/src/lib/pricing/engine.ts`.** Any server-side
> recompute MUST be bit-for-bit compatible with it (§8.2). There is no separate
> pricing/modifier table on the server today, so the signed price delta lives directly **on
> the option row** (`priceDelta Int`), with a group-level `priceDelta` fallback mirroring the
> engine's `opt?.delta ?? m.delta` rule.

---

## 0. Design decisions (MVP)

| Decision | Choice | Why |
|---|---|---|
| Where price deltas live | `priceDelta Int` (signed cents) on `ServiceConfigOption`, **plus an optional group-level `priceDelta Int?` on `ServiceConfigGroup`** | Mirrors `engine.ts`'s `const delta = opt?.delta ?? m.delta` — option-level for SELECT/MULTISELECT, group-level fallback for optionless modifiers. No server modifier table exists, so deltas live on the config rows. |
| Per-unit vs flat scaling | New `applies ConfigApplies` enum `FLAT \| PER_UNIT` on `ServiceConfigGroup`, default `FLAT` | `engine.ts` scales a modifier's delta by `quantity` when `applies === 'per_unit'`. The schema must carry this flag or the server recompute diverges. All current data is `FLAT`. |
| Group ↔ pricing-modifier link | `ServiceConfigGroup.key` **=** `modifiers[].id` **within `services[pricingRef]`** | Honors the id-alignment contract resolved against `pricingRef`, not the slug (the two can diverge — `nutrition-coaching` already has `landing_slug: life-coaching`). |
| Option ↔ modifier-option link | `ServiceConfigOption.key` **=** `modifiers[].options[].id` within `services[pricingRef]` | Same contract. |
| `key` source | **Operator-supplied, REQUIRED on create, carried verbatim from the source id** | The real ids (`60`, `pack-4`, `3-plus`, `session-type`) are NOT slugs of their labels — auto-slugging would silently break resolution (e.g. label "60 minutes" → `60-minutes` ≠ id `60`; "Session Duration" → `session-duration` ≠ id `duration`). `slugify(label)` is only a UI *suggestion*, never the persisted key. |
| Input types | New `ConfigInputType` enum `SELECT \| MULTISELECT \| QUANTITY \| TOGGLE` | Prisma owns domain enums (like `CategoryStatus`); mirrors the client's 4 input values (`catalog/types.ts`, `pricing/types.ts`). **For MVP only SELECT/MULTISELECT are present in real data**; QUANTITY/TOGGLE are modeled but flagged in §8.3. |
| Ordering | Explicit `sortOrder Int @default(0)` on both group and option | Catalog/booking UI renders dimensions and choices in a deliberate order. |
| Required flag | `isRequired Boolean @default(false)` on group | Mirrors client `required` default `false`; gates booking selection. |
| Default choice | `isDefault Boolean @default(false)` on option; **invariant is "at most one default per SELECT group"** | Source data carries ZERO defaults (verified — no `default` field in any `config_option`), so "exactly one" is un-importable. "At most one" lets the faithful catalog import; the booking UI forces an explicit choice. DB cannot express a partial-unique index in Prisma, so this is **app-enforced and racy** (§5.2 rule 5). |
| Multiselect bounds vs quantity bounds | **Separate columns**: `selectMin`/`selectMax` (multiselect) and `quantityMin`/`quantityMax`/`quantityStep` (quantity), all nullable | Overloading one pair was self-contradictory (a positive quantity max always "exceeds the option count" of 0). No source data sets any bound, so all default `null` (unbounded) — these are **net-new product policy** (§8.3). |
| Marketing vs bookable | **Keep separate; do NOT unify in MVP** | They differ in purpose (preview vs transactional), price semantics (text `"+$20"` vs structured cents), and lifecycle. See §8.1 for the unification path. |
| `onDelete` | `Service → Group` and `Group → Option` both **Cascade** | Config is owned wholly by its parent. NOTE: `Booking.service` is `Restrict` (no cascade), so a live Service cannot be hard-deleted — the config cascade fires only for never-booked/draft services (§2.4). |
| Service model changes | **Additive only**, all nullable / defaulted | Keeps the migration safe on a populated table (see §2.4). |
| `priceAmount` source | Seeded from **pricing.v1.json `base_price.amount`** (NOT catalog `from_price`) | `from_price` is display-only and diverges from the math base — `beauty`/`speech-therapy` have `base_price.amount = 0` but `from_price = 7500 / 9500`. Seeding `from_price` would double-count $75/$95 on every booking. |
| `min_booking` floor | New `minBooking Int?` on `Service`; booking creation rejects totals below it | `beauty` carries `min_booking: 7500`; the wizard blocks advancing past Configure until the DRAFT total reaches it. Omitting it would accept a $45 beauty booking the client UI blocks. |
| Bookings reference | **Out of MVP scope** — flagged as an open decision (§8.2) | `Booking` has no config column yet; how to persist selections is a product decision, but the recompute contract it must satisfy is specified now. |

---

## 1. Entity relationship overview

```
                         ┌───────────────────────────────────────────────┐
                         │                    Service                     │
                         │  id, name, slug, categoryId, priceAmount(=base)│
                         │  + pricingRef, summary, serviceType,           │
                         │    fromPrice?, minBooking?, comingSoon,        │
                         │    badges[], locationModes[]                   │  (see §2.4)
                         └─────────────────────┬───────────────────────────┘
                                               │ 1
                                               │
                                               │ *           onDelete: Cascade
                         ┌─────────────────────▼───────────────────────┐
                         │              ServiceConfigGroup              │
                         │  id, serviceId, key(=modifier.id),           │
                         │  label, inputType, applies(FLAT|PER_UNIT),   │
                         │  isRequired, sortOrder, priceDelta?(group),  │
                         │  selectMin?, selectMax?,                     │
                         │  quantityMin?, quantityMax?, quantityStep?   │
                         │  @@unique([serviceId, key])                  │
                         └─────────────────────┬───────────────────────┘
                                               │ 1
                                               │
                                               │ *           onDelete: Cascade
                         ┌─────────────────────▼───────────────────────┐
                         │             ServiceConfigOption              │
                         │  id, groupId, key(=modifier.optionId),       │
                         │  label, priceDelta(Int signed cents),        │
                         │  isDefault, sortOrder                        │
                         │  @@unique([groupId, key])                    │
                         └──────────────────────────────────────────────┘

  Cardinality:   Service 1—* ServiceConfigGroup 1—* ServiceConfigOption
  Booking-UI read (§3 #8):  GET /services/:id/config returns Service WITH
                            groups[] each WITH options[] (fully nested).

  ID-alignment contract (research §3, verified against JSON):
     group.key   ↔  pricing.v1.json  services[service.pricingRef].modifiers[].id
     option.key  ↔  pricing.v1.json  services[service.pricingRef].modifiers[].options[].id
  Resolution path (mirrors engine.ts):
     selections[group.key] -> option.key -> option.priceDelta
                                          (fallback group.priceDelta when no option)

  Input-type → children rule:
     SELECT / MULTISELECT  → HAS options[]; delta on each option row
     QUANTITY              → NO options[]; group.priceDelta is the per-unit/flat delta,
                             bounded by quantityMin/quantityMax/quantityStep  (§8.3)
     TOGGLE                → NO options[]; group.priceDelta applied when "on"  (§8.3)
```

---

## 2. Database schema

### 2.1 New enums

```prisma
// NEW — Prisma owns domain enums; re-export from src/enums/index.ts.
// Mirrors the client's 4 bookable input types (catalog/types.ts, pricing/types.ts).
enum ConfigInputType {
  SELECT       // single choice from options[]      (e.g. Duration)
  MULTISELECT  // 0+ choices from options[]          (e.g. Add-Ons)
  QUANTITY     // numeric input; no options[]        (no real data yet — §8.3)
  TOGGLE       // boolean on/off; no options[]       (no real data yet — §8.3)
}

// NEW — mirrors pricing/types.ts ModifierSchema.applies; controls quantity scaling.
enum ConfigApplies {
  FLAT       // delta applied once, regardless of quantity (every current modifier)
  PER_UNIT   // delta scaled by Booking.quantity (engine.ts: scaleMoney(delta, quantity))
}
```

### 2.2 New model — `ServiceConfigGroup`

```prisma
/// A configurable dimension of a service (Duration, Session Type, Add-Ons…).
/// `key` MUST equal the pricing modifier id WITHIN services[service.pricingRef]
/// (id-alignment contract, research §3). Carried verbatim from source — never slugged.
model ServiceConfigGroup {
  id          String          @id @default(uuid())
  serviceId   String
  key         String          // == modifiers[].id under service.pricingRef; operator-supplied
  label       String
  inputType   ConfigInputType
  applies     ConfigApplies   @default(FLAT)   // PER_UNIT scales priceDelta by quantity
  isRequired  Boolean         @default(false)
  sortOrder   Int             @default(0)
  // Group-level delta — used by QUANTITY/TOGGLE (optionless) groups, mirroring
  // engine.ts's `m.delta` fallback. NULL for SELECT/MULTISELECT (deltas on options).
  priceDelta  Int?            // SIGNED cents; only meaningful for QUANTITY/TOGGLE
  // Multiselect selection-count bounds (net-new policy; no source data sets these).
  selectMin   Int?
  selectMax   Int?
  // Quantity numeric bounds (net-new; QUANTITY only — see §8.3).
  quantityMin  Int?
  quantityMax  Int?
  quantityStep Int?
  createdAt   DateTime        @default(now())
  updatedAt   DateTime        @updatedAt

  service Service               @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  options ServiceConfigOption[]

  @@unique([serviceId, key])        // a group key is unique within its service
  @@index([serviceId, sortOrder])   // ordered fetch for the booking UI
}
```

### 2.3 New model — `ServiceConfigOption`

```prisma
/// A choice within a group (60 min, Hot Stones, 4 Session Pack…).
/// `key` MUST equal the pricing modifier OPTION id within services[service.pricingRef]
/// (id-alignment contract, research §3). Carried verbatim from source — never slugged.
/// `priceDelta` is the SIGNED price adjustment in minor units (cents); the source data
/// tags each delta with a currency, which we drop — see currency note below.
model ServiceConfigOption {
  id         String   @id @default(uuid())
  groupId    String
  key        String   // == modifiers[].options[].id under service.pricingRef; operator-supplied
  label      String
  priceDelta Int      @default(0)   // SIGNED cents; 0 = no change, +3000 = +$30, -500 = -$5
  isDefault  Boolean  @default(false)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  group ServiceConfigGroup @relation(fields: [groupId], references: [id], onDelete: Cascade)

  @@unique([groupId, key])         // an option key is unique within its group
  @@index([groupId, sortOrder])    // ordered fetch for the booking UI
}
```

> **Why `priceDelta` is signed (and the integrity caveat).** All real deltas are `>= 0`
> (verified: `90 min` = `+3000`, `hot-stones` = `+2000`, `beauty event-styling` = `+9500`,
> max `pack-8 = 48000`; `60 min`/`Swedish` = `0`). Storing it as a plain signed `Int` (no
> `nonnegative` DB constraint) future-proofs discounts/bundles without a migration. **MVP
> sign policy: enforce `>= 0` in zod for now** (deltas are surcharges; discounts will arrive
> as fees, §8.2), loosen later if bundles need negatives. Because there is **no DB check
> constraint**, the booking-creation recompute (§8.2) is **load-bearing for integrity, not
> optional** — a tampered or oversized delta is caught only there.
>
> **Currency.** Every delta in `pricing.v1.json` is a currency-tagged Money `{ amount,
> currency }`; we store a bare `Int` and treat it as the **service's currency**. Mixed-currency
> deltas are **out of scope** (§8.4). Import MUST validate `delta.currency === service.currency`
> and reject otherwise.

> **Group-level vs option-level delta (engine parity).** `engine.ts` computes
> `const delta = opt?.delta ?? m.delta`. SELECT/MULTISELECT carry the delta on each option
> (`ServiceConfigOption.priceDelta`); QUANTITY/TOGGLE have no options, so the delta lives on
> `ServiceConfigGroup.priceDelta` (the `m.delta` fallback). The server resolver uses the same
> precedence. The client booking UI confirms this for toggles
> (`wizard-step-config.tsx`: `modifierOf(option.id)?.delta`).

### 2.4 Service model changes (recommended, additive)

The existing `Service` model is missing fields the client catalog carries. Recommended
**minimal** additions — all nullable or defaulted, so the migration is safe on a populated
table:

```prisma
model Service {
  // ── existing fields unchanged ─────────────────────────────────────────────
  id              String       @id @default(uuid())
  name            String
  slug            String       @unique
  description     String?
  categoryId      String
  providerId      String?
  priceAmount     Int          // BASE for booking math (= pricing base_price.amount), cents
  currency        String       @default("USD")
  durationMinutes Int          @default(60)
  locationMode    LocationMode @default(ONSITE)  // existing — canonical/default value
  isActive        Boolean      @default(true)
  createdAt       DateTime     @default(now())
  updatedAt       DateTime     @updatedAt

  // ── NEW (catalog parity) ──────────────────────────────────────────────────
  pricingRef    String?         //  client `pricing_ref`; the pricing.v1.json key.
                                //  Resolves the id-alignment contract. Defaults to slug
                                //  on seed but is its OWN column (slug may diverge —
                                //  nutrition-coaching has landing_slug: life-coaching).
  summary       String?         //  short marketing blurb (client `summary`)
  serviceType   String?         //  free-form/tag classifier (client `service_type`)
  fromPrice     Int?            //  client `from_price`; DISPLAY-ONLY "From $X" band.
                                //  NOT the booking base — see priceAmount note below.
  minBooking    Int?            //  client `min_booking`; hard booking floor (beauty=7500)
  comingSoon    Boolean   @default(false)  // client `coming_soon`; gates bookability
  badges        String[]  @default([])     // client `badges` (e.g. "[Sample]")
  locationModes LocationMode[]  @default([]) // client `location_modes` ARRAY (see note)

  // ── relations ─────────────────────────────────────────────────────────────
  category          ServiceCategory      @relation(fields: [categoryId], references: [id])
  provider          ServiceProvider?     @relation(fields: [providerId], references: [id])
  bookings          Booking[]
  reviews           Review[]
  availabilitySlots AvailabilitySlot[]
  waitlistEntries   WaitlistEntry[]
  configGroups      ServiceConfigGroup[]  // + NEW back-relation

  @@index([categoryId])
  @@index([providerId])
  @@index([isActive])
}
```

| Client catalog field | Recommendation | Rationale |
|---|---|---|
| `pricing_ref` | **Add** `pricingRef String?` (seed = slug) | **The id-alignment contract resolves against this**, not the slug. The slug can diverge from the pricing key by design; without this column a group can't be linked to the right pricing entry. |
| pricing `base_price.amount` | **Maps to `priceAmount`** (the booking base) | The recompute base. **NOT** `from_price`. `beauty` and `speech-therapy` have `base_price.amount = 0`; the whole beauty price is built from multiselect option deltas with a `$75` floor (`min_booking`). |
| `from_price` | **Add** display-only `fromPrice Int?` | The "From $X" card band. Diverges from the math base (beauty `from_price=7500` vs `base=0`). Display only; never summed into the recompute. |
| `min_booking` | **Add** `minBooking Int?` | Hard booking floor (`beauty=7500`). Booking creation rejects totals below it (§5.2 rule 7). |
| `summary` | **Add** `summary String?` | Short blurb distinct from long `description`; nullable for migration safety. |
| `icon` | **Do NOT add to DB** | Per the Categories precedent, resolved from a config file keyed by `slug` (`resolveServiceAssets(slug)`), not a column. NOTE: like Categories, the resolved `iconPath` is a **lucide icon NAME** (e.g. `"HandHelping"`, `"Dumbbell"`), not a filesystem path (§2.6, §4). |
| `coming_soon` | **Add** `comingSoon Boolean @default(false)` | The 2 coming-soon services (Physical/Speech Therapy) have empty configs. See §5.2 rule 7 for how this composes with `isActive`. |
| `badges` | **Add** `badges String[] @default([])` | Postgres native string array; presentational, low-churn. |
| `service_type` | **Add** `serviceType String?` | Classifier; nullable. Could become an enum later if values stabilize. |
| `location_modes` (ARRAY) vs `locationMode` (SINGLE enum) | **Add** `locationModes LocationMode[] @default([])`; **keep** existing `locationMode` as the canonical default | `locationModes` = the *set offered* (catalog/booking picker); `locationMode` = the *default/primary* and the value `Booking.locationMode` snapshots from. Booking still selects exactly **one** from `locationModes`. No relation table needed for MVP. |

> **Migration safety.** Every new column is **nullable** (`pricingRef`, `summary`,
> `serviceType`, `fromPrice`, `minBooking`) or has a **default** (`comingSoon=false`,
> `badges=[]`, `locationModes=[]`). On the config tables: `priceDelta` (option) defaults
> `0`; `applies` defaults `FLAT`; `isRequired`/`isDefault` default `false`; `sortOrder`
> defaults `0`; the group `priceDelta` and all bound columns are nullable. No
> required-without-default column is introduced, so `prisma migrate dev` applies cleanly to a
> populated table. The two new tables are net-new (no backfill).
>
> Migration command: `prisma migrate dev --name add_service_config_and_catalog_fields`
> (or `npm run db:push` in dev — note the workspace-path `&` gotcha: npm scripts need
> `script-shell=powershell` on this machine).

### 2.5 Enum re-export

Add `ConfigInputType` and `ConfigApplies` to the re-export block in `src/enums/index.ts`:

```ts
export {
  UserRole, UserStatus, Brand, BookingStatus, PaymentStatus,
  WaitlistStatus, LocationMode, CategoryStatus,
  ConfigInputType, ConfigApplies,        // + NEW
  NotificationType, NotificationStatus,
} from "@prisma/client";
```

### 2.6 FK / cascade behaviour (note)

The `Service → Group → Option` cascade chain (both `onDelete: Cascade`) matches the live
schema's existing cascade style (`RefreshToken`, `AvailabilitySlot`, `WaitlistEntry`) and
prevents orphan groups/options. **However**, `Booking.service` is declared **without** a
cascade (Prisma default `Restrict`, schema line 222), so a `Service` that has bookings
**cannot be hard-deleted at all**. In practice the config cascade therefore fires only for
never-booked/draft services; for live services, config is retired via `isActive` /
`comingSoon`, **not** deletion. The design does not assume config rows are routinely
cascade-deleted.

There is intentionally **no standalone index on `key`** — `key` is only ever resolved within
a service/group scope, and the `@@unique([serviceId, key])` / `@@unique([groupId, key])`
composite indexes already cover the FK-prefix lookups. No redundant index is added.

---

## 3. REST API endpoints

Base: `/api/v1/services` (groups/options nest under a service). Registered in
`src/routes/index.ts` — the services router already mounts here; the config routes are
attached to the **same** `servicesRouter` (no new top-level mount needed).

**Nested-under-service vs top-level: choose NESTED.** A config group has no meaning
without its service, the id-alignment contract is per-service, and the booking UI always
loads config *for a service*. Nesting (`/services/:serviceId/config/...`) makes ownership
explicit in the URL, lets `validate({ params })` carry `serviceId`, and matches how the
client consumes config. Options nest one level deeper under their group.

| # | Method & Path | Auth | Purpose |
|---|---|---|---|
| 1 | `GET /services/:serviceId/config/groups` | public* | List a service's config groups (ordered), each with nested options. *Anon: only if parent category ACTIVE & not coming-soon. |
| 2 | `POST /services/:serviceId/config/groups` | staff | Create a config group on the service. |
| 3 | `PATCH /services/:serviceId/config/groups/:groupId` | staff | Edit a group (label, inputType, applies, required, order, bounds, group priceDelta). |
| 4 | `DELETE /services/:serviceId/config/groups/:groupId` | **admin** | Delete a group (cascades to its options). |
| 5 | `POST /services/:serviceId/config/groups/:groupId/options` | staff | Create an option (label, key, priceDelta, isDefault, order). |
| 6 | `PATCH /services/:serviceId/config/groups/:groupId/options/:optionId` | staff | Edit an option. |
| 7 | `DELETE /services/:serviceId/config/groups/:groupId/options/:optionId` | **admin** | Delete an option. |
| 8 | **`GET /services/:serviceId/config`** | public* | **Booking-UI read:** the service WITH its full nested config (`groups[] → options[]`), ordered. Single round-trip for the configurator. *Same visibility rule as #1. |

`staff` = `authenticate` + `authorize(UserRole.SYSTEM_ADMIN, UserRole.SYSTEM_COORDINATOR)`.
**`admin`** = `authenticate` + `authorize(UserRole.SYSTEM_ADMIN)` only. **The two DELETE
endpoints (#4, #7) are admin-only to match the services-module destructive-operation
convention** — `services.routes.ts` guards `DELETE /:id` with `authorize(UserRole.SYSTEM_ADMIN)`
(no COORDINATOR). Config deletes are destructive (cascade), so they follow the same rule
rather than the looser `staff` guard used for create/edit. Public reads use
`optionalAuthenticate` so staff bypass the ACTIVE-category / coming-soon visibility filter
(matches the existing services/categories pattern).

> **No status/lifecycle endpoints** for config (unlike Categories). Config visibility is
> inherited from the parent service/category; a group has no independent DRAFT/ACTIVE state
> in MVP. Bulk **replace** (`PUT /services/:serviceId/config`) is noted as post-MVP (§8).

---

## 4. Request / response DTOs

All responses use the shared envelope (`utils/api-response.ts`):
`{ success: true, message, data: T, meta?: PaginationMeta }`.

```ts
import type { ConfigInputType, ConfigApplies, LocationMode } from "../../enums";

// ── Resource shapes (serialized API contracts) ─────────────────────────────

/** A single choice within a group. */
export interface ConfigOptionResponse {
  id: string;
  key: string;            // == pricing modifier option id (verbatim source id)
  label: string;
  priceDelta: number;     // SIGNED minor units (cents), in the service currency; 0 = no change
  isDefault: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A configurable dimension, with its ordered options nested in. */
export interface ConfigGroupResponse {
  id: string;
  serviceId: string;
  key: string;            // == pricing modifier id (verbatim source id)
  label: string;
  inputType: ConfigInputType;
  applies: ConfigApplies;     // FLAT | PER_UNIT — scales priceDelta by quantity
  isRequired: boolean;
  sortOrder: number;
  priceDelta: number | null;  // group-level delta for QUANTITY/TOGGLE; null for SELECT/MULTISELECT
  selectMin: number | null;   // multiselect selection-count bounds
  selectMax: number | null;
  quantityMin: number | null; // quantity numeric bounds
  quantityMax: number | null;
  quantityStep: number | null;
  options: ConfigOptionResponse[];   // empty for QUANTITY / TOGGLE
  createdAt: Date;
  updatedAt: Date;
}

/** Booking-UI payload — a service WITH its full nested configuration (endpoint #8). */
export interface ServiceWithConfigResponse {
  id: string;
  name: string;
  slug: string;
  pricingRef: string | null;    // pricing.v1.json key (id-alignment resolution)
  summary: string | null;
  description: string | null;
  categoryId: string;
  priceAmount: number;          // BASE for booking math (= pricing base_price.amount), cents
  fromPrice: number | null;     // DISPLAY-ONLY "From $X" band; NOT summed into price
  minBooking: number | null;    // hard booking floor, cents
  currency: string;
  durationMinutes: number;
  locationMode: LocationMode;   // default/primary
  locationModes: LocationMode[];// full set offered (booking picks one)
  serviceType: string | null;
  comingSoon: boolean;
  badges: string[];
  iconPath: string;             // lucide icon NAME (e.g. "HandHelping"), resolved from
                                // config by slug — NOT a DB column, NOT a filesystem path
  isActive: boolean;
  configGroups: ConfigGroupResponse[];  // ordered; each with ordered options[]
  createdAt: Date;
  updatedAt: Date;
}

// ── Request DTOs (inferred from zod, §5) ────────────────────────────────────

export interface CreateConfigGroupDto {
  key: string;                   // REQUIRED — verbatim pricing modifier id (NOT label-slugged)
  label: string;                 // required
  inputType: ConfigInputType;    // required
  applies?: ConfigApplies;       // default FLAT
  isRequired?: boolean;          // default false
  sortOrder?: number;            // default 0
  priceDelta?: number;           // QUANTITY/TOGGLE only; signed cents
  selectMin?: number;            // multiselect only
  selectMax?: number;            // multiselect only
  quantityMin?: number;          // quantity only
  quantityMax?: number;          // quantity only
  quantityStep?: number;         // quantity only
}

export interface UpdateConfigGroupDto {       // all optional, >= 1 required
  key?: string;
  label?: string;
  inputType?: ConfigInputType;
  applies?: ConfigApplies;
  isRequired?: boolean;
  sortOrder?: number;
  priceDelta?: number | null;
  selectMin?: number | null;
  selectMax?: number | null;
  quantityMin?: number | null;
  quantityMax?: number | null;
  quantityStep?: number | null;
}

export interface CreateConfigOptionDto {
  key: string;                   // REQUIRED — verbatim pricing modifier option id (NOT slugged)
  label: string;                 // required
  priceDelta?: number;           // default 0; signed cents (MVP: >= 0)
  isDefault?: boolean;           // default false
  sortOrder?: number;            // default 0
}

export interface UpdateConfigOptionDto {       // all optional, >= 1 required
  key?: string;
  label?: string;
  priceDelta?: number;
  isDefault?: boolean;
  sortOrder?: number;
}
```

---

## 5. Validation rules

### 5.1 Field validation (zod, in `service-config.validation.ts`)

| Field | Rule |
|---|---|
| `key` | `z.string().trim().min(1).max(80).regex(slugRegex)` — same regex as Categories (`^[a-z0-9]+(?:-[a-z0-9]+)*$`); **REQUIRED on create**, carried verbatim from the source modifier/option id. (`min(1)` because real ids like `1`, `2` are valid; the existing ids `60`, `pack-4`, `3-plus`, `hot-stones` all already satisfy the regex.) **Never auto-slugged from `label`** — `slugify(label)` is only an admin-UI suggestion. |
| `label` | `z.string().trim().min(2).max(80)`, required on create |
| `inputType` | `z.nativeEnum(ConfigInputType)`, required on create |
| `applies` | `z.nativeEnum(ConfigApplies).default("FLAT")` |
| `isRequired` / `isDefault` | `z.boolean().default(false)` |
| `sortOrder` | `z.number().int().nonnegative().default(0)` |
| group `priceDelta` | `z.number().int().default(0)` optional/nullable; meaningful only for QUANTITY/TOGGLE |
| option `priceDelta` | `z.number().int("Price delta must be a whole number of cents").nonnegative().default(0)` — **integer**; **MVP enforces `>= 0`** (surcharges only; discounts arrive as fees). Loosen later for bundles (§8.4). |
| `selectMin` / `selectMax` | `z.number().int().nonnegative()` optional (nullable on update); multiselect only |
| `quantityMin` / `quantityMax` / `quantityStep` | `z.number().int().positive()` optional (nullable on update); quantity only |
| `:serviceId` / `:groupId` / `:optionId` (params) | `z.string().uuid()` (matches `serviceIdSchema`) |
| update body | `.partial()` + `.refine(obj => Object.keys(obj).length > 0, "At least one field must be provided")` |

### 5.2 Business rules (service layer)

1. **Service exists & owns the group/option.** Every nested call first asserts the
   `serviceId` exists, then that the `groupId` belongs to that service and the `optionId`
   belongs to that group — else `ApiError.notFound`. (Prevents cross-service tampering via
   mismatched ids in the URL.) NOTE: this reuses `servicesService.getById(serviceId, staff)`
   for ownership + the public-visibility check, **but** that method today returns the **raw
   Prisma row** (`const { category, ...rest } = service; return rest;`) with no asset
   resolution and none of the new catalog fields. See §7 — the new serialized read path
   (`ServiceWithConfigResponse`, `iconPath`, catalog fields) is **net-new serialization
   work**, not an existing reuse.
2. **`key` is operator-supplied and unique in scope.** `key` is **required** and used
   verbatim (NOT slugged from `label`). Validate only with the slug regex (§5.1). Group key
   unique per `serviceId`; option key unique per `groupId` (pre-check, exclude-self on
   update; DB `@@unique` is the backstop). *If pricing lived server-side, we would also
   validate that the supplied `key` resolves to a real modifier/option id under
   `service.pricingRef`; since pricing is client-side today, this is enforced at **import**
   time (the importer copies ids verbatim from `pricing.v1.json`) and is flagged as a
   post-MVP server-side validation in §8.6.*
3. **Input-type ↔ structure consistency.**
   - `SELECT` / `MULTISELECT` groups **hold options[]**; deltas live on the option rows.
     Creating an option against a `QUANTITY`/`TOGGLE` group → `ApiError.badRequest`.
   - `QUANTITY` has **no** options; uses `quantityMin`/`quantityMax`/`quantityStep` and the
     **group-level** `priceDelta` (per-unit when `applies = PER_UNIT`). MVP-flagged (§8.3).
   - `TOGGLE` has **no** options; uses the **group-level** `priceDelta`, applied when "on".
     MVP-flagged (§8.3).
4. **Multiselect bounds (MULTISELECT only).** When both set, `selectMin <= selectMax`
   (`ApiError.badRequest`). `selectMax` must not exceed the number of options in the group.
   **This check applies only to MULTISELECT** — it must NOT be applied to QUANTITY (whose
   bounds are raw numeric values with no option-count relationship; a positive quantity max
   against 0 options would otherwise always be rejected). Quantity bounds use the separate
   `quantityMin`/`quantityMax` columns and validate only `quantityMin <= quantityMax`.
   Multiselect bounds are **net-new product policy** (no source data sets them); default
   `null` = unbounded.
5. **Default-choice cardinality — "at most one default":**
   - A `SELECT` group has **at most one** option with `isDefault=true` (zero allowed).
   - `MULTISELECT` may have **0..N** defaults.
   - **Rationale:** the source catalog carries ZERO `default` fields (verified — no
     `default` on any `config_option`), so a faithful import yields required SELECTs with no
     default. A "must have exactly one" rule would make the catalog un-importable. Instead the
     booking UI **forces an explicit choice** for a required SELECT with no default (§8.5).
   - Setting an option `isDefault=true` on a `SELECT` group **clears** the flag on its
     siblings in the same service call (single transaction).
   - **Known limitation:** Postgres partial-unique (`unique(groupId) where isDefault`) is not
     expressible in the Prisma schema, so "at most one default" is **app-enforced only and
     racy** under concurrent writes; the sibling-clear transaction makes the common path safe
     but two simultaneous writers could still produce two defaults. Acceptable for MVP
     (single-admin editing); revisit if concurrency becomes real.
6. **`priceDelta` is integer cents.** Enforced by zod; defense-in-depth `Number.isInteger`
   check in the service. **MVP sign policy: `>= 0`** (§8.4). Because the DB has no check
   constraint, the booking-creation recompute (§8.2) is the real integrity guard.
7. **Coming-soon & bookability.** Bookability composes two flags. `bookings.service.ts`
   already rejects `!service.isActive` ("This service is not currently bookable"). **MVP
   rule: `comingSoon=true` ⇒ not bookable regardless of `isActive`** — booking creation
   rejects a coming-soon service even if `isActive` is true; coming-soon services are
   typically seeded `isActive=false` as well, but `comingSoon` is the authoritative
   not-yet-launched gate and is checked explicitly in `bookings.service.create`. The 2
   coming-soon services (Physical/Speech Therapy) carry empty configs, consistent with this.
8. **Minimum-booking floor.** When `service.minBooking` is set, booking creation computes the
   total via the §8.2 recompute and rejects (`ApiError.badRequest`) if `total < minBooking`
   (mirrors the client wizard blocking advancement below the floor; `beauty=7500`).

---

## 6. Error handling scenarios

Thrown as `ApiError.*` and serialized by the global handler into
`{ success: false, message, details? }`.

| Scenario | Factory | HTTP | Message |
|---|---|---|---|
| Missing/invalid body field (zod) | `validate` middleware → `ApiError.unprocessable` | 422 | "Validation failed" (+ field `details`) |
| `key` missing on create | zod / `badRequest` | 422 / 400 | "A config key is required (the pricing modifier/option id)" |
| `key` fails slug regex | zod | 422 | "Key may contain only lowercase letters, numbers, and hyphens" |
| `priceDelta` not an integer / negative (MVP) | zod / `badRequest` | 422 / 400 | "Price delta must be a non-negative whole number of cents" |
| `selectMin > selectMax` / `quantityMin > quantityMax` | `ApiError.badRequest` | 400 | "Minimum must be <= maximum" |
| `selectMax` exceeds option count (multiselect) | `ApiError.badRequest` | 400 | "selectMax cannot exceed the number of options" |
| Option create on QUANTITY/TOGGLE group | `ApiError.badRequest` | 400 | "This group's input type does not support options" |
| SELECT with multiple defaults | `ApiError.badRequest` | 400 | "A single-select group may have at most one default option" |
| Duplicate group `key` in service | `ApiError.conflict` | 409 | "A config group with this key already exists for this service" |
| Duplicate option `key` in group | `ApiError.conflict` | 409 | "A config option with this key already exists in this group" |
| Empty update body | `ApiError.badRequest` | 400 | "At least one field must be provided" |
| Service id not found | `ApiError.notFound` | 404 | "Service not found" |
| Group not found / not under service | `ApiError.notFound` | 404 | "Config group not found" |
| Option not found / not under group | `ApiError.notFound` | 404 | "Config option not found" |
| Booking below `minBooking` floor | `ApiError.badRequest` | 400 | "Booking total is below the minimum for this service" |
| Booking a coming-soon / inactive service | `ApiError.badRequest` | 400 | "This service is not currently bookable" |
| Not authenticated | `authenticate` → `ApiError.unauthorized` | 401 | "Unauthorized" |
| Wrong role (incl. COORDINATOR hitting a DELETE) | `authorize` → `ApiError.forbidden` | 403 | "Forbidden" |
| Anon reads config of non-ACTIVE/coming-soon service | treated as not found (visibility) | 404 | "Service not found" |
| Prisma unique violation (race, P2002) | mapped → `ApiError.conflict` | 409 | "A config group/option with this key already exists" |
| Unexpected | `ApiError.internal` | 500 | "Internal server error" |

---

## 7. Recommended folder structure

The config endpoints live **inside the existing `modules/services/` folder** as a `config`
sub-feature (they nest under `/services/:serviceId/...` and share the service-ownership
check), following the `modules/categories/*` file layout.

> **Deviation called out:** every other feature is a flat top-level folder under `modules/*`
> (categories, services, bookings, …) with its own `index.ts` re-exporting a router; no
> existing module has a nested sub-module of full file sets. Nesting `config/` under
> `modules/services/` is an **intentional** deviation justified by the URL nesting
> (`/services/:serviceId/config/...`) and the shared service-ownership check. The
> alternative — a sibling `modules/service-config/` that imports `servicesService` — was
> considered and rejected because it splits ownership of the same URL subtree across two
> modules. Either is defensible; this design picks nesting and flags it.

New + touched files:

```
Server/
├─ prisma/
│  └─ schema.prisma                         # + ConfigInputType, ConfigApplies enums
│                                           # + ServiceConfigGroup, ServiceConfigOption models
│                                           # + Service: pricingRef/summary/serviceType/
│                                           #   fromPrice/minBooking/comingSoon/badges/
│                                           #   locationModes + configGroups relation
├─ src/
│  ├─ enums/
│  │  └─ index.ts                           # + re-export ConfigInputType, ConfigApplies
│  ├─ config/
│  │  └─ service-assets.ts                  # NEW: slug -> { iconPath } (lucide NAME),
│  │                                        #   mirrors config/category-assets.ts
│  └─ modules/
│     └─ services/
│        ├─ services.service.ts             # MUST GAIN a serialize() step (see below)
│        ├─ services.types.ts               # + new catalog fields on the service response
│        ├─ services.*.ts                   # other existing files (mostly unchanged)
│        └─ config/                          # NEW sub-module (follows categories/* layout)
│           ├─ service-config.validation.ts # zod: create/update group + option, id params
│           ├─ service-config.types.ts      # DTO + response types (incl. ServiceWithConfigResponse)
│           ├─ service-config.repository.ts # thin Prisma wrapper (findMany/findById/create/
│           │                               #   update/delete for group + option; nested include)
│           ├─ service-config.service.ts    # ownership asserts, key uniqueness, input-type
│           │                               #   rules, default-cardinality, serialize()
│           ├─ service-config.controller.ts # arrow handlers → sendSuccess(...)
│           └─ service-config.routes.ts     # Router(mergeParams) + authenticate/authorize/validate
```

**Touch-points (explicit):**
- `src/enums/index.ts` — add `ConfigInputType` and `ConfigApplies` to the `@prisma/client`
  re-export block (§2.5).
- `src/modules/services/services.routes.ts` — mount the config sub-router:
  `servicesRouter.use("/:serviceId/config", serviceConfigRouter)` and use
  `Router({ mergeParams: true })` in the sub-router so `:serviceId` is visible.
- `src/modules/services/index.ts` — re-export `serviceConfigRouter` if the parent needs it
  (otherwise the mount in `services.routes.ts` is sufficient; **no** new entry in
  `src/routes/index.ts` because everything stays under the existing `/services` mount).
- **`src/modules/services/services.service.ts` + `services.types.ts` — NET-NEW serialization
  work, not reuse.** `getById` **currently returns the raw Prisma row** with no asset
  resolution and none of the new catalog fields. To serve `ServiceWithConfigResponse`, the
  services service must **gain a `serialize()` step modeled on `CategoriesService.serialize`**
  (which merges `resolveCategoryAssets(slug)` per row) — Categories has one, services does
  not. Either `getById`'s return shape changes to the serialized shape, or a dedicated
  serialized read path is added for the config endpoints. `iconPath` and the catalog fields
  are produced by this new `serialize()`, resolving `iconPath` (a lucide **name**) from
  `config/service-assets.ts`. (A `coverImagePath` analog is left as an open decision, §8.6.)

> The config service layer reuses `servicesService.getById(serviceId, staff)` for the
> ownership + visibility check before any group/option mutation, so the public-visibility
> rule (ACTIVE category, not coming-soon) is enforced once and consistently.

---

## 8. Open decisions for the product owner

### 8.1 Unify vs keep separate: marketing Configurator vs bookable config
**Recommendation: keep separate for MVP.** The research (§2) is explicit that the two models
serve different masters: the marketing `ConfiguratorGroup` (landing pages) carries
illustrative text notes (`"+$20"`) and even **phantom options** that don't exist in the
catalog (a *Couples* +$60 add-on appears in marketing but not in `services.json`/pricing).
The bookable config is transactional and must obey the id-alignment contract. Merging now
risks either (a) leaking phantom options into the booking flow, or (b) constraining marketing
copy to live pricing prematurely.

**Post-MVP unification path** (the better long-term shape): make the bookable config the
**source of truth** and *derive* marketing `ConfiguratorGroup`s from it at render time, with
marketing-only fields (per-group icon, illustrative note) layered on via a thin presentation
config. That kills the stale-notes / phantom-option divergence. **Decision needed:** invest
in this derivation now, or accept duplicated config until divergence bites at checkout?

### 8.2 How will bookings reference selections, and how is price recomputed?
`Booking` currently has **no** column for config selections and `priceAmount` is snapshotted
from `service.priceAmount` only — add-on deltas, quantity, fees, and the floor are all lost.

**(A) Storage shape — decision needed.** Options:
- **(a)** `Booking.configurationData Json?` — a `selections` dict plus a frozen `lineItems[]`
  snapshot. Matches the client `Configuration` contract; one column. *Recommended for MVP.*
- **(b)** A `BookingSelection` relation table (one row per chosen option) — queryable but
  heavier and needs its own module.
- **(c)** Store only the recomputed total + a denormalized human-readable summary.

The `selections` value shape should mirror the canonical `ConfigurationSchema`
(`contract.schema.ts`): `selections: Record<string, string | number | boolean | string[]>`
keyed by **modifier id** (= `group.key`), plus a sibling `quantity: number` (`>= 1`). This
matches the design's keys exactly.

**(B) The recompute contract — this MUST mirror `Client/src/lib/pricing/engine.ts` exactly,
NOT "base + Σ delta".** The canonical algorithm, against `pricing.v1.json` entry
`services[service.pricingRef]`:

1. `subtotal = base_price.amount * quantity`  *(the base IS scaled by quantity).*
2. For each modifier `m` whose selection `sel` is not `null`/`false`:
   - Normalize `sel` to an array (`string[]` for multiselect, single id otherwise).
   - For each selected id: `delta = option.priceDelta ?? group.priceDelta` (skip if falsy).
   - `amount = (group.applies === PER_UNIT) ? delta * quantity : delta`.
   - `subtotal += amount`. **For MULTISELECT, sum the delta of EVERY selected key** (e.g.
     beauty `hair-styling` + `blowout` = `5500 + 4500`); **skip `null`/`false` selections**.
3. `total = subtotal`; then for each fee `f` in `services[pricingRef].fees`:
   - `base = (f.calc === 'percent') ? round(subtotal * f.value / 100) : f.value`.
   - `amount = (f.kind === 'discount') ? -base : base`.
   - `total += amount`.
4. Enforce the floor: if `service.minBooking` is set and `total < minBooking`, reject (§5.2
   rule 8) — do **not** silently clamp.

All current services have `fees: []`, but the engine processes them and `services.json` may
add a fee/discount later, so the server must implement the fee loop now to stay parity-safe.
A `base + Σ delta` recompute would silently disagree with the client `DisplayedPrice` for any
`quantity > 1` or any future fee — either rejecting legitimate bookings or accepting tampered
ones.

**(C) Where do fees live?** No fee table is proposed (the source `fees[]` is currently empty
for all 8 services). **Decision needed:** when a fee/discount is actually introduced, model
`fees[]` as a third child table (`ServiceConfigFee`: `kind`, `calc`, `value`) mirroring
`FeeSchema`, or as a JSON column on `Service`. Out of scope for MVP given empty source data,
but the recompute above is written to consume them.

**Decision needed:** confirm (a) for storage, confirm we re-derive the total server-side via
the engine-parity algorithm above at creation (never trusting the client total), and confirm
where `fees[]` will live when needed.

### 8.3 Quantity / toggle inputs: scope and bounds
There are **no** QUANTITY or TOGGLE examples in the real data (all 8 services use only
SELECT/MULTISELECT). The schema models them (group-level `priceDelta`, `applies`,
`quantityMin/Max/Step`) so they're representable, but they are **net-new, untested by real
data**. **Decision needed:** do MVP services need quantity/toggle at all? If not, we can
forbid creating them in MVP (reject `inputType IN (QUANTITY, TOGGLE)` until a real service
needs one) to avoid shipping an unexercised code path. Multiselect bounds (`selectMin/Max`)
are likewise net-new policy (no source data sets them) — confirm whether MVP should expose
them or leave them always-null.

### 8.4 Price-delta sign convention & currency
MVP stores `priceDelta` as a **signed** `Int` but **validates `>= 0`** (surcharges only; all
current data is `>= 0`). **Decision needed:** keep `>= 0`, or allow negatives so an option can
reduce price (bundles, loyalty)? The schema supports both; §5.1 is the lever. Separately, the
source deltas are **currency-tagged** Money but we store a bare `Int` interpreted as the
service currency; **mixed-currency deltas are out of scope** and import validates
`delta.currency === service.currency`. Confirm that single-currency assumption is acceptable.

### 8.5 Default semantics for required vs optional groups
MVP enforces **"at most one default"** (zero allowed) because the source carries no defaults
(§5.2 rule 5). This means a required SELECT with no default requires the booking UI to
**force an explicit choice** before a price can be computed. **Decision needed:** confirm the
UI forces selection for defaultless required SELECTs (vs. the importer auto-picking the first
option as the default). Also confirm whether multiselect defaults should pre-check options or
merely suggest them.

### 8.6 Server-side pricing validation, assets, and stale extract
- **Pricing source of truth.** Pricing lives **client-side** today (`pricing.v1.json`); the
  server has no modifier table, so it cannot validate at write time that a created `key`
  resolves to a real pricing id. The importer copies ids verbatim. **Decision needed:** do we
  port `pricing.v1.json` (and the `engine.ts` algorithm) server-side so booking recompute and
  key validation are authoritative on the server, or keep the client as the pricing authority
  and have the server validate against a synced copy?
- **Asset analog.** Categories resolve both `coverImagePath` and `iconPath`; the service
  resolver currently returns only `iconPath` (a lucide name). **Decision needed:** does the
  service card need a `coverImagePath` analog too?
- **Stale research extract (note, not a decision).** `services-content-extract.md` §3
  summarizes each service as a single `tier` select — this is **out of date** relative to
  `services.json` (3–4 rich groups each). The migration must read `services.json` +
  `pricing.v1.json` directly; do not seed from the §3 prose.

---

## Changelog vs first draft

| # | Reviewer issue (severity) | Change made |
|---|---|---|
| 1 | Recompute = "base + Σ delta" ignores quantity & fees (**blocker**) | Rewrote the recompute contract in §8.2(B) to mirror `engine.ts` exactly: base × quantity, per-unit scaling, fee loop (percent/flat, discounts negated), floor enforcement. Removed "base + Σ priceDelta" as the canonical formula everywhere. Added `applies ConfigApplies` enum + `ServiceConfigGroup.applies` (§0, §2.1, §2.2) to carry per-unit scaling. Fee storage flagged in §8.2(C). |
| 2 | `pricing_ref` indirection collapsed away (**blocker**) | Added `pricingRef String?` to `Service` (§2.4); restated the id-alignment contract as `group.key ↔ modifiers[].id WITHIN services[pricingRef]` (cover note, §0, §1). Noted `nutrition-coaching`'s `landing_slug` divergence as the reason slug ≠ pricing_ref. |
| 3 | `from_price` → `priceAmount` corrupts base for beauty/speech (**blocker**) | `priceAmount` now seeded from pricing `base_price.amount`; added separate display-only `fromPrice Int?`; §2.4 mapping + §4 comment corrected; explicitly noted beauty/speech `base=0`. |
| 4 | `min_booking` floor unmodeled (**blocker**) | Added `minBooking Int?` to `Service` (§2.4); booking creation rejects totals below it (§5.2 rule 8, §8.2 step 4, §6). |
| 5 | id-alignment auto-slug violates the contract (**blocker** ×1, **major** ×1, two reviewers) | `key` is now **required, operator-supplied, verbatim from the source id**, never auto-slugged (§0 key-source row, §2.2/§2.3 comments, §5.1, §5.2 rule 2, §4 DTOs). `slugify(label)` demoted to a UI suggestion. Documented that real ids (`60`, `pack-4`, `3-plus`, `duration`) are not label slugs. |
| 6 | `priceDelta` can't represent TOGGLE/QUANTITY group-level delta (**blocker** ×1, **major** ×1, two reviewers) | Added optional `priceDelta Int?` on `ServiceConfigGroup` mirroring engine's `m.delta` fallback (§0, §2.2, §2.3 note, §1 input-type rule); QUANTITY/TOGGLE also flagged as MVP-scope decisions (§8.3). |
| 7 | "exactly one default" un-importable from source (**major** ×1, **major** ×1) | Relaxed to **"at most one default"** (§0, §5.2 rule 5, §6); documented that source has zero defaults and the booking UI forces an explicit choice (§8.5). |
| 8 | DB can't enforce "one default"; app-only & racy (**major**) | §5.2 rule 5 now states the invariant is app-enforced via sibling-clear transaction and **racy** under concurrency (partial-unique not expressible in Prisma); accepted for MVP. |
| 9 | Multiselect max vs quantity bound overload self-contradictory (**major**) | Split into separate columns `selectMin/selectMax` (multiselect) vs `quantityMin/quantityMax/quantityStep` (quantity) (§0, §2.2); §5.2 rule 4 gates the "max ≤ option count" check to MULTISELECT only. Noted bounds are net-new policy defaulting to null. |
| 10 | `services.service` has no `serialize()`; not "reuse" (**major**) | §5.2 rule 1 and §7 now state `getById` returns the raw row and that a `serialize()` step (modeled on `CategoriesService.serialize`) is **net-new work**, not existing reuse. |
| 11 | DELETE role guard diverges from services convention (**major**) | Config DELETE endpoints (#4, #7) changed to **admin-only** (`authorize(SYSTEM_ADMIN)`) to match `services.routes.ts` (§3, §6). |
| 12 | Multiselect summation / skip semantics not written down (**minor**) | §8.2(B) step 2 now states the server sums delta across ALL selected multiselect keys and skips `null`/`false`, referencing `engine.ts`. |
| 13 | Currency assumed uniform (**minor**) | §2.3 currency note + §8.4: `priceDelta` inherits service currency, mixed-currency out of scope, import validates `delta.currency === service.currency`. |
| 14 | Stale config_options summary in extract §3 (**nit**) | Cover note + §8.6 cite `services.json`/`pricing.v1.json` as the migration source of truth and flag extract §3 as stale. |
| 15 | `priceDelta` signed with no DB constraint (**minor**) | §2.3 note + §5.1: MVP sign policy is `>= 0` enforced in zod; booking recompute is explicitly load-bearing for integrity (no DB check). |
| 16 | FK cascade vs `Booking.service` restrict (**minor**) | Added §2.6: `Booking.service` is `Restrict`, so config cascade fires only for never-booked/draft services; live config is retired via `isActive`/`comingSoon`. |
| 17 | No standalone `key` index (**nit**) | §2.6 notes `key` is only resolved within service/group scope, justifying the absence of a standalone index. |
| 18 | Migration safety of new columns (**nit**) | Re-confirmed in §2.4 migration note (all new columns nullable/defaulted). |
| 19 | `iconPath` is an icon NAME, not a path (**minor**) | §2.4 mapping + §4 DTO comment + §7 now state `iconPath` is a lucide **name** (e.g. "HandHelping"), not a filesystem path; `coverImagePath` analog flagged in §8.6. |
| 20 | `comingSoon` vs existing `isActive` gate unspecified (**minor**) | §5.2 rule 7: `comingSoon=true` ⇒ not bookable regardless of `isActive`; checked explicitly in `bookings.service.create`; coming-soon typically also seeded `isActive=false`. |
| 21 | Nested sub-module deviates from flat `modules/*` layout (**nit**) | §7 explicitly acknowledges the nesting as an intentional deviation, with the rejected sibling-module alternative noted. |
