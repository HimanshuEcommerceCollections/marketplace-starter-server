import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class ReviewsRepository {
  findMany(args: Prisma.ReviewFindManyArgs) {
    return prisma.review.findMany(args);
  }
  count(where?: Prisma.ReviewWhereInput) {
    return prisma.review.count({ where });
  }
  findById(id: string) {
    return prisma.review.findUnique({ where: { id } });
  }
  findByBooking(bookingId: string) {
    return prisma.review.findUnique({ where: { bookingId } });
  }
  create(data: Prisma.ReviewUncheckedCreateInput) {
    return prisma.review.create({ data });
  }
  update(id: string, data: Prisma.ReviewUncheckedUpdateInput) {
    return prisma.review.update({ where: { id }, data });
  }
}

export const reviewsRepository = new ReviewsRepository();
