import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class ServicesRepository {
  findMany(args: Prisma.ServiceFindManyArgs) {
    return prisma.service.findMany(args);
  }
  count(where?: Prisma.ServiceWhereInput) {
    return prisma.service.count({ where });
  }
  findById(id: string) {
    return prisma.service.findUnique({ where: { id } });
  }
  findByName(name: string) {
    return prisma.service.findUnique({ where: { name } });
  }
  findBySlug(slug: string) {
    return prisma.service.findUnique({ where: { slug } });
  }
  create(data: Prisma.ServiceUncheckedCreateInput) {
    return prisma.service.create({ data });
  }
  update(id: string, data: Prisma.ServiceUncheckedUpdateInput) {
    return prisma.service.update({ where: { id }, data });
  }
}

export const servicesRepository = new ServicesRepository();
