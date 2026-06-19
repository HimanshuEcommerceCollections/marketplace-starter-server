import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class CategoriesRepository {
  findMany(args: Prisma.ServiceCategoryFindManyArgs) {
    return prisma.serviceCategory.findMany(args);
  }
  count(where?: Prisma.ServiceCategoryWhereInput) {
    return prisma.serviceCategory.count({ where });
  }
  findById(id: string) {
    return prisma.serviceCategory.findUnique({ where: { id } });
  }
  /** Details view: include the number of linked services via Prisma `_count`. */
  findByIdWithServiceCount(id: string) {
    return prisma.serviceCategory.findUnique({
      where: { id },
      include: { _count: { select: { services: true } } },
    });
  }
  findByName(name: string) {
    return prisma.serviceCategory.findUnique({ where: { name } });
  }
  findBySlug(slug: string) {
    return prisma.serviceCategory.findUnique({ where: { slug } });
  }
  create(data: Prisma.ServiceCategoryUncheckedCreateInput) {
    return prisma.serviceCategory.create({ data });
  }
  update(id: string, data: Prisma.ServiceCategoryUncheckedUpdateInput) {
    return prisma.serviceCategory.update({ where: { id }, data });
  }
}

export const categoriesRepository = new CategoriesRepository();
