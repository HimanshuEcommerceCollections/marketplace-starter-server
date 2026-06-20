import {
  PrismaClient,
  UserRole,
  UserStatus,
  LocationMode,
  Brand,
  ServiceStatus,
  ConfigSelectionType,
  ConfigStatus,
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

const SELECTION_MAP: Record<string, ConfigSelectionType> = {
  select: ConfigSelectionType.SINGLE_SELECT,
  multiselect: ConfigSelectionType.MULTI_SELECT,
};
const LOCATION_MAP: Record<string, LocationMode> = {
  onsite: LocationMode.ONSITE,
  remote: LocationMode.REMOTE,
  hybrid: LocationMode.HYBRID,
};

/** Look up an option's price modifier (cents) from pricing.v1.json by ids. */
function modifierFor(pricingRef: string, modifierId: string, optionId: string): number {
  const entry = pricing.services?.[pricingRef];
  const modifier = entry?.modifiers?.find((m: any) => m.id === modifierId);
  const option = modifier?.options?.find((o: any) => o.id === optionId);
  return Math.max(0, option?.delta?.amount ?? 0);
}

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

  // ── Services + nested config (groups → options) ───────────────────────────────
  // One flat bookable Service per home-page card (slug = service id). Details:
  // name = title, description, priceAmount = pricing base_price (cents),
  // status = coming_soon ? COMING_SOON : ACTIVE. Catalog-parity fields mirror
  // the client services.json.
  const serviceSlugs: string[] = [];
  let serviceCount = 0;
  let groupCount = 0;
  let optionCount = 0;

  for (const svc of catalog.services as any[]) {
    const pricingRef: string = svc.pricing_ref ?? svc.id;
    const priceAmount: number = pricing.services?.[pricingRef]?.base_price?.amount ?? 0;
    const locationModes = (svc.location_modes ?? ["onsite"]).map((m: string) => LOCATION_MAP[m]);
    const locationMode = locationModes[0] ?? LocationMode.ONSITE;
    const status = svc.coming_soon ? ServiceStatus.COMING_SOON : ServiceStatus.ACTIVE;

    const fields = {
      name: svc.title,
      description: svc.description ?? null,
      priceAmount,
      currency: svc.currency ?? "USD",
      durationMinutes: 60,
      locationMode,
      status,
      pricingRef,
      summary: svc.summary ?? null,
      serviceType: svc.service_type ?? null,
      fromPrice: svc.from_price ?? null,
      minBooking: svc.min_booking ?? null,
      badges: svc.badges ?? [],
      locationModes,
    };

    const service = await prisma.service.upsert({
      where: { slug: svc.id },
      update: fields,
      create: { slug: svc.id, ...fields },
    });
    serviceSlugs.push(svc.id);
    serviceCount++;

    // Resync config from scratch (idempotent): drop existing groups (cascades options).
    await prisma.serviceConfigGroup.deleteMany({ where: { serviceId: service.id } });

    const configOptions: any[] = svc.config_options ?? [];
    for (let gi = 0; gi < configOptions.length; gi++) {
      const co = configOptions[gi];
      const selectionType = SELECTION_MAP[co.input] ?? ConfigSelectionType.SINGLE_SELECT;
      const choices: any[] = co.choices ?? [];

      await prisma.serviceConfigGroup.create({
        data: {
          serviceId: service.id,
          key: co.id,
          label: co.label,
          selectionType,
          isRequired: co.required ?? false,
          sortOrder: gi,
          // Seeded groups ship with their options, so they start ACTIVE.
          status: choices.length > 0 ? ConfigStatus.ACTIVE : ConfigStatus.INACTIVE,
          options: {
            create: choices.map((ch: any, oi: number) => ({
              key: ch.id,
              label: ch.label,
              priceModifier: modifierFor(pricingRef, co.id, ch.id),
              sortOrder: oi,
              status: ConfigStatus.ACTIVE,
            })),
          },
        },
      });
      groupCount++;
      optionCount += choices.length;
    }
  }

  // Prune stray services not in the catalog (e.g. the legacy "deep-tissue-massage"
  // from the original minimal seed). Service config groups cascade-delete with
  // the service.
  const removedServices = await prisma.service.deleteMany({
    where: { slug: { notIn: serviceSlugs } },
  });

  console.log(
    `Seeded admin=${admin.email}, services=${serviceCount} ` +
      `(removed ${removedServices.count} stray services), ` +
      `configGroups=${groupCount}, configOptions=${optionCount}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
