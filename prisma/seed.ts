import { PrismaClient, UserRole, UserStatus, LocationMode } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Idempotent seed: a platform admin, one category, and one sample service.
 * Run with: npm run prisma:seed
 */
async function main() {
  const passwordHash = await bcrypt.hash("ChangeMe123!", 10);

  const admin = await prisma.user.upsert({
    where: { email: "admin@elevate.test" },
    update: {},
    create: {
      email: "admin@elevate.test",
      passwordHash,
      firstName: "Platform",
      lastName: "Admin",
      role: UserRole.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    },
  });

  const category = await prisma.serviceCategory.upsert({
    where: { slug: "wellness" },
    update: {},
    create: {
      name: "Wellness",
      slug: "wellness",
      description: "Health & wellness services",
    },
  });

  const service = await prisma.service.upsert({
    where: { slug: "deep-tissue-massage" },
    update: {},
    create: {
      name: "Deep Tissue Massage",
      slug: "deep-tissue-massage",
      description: "60-minute therapeutic deep tissue massage.",
      categoryId: category.id,
      priceAmount: 9000,
      currency: "USD",
      durationMinutes: 60,
      locationMode: LocationMode.ONSITE,
    },
  });

  console.log(
    `Seeded admin=${admin.email}, category=${category.name}, service=${service.name}`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
