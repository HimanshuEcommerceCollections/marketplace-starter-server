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
    // Case-insensitive to match auth's lookup: the duplicate check must catch
    // "John@x.com" vs "john@x.com", including legacy mixed-case rows.
    return prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
    });
  }
  create(data: Prisma.UserUncheckedCreateInput) {
    return prisma.user.create({ data });
  }
  update(id: string, data: Prisma.UserUncheckedUpdateInput) {
    return prisma.user.update({ where: { id }, data });
  }
}

export const usersRepository = new UsersRepository();
