import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { bookingsRepository } from "./bookings.repository";
import { servicesService } from "../services/services.service";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { BookingStatus } from "../../enums";
import type {
  CreateBookingDto,
  ListBookingsQuery,
  UpdateBookingStatusDto,
  BookingRequester,
} from "./bookings.types";

function generateReference(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `BK-${time}-${rand}`;
}

export class BookingsService {
  /** Customer books a service; price/currency are snapshotted from the service. */
  async create(customerId: string, dto: CreateBookingDto) {
    const service = await servicesService.getById(dto.serviceId);
    if (!service.isActive) {
      throw ApiError.badRequest("This service is not currently bookable");
    }
    if (dto.scheduledEnd <= dto.scheduledStart) {
      throw ApiError.badRequest("scheduledEnd must be after scheduledStart");
    }

    return bookingsRepository.create({
      reference: generateReference(),
      customerId,
      serviceId: service.id,
      providerId: service.providerId,
      priceAmount: service.priceAmount,
      currency: service.currency,
      locationMode: dto.locationMode ?? service.locationMode,
      scheduledStart: dto.scheduledStart,
      scheduledEnd: dto.scheduledEnd,
      notes: dto.notes,
      status: BookingStatus.PENDING,
    });
  }

  async list(query: ListBookingsQuery, scope?: { customerId?: string }) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(scope?.customerId ? { customerId: scope.customerId } : {}),
    };
    const [items, total] = await Promise.all([
      bookingsRepository.findMany({ where, skip, take, orderBy: { scheduledStart: "desc" } }),
      bookingsRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  async getById(id: string, requester?: BookingRequester) {
    const booking = await bookingsRepository.findById(id);
    if (!booking) throw ApiError.notFound("Booking not found");
    if (requester && !requester.isStaff && booking.customerId !== requester.id) {
      throw ApiError.forbidden("You cannot access this booking");
    }
    return booking;
  }

  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
    await this.getById(id);
    return bookingsRepository.update(id, { status: dto.status });
  }

  async cancel(id: string, requester: BookingRequester) {
    const booking = await this.getById(id, requester);
    if (booking.status === BookingStatus.CANCELLED) {
      throw ApiError.badRequest("Booking is already cancelled");
    }
    return bookingsRepository.update(id, { status: BookingStatus.CANCELLED });
  }
}

export const bookingsService = new BookingsService();
