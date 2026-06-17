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
  create(data: Prisma.ServiceUncheckedCreateInput) {
    return prisma.service.create({ data });
  }
  update(id: string, data: Prisma.ServiceUncheckedUpdateInput) {
    return prisma.service.update({ where: { id }, data });
  }
  delete(id: string) {
    return prisma.service.delete({ where: { id } });
  }
}

export const servicesRepository = new ServicesRepository();
