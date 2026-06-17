import type { Request, Response } from "express";
import { bookingsService } from "./bookings.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import { ApiError } from "../../utils/api-error";
import { isStaffRole } from "../../constants/roles";
import type {
  CreateBookingDto,
  ListBookingsQuery,
  UpdateBookingStatusDto,
} from "./bookings.types";

export class BookingsController {
  create = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const booking = await bookingsService.create(
      req.user.id,
      req.body as CreateBookingDto,
    );
    sendSuccess(res, booking, "Booking created", HttpStatus.CREATED);
  };

  list = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const staff = isStaffRole(req.user.role);
    const { items, meta } = await bookingsService.list(
      req.query as unknown as ListBookingsQuery,
      staff ? undefined : { customerId: req.user.id },
    );
    sendSuccess(res, items, "Bookings fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const booking = await bookingsService.getById(req.params.id, {
      id: req.user.id,
      isStaff: isStaffRole(req.user.role),
    });
    sendSuccess(res, booking);
  };

  cancel = async (req: Request, res: Response) => {
    if (!req.user) throw ApiError.unauthorized();
    const booking = await bookingsService.cancel(req.params.id, {
      id: req.user.id,
      isStaff: isStaffRole(req.user.role),
    });
    sendSuccess(res, booking, "Booking cancelled");
  };

  updateStatus = async (req: Request, res: Response) => {
    const booking = await bookingsService.updateStatus(
      req.params.id,
      req.body as UpdateBookingStatusDto,
    );
    sendSuccess(res, booking, "Booking status updated");
  };
}

export const bookingsController = new BookingsController();
