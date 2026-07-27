-- MIGRATE phase: populate geography and backfill existing rows.
--
-- WHY THIS DATA LIVES IN MIGRATION SQL AND NOT prisma/seed.ts:
-- Render's scripts/postinstall.js runs ONLY `prisma generate`, `npm run build`
-- and `prisma migrate deploy`. It NEVER runs the seed. If the Areas lived only in
-- seed.ts, production would have zero Area rows -> zero coverage rows -> under
-- default-deny EVERY SERVICE BECOMES SILENTLY UNBOOKABLE. So the rows that the
-- application's correctness depends on are created here.
--
-- Every statement is idempotent (ON CONFLICT DO NOTHING / WHERE ... IS NULL), so
-- a partial failure can be re-run and a re-deploy is a no-op.
--
-- Still backwards-compatible: nothing is dropped and the legacy "Booking"."area"
-- enum column keeps its values. The previously-deployed server is unaffected.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The 12 areas, carried over 1:1 from the ServiceArea enum.
--    slug = lower(replace(enum_value,'_','-')), which is exactly what
--    src/utils/slugify.ts produces from each display name.
--    NOTE "Fuquay-Varina" is HYPHENATED — a naive underscore->space transform
--    yields "Fuquay Varina", which is wrong.
--    All ACTIVE. sortOrder is alphabetical so admin lists and the public coverage
--    band are stable without an explicit sort argument.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "Area" ("id", "name", "slug", "stateCode", "countryCode", "timezone", "status", "sortOrder", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid(), 'Apex',          'apex',          'NC', 'US', 'America/New_York', 'ACTIVE',  10, NOW(), NOW()),
  (gen_random_uuid(), 'Cary',          'cary',          'NC', 'US', 'America/New_York', 'ACTIVE',  20, NOW(), NOW()),
  (gen_random_uuid(), 'Fuquay-Varina', 'fuquay-varina', 'NC', 'US', 'America/New_York', 'ACTIVE',  30, NOW(), NOW()),
  (gen_random_uuid(), 'Garner',        'garner',        'NC', 'US', 'America/New_York', 'ACTIVE',  40, NOW(), NOW()),
  (gen_random_uuid(), 'Holly Springs', 'holly-springs', 'NC', 'US', 'America/New_York', 'ACTIVE',  50, NOW(), NOW()),
  (gen_random_uuid(), 'Knightdale',    'knightdale',    'NC', 'US', 'America/New_York', 'ACTIVE',  60, NOW(), NOW()),
  (gen_random_uuid(), 'Morrisville',   'morrisville',   'NC', 'US', 'America/New_York', 'ACTIVE',  70, NOW(), NOW()),
  (gen_random_uuid(), 'Raleigh',       'raleigh',       'NC', 'US', 'America/New_York', 'ACTIVE',  80, NOW(), NOW()),
  (gen_random_uuid(), 'Rolesville',    'rolesville',    'NC', 'US', 'America/New_York', 'ACTIVE',  90, NOW(), NOW()),
  (gen_random_uuid(), 'Wake Forest',   'wake-forest',   'NC', 'US', 'America/New_York', 'ACTIVE', 100, NOW(), NOW()),
  (gen_random_uuid(), 'Wendell',       'wendell',       'NC', 'US', 'America/New_York', 'ACTIVE', 110, NOW(), NOW()),
  (gen_random_uuid(), 'Zebulon',       'zebulon',       'NC', 'US', 'America/New_York', 'ACTIVE', 120, NOW(), NOW())
ON CONFLICT ("slug") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ZIP codes — 41 real, currently-deliverable Wake County (and immediately
--    adjacent) ZIPs, all ACTIVE.
--
--    !! NEEDS USPS VERIFICATION BEFORE REAL PRODUCTION USE !!
--    Market assignment is a BUSINESS decision, not a geographic fact. Several
--    genuinely straddle municipal lines (27502 Apex/Cary, 27587 Wake
--    Forest/Franklin Co.) and a few are adjacent-county ZIPs deliberately
--    assigned to the nearest market — which is precisely the
--    "Area = operating market, not boundary" doctrine on model Area.
--    PO-box-only ZIPs are excluded: you cannot book an on-site service at a PO box.
--
--    Raleigh carries 16 so pagination, prefix search and the grouped ZIP picker
--    are all demonstrable against a single area.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "ZipCode" ("id", "areaId", "zipCode", "city", "stateCode", "countryCode", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."id", v."zip", v."city", 'NC', 'US', 'ACTIVE', NOW(), NOW()
FROM (VALUES
  -- Raleigh (16)
  ('27601', 'Raleigh',       'raleigh'),
  ('27603', 'Raleigh',       'raleigh'),
  ('27604', 'Raleigh',       'raleigh'),
  ('27605', 'Raleigh',       'raleigh'),
  ('27606', 'Raleigh',       'raleigh'),
  ('27607', 'Raleigh',       'raleigh'),
  ('27608', 'Raleigh',       'raleigh'),
  ('27609', 'Raleigh',       'raleigh'),
  ('27610', 'Raleigh',       'raleigh'),
  ('27612', 'Raleigh',       'raleigh'),
  ('27613', 'Raleigh',       'raleigh'),
  ('27614', 'Raleigh',       'raleigh'),
  ('27615', 'Raleigh',       'raleigh'),
  ('27616', 'Raleigh',       'raleigh'),
  ('27617', 'Raleigh',       'raleigh'),
  ('27695', 'Raleigh',       'raleigh'),        -- NC State campus
  -- Cary (5)
  ('27511', 'Cary',          'cary'),
  ('27512', 'Cary',          'cary'),
  ('27513', 'Cary',          'cary'),
  ('27518', 'Cary',          'cary'),
  ('27519', 'Cary',          'cary'),
  -- Apex (3)
  ('27502', 'Apex',          'apex'),
  ('27523', 'Apex',          'apex'),
  ('27539', 'Apex',          'apex'),
  -- Wake Forest (3)
  ('27587', 'Wake Forest',   'wake-forest'),
  ('27588', 'Wake Forest',   'wake-forest'),
  ('27596', 'Youngsville',   'wake-forest'),    -- Franklin Co., adjacent
  -- Morrisville (2)
  ('27560', 'Morrisville',   'morrisville'),
  ('27562', 'New Hill',      'morrisville'),
  -- Garner (2)
  ('27529', 'Garner',        'garner'),
  ('27520', 'Clayton',       'garner'),         -- Johnston Co., adjacent
  -- Holly Springs (1)
  ('27540', 'Holly Springs', 'holly-springs'),
  -- Fuquay-Varina (3)
  ('27526', 'Fuquay-Varina', 'fuquay-varina'),
  ('27592', 'Willow Spring', 'fuquay-varina'),
  ('27501', 'Angier',        'fuquay-varina'),  -- Harnett Co., adjacent
  -- Knightdale (1)
  ('27545', 'Knightdale',    'knightdale'),
  -- Wendell (2)
  ('27591', 'Wendell',       'wendell'),
  ('27557', 'Middlesex',     'wendell'),        -- Nash Co., adjacent
  -- Zebulon (2)
  ('27597', 'Zebulon',       'zebulon'),
  ('27549', 'Franklinton',   'zebulon'),        -- Franklin Co., adjacent
  -- Rolesville (1)
  ('27571', 'Rolesville',    'rolesville')
) AS v("zip", "city", "areaSlug")
JOIN "Area" a ON a."slug" = v."areaSlug"
ON CONFLICT ("zipCode") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE DAY-ONE COVERAGE BACKFILL — the highest-risk step in the whole plan.
--
--    Resolution is DEFAULT-DENY. An empty coverage table therefore means every
--    service is unbookable everywhere. Granting every existing service area-wide
--    ALLOW in every area reproduces exactly today's behaviour (where any of the
--    12 towns was bookable for anything) and nothing more.
--
--    COMING_SOON / DRAFT services are included ON PURPOSE: ServiceStatus already
--    gates bookability, and excluding them here would silently break them on the
--    day somebody publishes them.
--
--    autoIncludeNewZips stays true — with zero exclusions anywhere it is dormant.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "ServiceAreaCoverage" ("id", "serviceId", "areaId", "effect", "autoIncludeNewZips", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."id", a."id", 'ALLOW', true, NOW(), NOW()
FROM "Service" s
CROSS JOIN "Area" a
ON CONFLICT ("serviceId", "areaId") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Backfill existing bookings from the legacy enum to the new FK + snapshot.
--    Only touches rows that have a legacy value and no new value yet, so it is
--    re-runnable. zipCodeId stays NULL: historical bookings never captured a ZIP
--    and inventing one would fabricate history.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "Booking" b
SET "areaId" = a."id",
    "areaNameSnapshot" = a."name",
    "coverageSource" = 'AREA_FALLBACK'  -- honest: granted by area, ZIP never known
FROM "Area" a
WHERE a."slug" = lower(replace(b."area"::text, '_', '-'))
  AND b."area" IS NOT NULL
  AND b."areaId" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verification. These are assertions, not comments: the migration FAILS loudly
--    rather than leaving the catalogue quietly unbookable.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  area_count      bigint;
  uncovered       bigint;
  orphan_bookings bigint;
BEGIN
  SELECT count(*) INTO area_count FROM "Area" WHERE "status" = 'ACTIVE';
  IF area_count < 12 THEN
    RAISE EXCEPTION 'Expected >= 12 ACTIVE areas after seed, found %', area_count;
  END IF;

  -- The failure mode that matters: a service with no coverage row at all is
  -- unbookable everywhere under default-deny.
  SELECT count(*) INTO uncovered
  FROM "Service" s
  WHERE NOT EXISTS (SELECT 1 FROM "ServiceAreaCoverage" c WHERE c."serviceId" = s."id");
  IF uncovered > 0 THEN
    RAISE EXCEPTION '% service(s) have no coverage rows — they would be unbookable', uncovered;
  END IF;

  -- Every legacy booking area must have found its new home.
  SELECT count(*) INTO orphan_bookings
  FROM "Booking" WHERE "area" IS NOT NULL AND "areaId" IS NULL;
  IF orphan_bookings > 0 THEN
    RAISE EXCEPTION '% booking(s) have a legacy area that did not map to an Area row', orphan_bookings;
  END IF;
END $$;
