import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import { bookingsRepository } from "./bookings.repository";
import { servicesService } from "../services/services.service";
import { serviceConfigService } from "../services/config/service-config.service";
import { ApiError } from "../../utils/api-error";
import { logger } from "../../utils/logger";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { notificationsService } from "../notifications";
import { coverageService } from "../coverage";
import { legacyAreaForSlug } from "../../utils/legacy-area";
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
    provider: { select: { displayName: true; credential: true } };
    review: { select: { rating: true; comment: true } };
  };
}>;

function generateReference(): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `BK-${time}-${rand}`;
}

/** Statuses from which no further status change is allowed. */
const TERMINAL_BOOKING_STATUSES: BookingStatus[] = [
  BookingStatus.COMPLETED,
  BookingStatus.CANCELLED,
  BookingStatus.NO_SHOW,
];

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

    // GUARD 1 — resolve and validate the location mode BEFORE the coverage gate.
    // `mode` is a gate INPUT: coverage does not apply to REMOTE sessions, so an
    // unvalidated `{ locationMode: "REMOTE" }` in a request body would otherwise
    // walk straight past every gate, rule and default-deny in the coverage module.
    const mode = dto.locationMode ?? service.locationMode;
    const offered = service.locationModes.length > 0 ? service.locationModes : [service.locationMode];
    if (!offered.includes(mode)) {
      throw ApiError.badRequest("This service is not offered in that location mode");
    }

    // GUARD 2 — coverage. Runs BEFORE quotePrice on purpose: do not pay a pricing
    // round trip for a booking that is about to be rejected. Throws a
    // user-friendly error on a deny; returns exactly the columns persisted below.
    const coverage = await coverageService.assertServiceable({
      service,
      zip: dto.postalCode,
      mode,
      requestedAreaId: undefined,
    });

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
      locationMode: mode,
      // Coverage: FKs + snapshots, resolved from the customer's ZIP above.
      areaId: coverage.areaId,
      zipCodeId: coverage.zipCodeId,
      postalCode: coverage.postalCode,
      areaNameSnapshot: coverage.areaNameSnapshot,
      coverageSource: coverage.coverageSource,
      // Legacy enum, dual-written until the contract migration drops the column.
      // Null for admin-created areas that have no enum member — that is correct.
      area: legacyAreaForSlug(coverage.areaSlug),
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
          // The ZIP exactly as the customer typed it, beside the address they typed.
          postalCode: coverage.postalCode,
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
      providerCredential: b.provider?.credential ?? null,
      scheduledStart: startIso,
      scheduledEnd: b.scheduledEnd.toISOString(),
      scheduledDate: startIso.slice(0, 10),
      scheduledTime: startIso.slice(11, 16),
      priceAmount: b.priceAmount,
      currency: b.currency,
      locationMode: b.locationMode,
      area: b.area,
      notes: b.notes,
      contactName: b.userDetails?.name ?? null,
      contactEmail: b.userDetails?.email ?? null,
      contactPhone: b.userDetails?.phone ?? null,
      address: b.userDetails?.address ?? null,
      schedulePreferences: b.schedulePreferences,
      selections: b.selections,
      review: b.review ? { rating: b.review.rating, comment: b.review.comment } : null,
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

  /** Staff status transition (admin/coordinator). Notifies the customer when the
   *  booking is confirmed or rejected (cancelled). */
  async updateStatus(id: string, dto: UpdateBookingStatusDto) {
    const booking = await this.findOwned(id); // 404s if it doesn't exist
    // A terminal booking is settled — reject any further transition so a stale
    // client (or a direct API call) can't resurrect or re-notify it.
    if (TERMINAL_BOOKING_STATUSES.includes(booking.status)) {
      throw ApiError.badRequest(
        `Booking is ${booking.status.toLowerCase()} and can no longer change status`,
      );
    }
    // No-op transitions would re-fire the customer notification below; block them.
    if (booking.status === dto.status) {
      throw ApiError.badRequest(`Booking is already ${dto.status.toLowerCase()}`);
    }
    await bookingsRepository.update(id, { status: dto.status });
    const fresh = await this.refetch(id);
    try {
      if (dto.status === BookingStatus.CONFIRMED) {
        await notificationsService.notifyBookingConfirmed(fresh.customerId, fresh);
      } else if (dto.status === BookingStatus.CANCELLED) {
        await notificationsService.notifyBookingCancelled(fresh.customerId, fresh);
      }
    } catch (err) {
      logger.error("Failed to write booking-status notification", err);
    }
    return this.serialize(fresh);
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
