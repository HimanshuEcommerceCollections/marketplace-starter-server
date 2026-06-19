import {
  PrismaClient,
  UserRole,
  UserStatus,
  LocationMode,
  Brand,
  CategoryStatus,
  ConfigInputType,
  ConfigApplies,
} from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();

/**
 * Idempotent seed. Imports the full Elevate catalog from the client brand files:
 *   - structure (groups/options, `required`)  ← Client/brands/elevate/services.json
 *   - money (base price, option deltas, applies) ← Client/brands/elevate/pricing.v1.json
 * joined by service `pricing_ref` and matching ids.
 * Run with: npm run prisma:seed
 */
const BRAND_DIR = join(__dirname, "..", "..", "Client", "brands", "elevate");
const catalog: any = JSON.parse(readFileSync(join(BRAND_DIR, "services.json"), "utf8"));
const pricing: any = JSON.parse(readFileSync(join(BRAND_DIR, "pricing.v1.json"), "utf8"));

const INPUT_MAP: Record<string, ConfigInputType> = {
  select: ConfigInputType.SELECT,
  multiselect: ConfigInputType.MULTISELECT,
  quantity: ConfigInputType.QUANTITY,
  toggle: ConfigInputType.TOGGLE,
};
const LOCATION_MAP: Record<string, LocationMode> = {
  onsite: LocationMode.ONSITE,
  remote: LocationMode.REMOTE,
  hybrid: LocationMode.HYBRID,
};
const appliesOf = (a?: string): ConfigApplies =>
  a === "per_unit" ? ConfigApplies.PER_UNIT : ConfigApplies.FLAT;

/** Look up an option's price delta (cents) from pricing.v1.json by ids. */
function deltaFor(pricingRef: string, modifierId: string, optionId: string): number {
  const entry = pricing.services?.[pricingRef];
  const modifier = entry?.modifiers?.find((m: any) => m.id === modifierId);
  const option = modifier?.options?.find((o: any) => o.id === optionId);
  return option?.delta?.amount ?? 0;
}
const appliesForModifier = (pricingRef: string, modifierId: string): ConfigApplies =>
  appliesOf(pricing.services?.[pricingRef]?.modifiers?.find((m: any) => m.id === modifierId)?.applies);

async function main() {
  // ── Platform admin ──────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);
  const admin = await prisma.user.upsert({
    where: { email: "admin@elevate.test" },
    update: {},
    create: {
      email: "admin@elevate.test",
      passwordHash,
      name: "Platform Admin",
      brand: Brand.ELEVATE,
      role: UserRole.SYSTEM_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  // ── Categories — one per home-page service card (slug = service id) ───────────
  // Each service maps 1:1 to a same-named category. Details come from the card:
  // name = title, description = summary, basePrice = from_price (cents),
  // status = coming_soon ? DRAFT : ACTIVE.
  const categoryIdBySlug = new Map<string, string>();
  const categorySlugs: string[] = [];
  for (const svc of catalog.services as any[]) {
    const status = svc.coming_soon ? CategoryStatus.DRAFT : CategoryStatus.ACTIVE;
    const fields = {
      name: svc.title,
      description: svc.summary ?? null,
      basePrice: svc.from_price ?? 0,
      status,
    };
    const row = await prisma.serviceCategory.upsert({
      where: { slug: svc.id },
      update: fields,
      create: { slug: svc.id, ...fields },
    });
    categoryIdBySlug.set(svc.id, row.id);
    categorySlugs.push(svc.id);
  }

  // ── Services + nested config (groups → options) ───────────────────────────────
  let serviceCount = 0;
  let groupCount = 0;
  let optionCount = 0;

  for (const svc of catalog.services as any[]) {
    const categoryId = categoryIdBySlug.get(svc.id);
    if (!categoryId) throw new Error(`Missing category for service '${svc.id}'`);

    const pricingRef: string = svc.pricing_ref ?? svc.id;
    const priceAmount: number = pricing.services?.[pricingRef]?.base_price?.amount ?? 0;
    const locationModes = (svc.location_modes ?? ["onsite"]).map((m: string) => LOCATION_MAP[m]);
    const locationMode = locationModes[0] ?? LocationMode.ONSITE;
    const comingSoon = svc.coming_soon ?? false;

    const fields = {
      name: svc.title,
      description: svc.description ?? null,
      categoryId,
      priceAmount,
      currency: svc.currency ?? "USD",
      durationMinutes: 60,
      locationMode,
      isActive: !comingSoon,
      pricingRef,
      summary: svc.summary ?? null,
      serviceType: svc.service_type ?? null,
      fromPrice: svc.from_price ?? null,
      minBooking: svc.min_booking ?? null,
      comingSoon,
      badges: svc.badges ?? [],
      locationModes,
    };

    const service = await prisma.service.upsert({
      where: { slug: svc.id },
      update: fields,
      create: { slug: svc.id, ...fields },
    });
    serviceCount++;

    // Resync config from scratch (idempotent): drop existing groups (cascades options).
    await prisma.serviceConfigGroup.deleteMany({ where: { serviceId: service.id } });

    const configOptions: any[] = svc.config_options ?? [];
    for (let gi = 0; gi < configOptions.length; gi++) {
      const co = configOptions[gi];
      const inputType = INPUT_MAP[co.input] ?? ConfigInputType.SELECT;
      const choices: any[] = co.choices ?? [];

      await prisma.serviceConfigGroup.create({
        data: {
          serviceId: service.id,
          key: co.id,
          label: co.label,
          inputType,
          applies: appliesForModifier(pricingRef, co.id),
          isRequired: co.required ?? false,
          sortOrder: gi,
          options: {
            create: choices.map((ch: any, oi: number) => ({
              key: ch.id,
              label: ch.label,
              priceDelta: deltaFor(pricingRef, co.id, ch.id),
              isDefault: false,
              sortOrder: oi,
            })),
          },
        },
      });
      groupCount++;
      optionCount += choices.length;
    }
  }

  // Prune stray services not in the catalog (e.g. the legacy "deep-tissue-massage"
  // from the original minimal seed) so the legacy categories they reference become
  // orphaned. Service config groups cascade-delete with the service.
  const removedServices = await prisma.service.deleteMany({
    where: { slug: { notIn: categorySlugs } },
  });

  // Now remove every category that isn't one of the 8 service-derived ones
  // (the legacy bodywork/fitness/wellness/therapy taxonomy). All such categories
  // are orphaned at this point, so the FK no longer blocks deletion.
  const removedCategories = await prisma.serviceCategory.deleteMany({
    where: { slug: { notIn: categorySlugs } },
  });

  console.log(
    `Seeded admin=${admin.email}, categories=${categoryIdBySlug.size} ` +
      `(removed ${removedCategories.count} legacy categories, ` +
      `${removedServices.count} stray services), services=${serviceCount}, ` +
      `configGroups=${groupCount}, configOptions=${optionCount}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
