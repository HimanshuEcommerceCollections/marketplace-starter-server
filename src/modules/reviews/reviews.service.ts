import type { Prisma } from "@prisma/client";
import { reviewsRepository } from "./reviews.repository";
import { bookingsService } from "../bookings/bookings.service";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { BookingStatus } from "../../enums";
import type {
  CreateReviewDto,
  ListReviewsQuery,
  ModerateReviewDto,
} from "./reviews.types";

export class ReviewsService {
  /** A customer can review their own completed booking exactly once. */
  async create(authorId: string, dto: CreateReviewDto) {
    const booking = await bookingsService.getEntity(dto.bookingId);
    if (booking.customerId !== authorId) {
      throw ApiError.forbidden("You can only review your own bookings");
    }
    if (booking.status !== BookingStatus.COMPLETED) {
      throw ApiError.badRequest("You can only review completed bookings");
    }
    const existing = await reviewsRepository.findByBooking(dto.bookingId);
    if (existing) throw ApiError.conflict("This booking has already been reviewed");

    return reviewsRepository.create({
      bookingId: booking.id,
      serviceId: booking.serviceId,
      authorId,
      rating: dto.rating,
      comment: dto.comment,
    });
  }

  async list(query: ListReviewsQuery, includeUnpublished = false) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.ReviewWhereInput = {
      ...(includeUnpublished ? {} : { isPublished: true }),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
    };
    const [items, total] = await Promise.all([
      reviewsRepository.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      reviewsRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  async getById(id: string) {
    const review = await reviewsRepository.findById(id);
    if (!review) throw ApiError.notFound("Review not found");
    return review;
  }

  async moderate(id: string, dto: ModerateReviewDto) {
    await this.getById(id);
    return reviewsRepository.update(id, { isPublished: dto.isPublished });
  }
}

export const reviewsService = new ReviewsService();
