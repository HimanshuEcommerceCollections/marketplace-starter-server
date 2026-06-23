import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { bookingsRepository } from "./bookings.repository";
import { servicesService } from "../services/services.service";
import { serviceConfigService } from "../services/config/service-config.service";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { BookingStatus, ServiceStatus } from "../../enums";
import type {
  CreateBookingDto,
  ListBookingsQuery,
  UpdateBookingStatusDto,
  BookingRequester,
  BookingResponse,
} from "./bookings.types";

type BookingWithService = Prisma.BookingGetPayload<{
  include: {
    service: { select: { name: true; slug: true } };
    userDetails: true;
    customer: { select: { name: true; email: true } };
    provider: { select: { displayName: true } };
  };
}>;

function generateReference(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `BK-${time}-${rand}`;
}

export class BookingsService {
  /** Customer books a service; price/currency are snapshotted from the service. */
  async create(customerId: string, dto: CreateBookingDto) {
    const service = await servicesService.getById(dto.serviceId);
    if (service.status !== ServiceStatus.ACTIVE) {
      throw ApiError.badRequest("This service is not currently bookable");
    }
    if (dto.scheduledEnd <= dto.scheduledStart) {
      throw ApiError.badRequest("scheduledEnd must be after scheduledStart");
    }

    // "Option A" pricing: validate the selected options against the service's
    // configuration and snapshot the breakdown. With no selections this still
    // enforces any required groups and yields the base price.
    const quote = await serviceConfigService.quotePrice(service.id, dto.optionIds ?? [], true);

    return bookingsRepository.create({
      reference: generateReference(),
      customerId,
      serviceId: service.id,
      providerId: service.providerId,
      priceAmount: quote.total,
      currency: service.currency,
      locationMode: dto.locationMode ?? service.locationMode,
      scheduledStart: dto.scheduledStart,
      scheduledEnd: dto.scheduledEnd,
      notes: dto.notes,
      ...(dto.schedulePreferences
        ? { schedulePreferences: dto.schedulePreferences as unknown as Prisma.InputJsonValue }
        : {}),
      selections: quote.lineItems as unknown as Prisma.InputJsonValue,
      status: BookingStatus.PENDING,
      // Immutable snapshot of the customer-entered "Details" step (contact + address).
      userDetails: {
        create: {
          userId: customerId,
          name: dto.contact?.name,
          email: dto.contact?.email,
          phone: dto.contact?.phone,
          address: dto.address,
        },
      },
    });
  }

  /** DB row (with joined service) → API response shape. */
  private serialize(b: BookingWithService): BookingResponse {
    // Canonical slot is the `scheduledStart` instant; expose convenience
    // date-only ("YYYY-MM-DD") + time-only ("HH:mm") splits derived from it.
    const startIso = b.scheduledStart.toISOString();
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      serviceName: b.service.name,
      serviceSlug: b.service.slug,
      customerName: b.customer.name,
      customerEmail: b.customer.email,
      providerName: b.provider?.displayName ?? null,
      scheduledStart: startIso,
      scheduledEnd: b.scheduledEnd.toISOString(),
      scheduledDate: startIso.slice(0, 10),
      scheduledTime: startIso.slice(11, 16),
      priceAmount: b.priceAmount,
      currency: b.currency,
      locationMode: b.locationMode,
      notes: b.notes,
      contactName: b.userDetails?.name ?? null,
      contactEmail: b.userDetails?.email ?? null,
      contactPhone: b.userDetails?.phone ?? null,
      address: b.userDetails?.address ?? null,
      schedulePreferences: b.schedulePreferences,
      selections: b.selections,
      createdAt: b.createdAt.toISOString(),
    };
  }

  async list(query: ListBookingsQuery, scope?: { customerId?: string }) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.BookingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(scope?.customerId ? { customerId: scope.customerId } : {}),
    };
    const [items, total] = await Promise.all([
      bookingsRepository.findManyWithService({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      bookingsRepository.count(where),
    ]);
    return {
      items: (items as BookingWithService[]).map((b) => this.serialize(b)),
      meta: buildMeta(page, limit, total),
    };
  }

  /** Fetch a booking (with service) enforcing ownership for non-staff callers. */
  private async findOwned(
    id: string,
    requester?: BookingRequester,
  ): Promise<BookingWithService> {
    const booking = await bookingsRepository.findByIdWithService(id);
    if (!booking) throw ApiError.notFound("Booking not found");
    if (requester && !requester.isStaff && booking.customerId !== requester.id) {
      throw ApiError.forbidden("You cannot access this booking");
    }
    return booking;
  }

  async getById(id: string, requester?: BookingRequester): Promise<BookingResponse> {
    return this.serialize(await this.findOwned(id, requester));
  }

  /** Raw booking entity (with service) for internal modules; ownership-checked. */
  getEntity(id: string, requester?: BookingRequester): Promise<BookingWithService> {
    return this.findOwned(id, requester);
  }

  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
    const booking = await this.findOwned(id);
    await bookingsRepository.update(id, { status: dto.status });
    return this.serialize(await this.refetch(booking.id));
  }

  async cancel(id: string, requester: BookingRequester) {
    const booking = await this.findOwned(id, requester);
    if (booking.status === BookingStatus.CANCELLED) {
      throw ApiError.badRequest("Booking is already cancelled");
    }
    await bookingsRepository.update(id, { status: BookingStatus.CANCELLED });
    return this.serialize(await this.refetch(id));
  }

  private async refetch(id: string): Promise<BookingWithService> {
    const fresh = await bookingsRepository.findByIdWithService(id);
    if (!fresh) throw ApiError.notFound("Booking not found");
    return fresh;
  }
}

export const bookingsService = new BookingsService();
