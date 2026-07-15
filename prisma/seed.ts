import {
  PrismaClient,
  UserRole,
  UserStatus,
  LocationMode,
  Brand,
  ServiceArea,
  BookingStatus,
  ServiceStatus,
  ConfigSelectionType,
  ConfigStatus,
  CorporateInquiryStatus,
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
      area: [ServiceArea.RALEIGH],
      role: UserRole.SYSTEM_ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  // ── Sample corporate inquiries ───────────────────────────────────────────────
  // Demo lead-gen rows so the admin "Inquiries" section isn't empty. Only seeded
  // when the table is empty (illustrative placeholder content, not real leads).
  const inquiryCount = await prisma.corporateInquiry.count();
  if (inquiryCount === 0) {
    await prisma.corporateInquiry.createMany({
      data: [
        {
          company: "Northwind Traders",
          contactName: "Dana Whitfield",
          contactEmail: "dana@northwind.test",
          contactPhone: "(919) 555-0142",
          headcount: "50–200",
          eventType: "On-site series",
          notes:
            "Services of interest: Massage, Yoga\n\nLooking for a recurring monthly wellness day for our RTP office.",
          status: CorporateInquiryStatus.NEW,
        },
        {
          company: "Contoso Health",
          contactName: "Marcus Lee",
          contactEmail: "marcus.lee@contoso.test",
          headcount: "200–500",
          eventType: "Hybrid program",
          notes:
            "Services of interest: Life Coaching, Nutrition\n\nQ3 wellbeing initiative; need both on-site and remote options.",
          status: CorporateInquiryStatus.CONTACTED,
        },
        {
          company: "Fabrikam Studios",
          contactName: "Priya Anand",
          contactEmail: "priya@fabrikam.test",
          contactPhone: "(415) 555-0199",
          headcount: "5–50",
          eventType: "One-off event",
          notes:
            "Services of interest: Open to suggestions\n\nTeam offsite in September, ~30 people.",
          status: CorporateInquiryStatus.QUALIFIED,
        },
      ],
    });
  }

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
              description: ch.description ?? null,
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

  // ── Sample professionals (providers) + assignment to services ─────────────────
  // Gives bookings a real provider name + credential to display on "My Bookings".
  // Idempotent via upsert on the provider user's email / profile's userId.
  const providerSpecs: Array<{
    email: string;
    name: string;
    credential: string;
    bio: string;
    slug: string;
  }> = [
    { email: "maya.pro@elevate.test", name: "Maya R.", credential: "LMBT", bio: "Licensed massage & bodywork therapist.", slug: "massage" },
    { email: "priya.pro@elevate.test", name: "Dr. Priya N.", credential: "DPT", bio: "Doctor of physical therapy.", slug: "physical-therapy" },
    { email: "ana.pro@elevate.test", name: "Ana L.", credential: "RYT-500", bio: "Registered yoga teacher (500h).", slug: "yoga" },
    { email: "derek.pro@elevate.test", name: "Derek S.", credential: "CPT", bio: "Certified personal trainer.", slug: "personal-training" },
    { email: "sofia.pro@elevate.test", name: "Sofia M.", credential: "Cosmetologist", bio: "Licensed cosmetologist.", slug: "beauty" },
    { email: "rachel.pro@elevate.test", name: "Rachel T.", credential: "RD", bio: "Registered dietitian.", slug: "nutrition-coaching" },
  ];
  const providerBySlug = new Map<string, string>(); // service slug -> ServiceProvider.id
  for (const p of providerSpecs) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        email: p.email,
        passwordHash,
        name: p.name,
        brand: Brand.ELEVATE,
        role: UserRole.SYSTEM_PROVIDER,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
      },
    });
    const profile = await prisma.serviceProvider.upsert({
      where: { userId: user.id },
      update: { displayName: p.name, bio: p.bio, credential: p.credential, isVerified: true },
      create: { userId: user.id, displayName: p.name, bio: p.bio, credential: p.credential, isVerified: true },
    });
    const svc = await prisma.service.findUnique({ where: { slug: p.slug } });
    if (svc) {
      await prisma.service.update({ where: { id: svc.id }, data: { providerId: profile.id } });
      providerBySlug.set(p.slug, profile.id);
    }
  }

  // ── Demo customer + sample bookings ───────────────────────────────────────────
  // Populates the "My Bookings" page for demos — log in as demo@elevate.test.
  // Only seeded once (when the demo customer has no bookings yet).
  const demo = await prisma.user.upsert({
    where: { email: "demo@elevate.test" },
    update: {},
    create: {
      email: "demo@elevate.test",
      passwordHash,
      name: "Jordan Rivera",
      brand: Brand.ELEVATE,
      area: [ServiceArea.RALEIGH, ServiceArea.CARY],
      role: UserRole.USER_CUSTOMER,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  let demoBookingCount = 0;
  if ((await prisma.booking.count({ where: { customerId: demo.id } })) === 0) {
    const now = new Date();
    const at = (deltaDays: number, h: number, m = 0) => {
      const d = new Date(now);
      d.setDate(d.getDate() + deltaDays);
      d.setHours(h, m, 0, 0);
      return d;
    };
    type DemoBooking = {
      slug: string;
      ref: string;
      status: BookingStatus;
      area: ServiceArea;
      start: Date;
      durMin: number;
      review?: { rating: number; comment: string };
    };
    const demoBookings: DemoBooking[] = [
      { slug: "massage", ref: "ELV-4821", status: BookingStatus.CONFIRMED, area: ServiceArea.CARY, start: at(2, 18), durMin: 90 },
      { slug: "physical-therapy", ref: "ELV-4955", status: BookingStatus.PENDING, area: ServiceArea.APEX, start: at(5, 9), durMin: 60 },
      { slug: "yoga", ref: "ELV-4907", status: BookingStatus.CONFIRMED, area: ServiceArea.RALEIGH, start: at(8, 7, 30), durMin: 60 },
      { slug: "personal-training", ref: "ELV-4310", status: BookingStatus.COMPLETED, area: ServiceArea.RALEIGH, start: at(-15, 18), durMin: 60 },
      { slug: "beauty", ref: "ELV-4102", status: BookingStatus.COMPLETED, area: ServiceArea.MORRISVILLE, start: at(-31, 10), durMin: 60, review: { rating: 5, comment: "Wonderful — felt so refreshed afterwards." } },
      { slug: "nutrition-coaching", ref: "ELV-3987", status: BookingStatus.CANCELLED, area: ServiceArea.WAKE_FOREST, start: at(-43, 17), durMin: 60 },
    ];
    for (const b of demoBookings) {
      const svc = await prisma.service.findUnique({
        where: { slug: b.slug },
        select: { id: true, priceAmount: true, currency: true },
      });
      if (!svc) continue;
      const booking = await prisma.booking.create({
        data: {
          reference: b.ref,
          customerId: demo.id,
          serviceId: svc.id,
          providerId: providerBySlug.get(b.slug) ?? null,
          status: b.status,
          scheduledStart: b.start,
          scheduledEnd: new Date(b.start.getTime() + b.durMin * 60000),
          priceAmount: svc.priceAmount,
          currency: svc.currency,
          locationMode: LocationMode.ONSITE,
          area: b.area,
          userDetails: {
            create: {
              userId: demo.id,
              name: demo.name,
              email: demo.email,
              phone: "(919) 555-0123",
              address: "123 Oak Street",
            },
          },
        },
      });
      if (b.review) {
        await prisma.review.create({
          data: {
            bookingId: booking.id,
            serviceId: svc.id,
            authorId: demo.id,
            rating: b.review.rating,
            comment: b.review.comment,
          },
        });
      }
      demoBookingCount++;
    }
  }

  console.log(
    `Seeded admin=${admin.email}, services=${serviceCount} ` +
      `(removed ${removedServices.count} stray services), ` +
      `configGroups=${groupCount}, configOptions=${optionCount}, ` +
      `providers=${providerBySlug.size}, demoBookings=${demoBookingCount}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
