import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class UsersRepository {
  findMany(args: Prisma.UserFindManyArgs) {
    return prisma.user.findMany(args);
  }
  count(where?: Prisma.UserWhereInput) {
    return prisma.user.count({ where });
  }
  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  }
  update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return prisma.user.update({ where: { id }, data });
  }
}

export const usersRepository = new UsersRepository();
