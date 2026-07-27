import type { Request, Response } from "express";
import { zipCodesService } from "./zip-codes.service";
import { sendSuccess } from "../../utils/api-response";
import { HttpStatus } from "../../constants/http-status";
import type {
  BulkImportZipCodesDto,
  BulkMoveZipCodesDto,
  BulkZipCodeStatusDto,
  CreateZipCodeDto,
  ListZipCodesQuery,
  UpdateZipCodeDto,
  UpdateZipCodeStatusDto,
} from "./zip-codes.types";

export class ZipCodesController {
  /** Role-aware list: anonymous callers see ACTIVE ZIPs in ACTIVE markets only. */
  list = async (req: Request, res: Response) => {
    const { items, meta } = await zipCodesService.list(
      req.query as unknown as ListZipCodesQuery,
      req.user?.role,
    );
    sendSuccess(res, items, "ZIP codes fetched", undefined, meta);
  };

  getById = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.getById(req.params.id);
    sendSuccess(res, zipCode, "ZIP code fetched");
  };

  /** The param schema has already normalised :zipCode to 5 digits. */
  getByCode = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.getByCode(req.params.zipCode);
    sendSuccess(res, zipCode, "ZIP code fetched");
  };

  create = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.create(req.body as CreateZipCodeDto);
    sendSuccess(res, zipCode, "ZIP code created", HttpStatus.CREATED);
  };

  update = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.update(
      req.params.id,
      req.body as UpdateZipCodeDto,
    );
    sendSuccess(res, zipCode, "ZIP code updated");
  };

  setStatus = async (req: Request, res: Response) => {
    const { status } = req.body as UpdateZipCodeStatusDto;
    const zipCode = await zipCodesService.setStatus(req.params.id, status);
    sendSuccess(res, zipCode, "ZIP code status updated");
  };

  activate = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.activate(req.params.id);
    sendSuccess(res, zipCode, "ZIP code activated");
  };

  deactivate = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.deactivate(req.params.id);
    sendSuccess(res, zipCode, "ZIP code deactivated");
  };

  archive = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.archive(req.params.id);
    sendSuccess(res, zipCode, "ZIP code archived");
  };

  restore = async (req: Request, res: Response) => {
    const zipCode = await zipCodesService.restore(req.params.id);
    sendSuccess(res, zipCode, "ZIP code restored");
  };

  /**
   * 200 with per-bucket counts. Refusals (ARCHIVED rows, ids that no longer
   * exist) are named in the message rather than folded into "unchanged", so the
   * admin is never told "nothing to do" about a row that was actually rejected.
   */
  bulkSetStatus = async (req: Request, res: Response) => {
    const result = await zipCodesService.bulkSetStatus(
      req.body as BulkZipCodeStatusDto,
    );
    const notes: string[] = [];
    if (result.archived.length > 0) {
      notes.push(`${result.archived.length} archived (restore first)`);
    }
    if (result.notFound.length > 0) notes.push(`${result.notFound.length} not found`);
    const suffix = notes.length > 0 ? `, ${notes.join(", ")}` : "";
    sendSuccess(
      res,
      result,
      `${result.updated} ZIP code${result.updated === 1 ? "" : "s"} updated${suffix}`,
    );
  };

  /**
   * Partial success is the designed outcome — blocked ZIPs are reported, not
   * silently unpinned — so this stays 200 even when `blocked` is non-empty.
   */
  bulkMove = async (req: Request, res: Response) => {
    const result = await zipCodesService.bulkMove(req.body as BulkMoveZipCodesDto);
    const suffix =
      result.blocked.length > 0
        ? `, ${result.blocked.length} blocked by service coverage`
        : "";
    sendSuccess(res, result, `${result.moved} ZIP code(s) moved${suffix}`);
  };

  /**
   * ALWAYS 200, even with row failures: a 4xx would make the client's axios
   * interceptor and every error boundary treat a successful 970-row import as a
   * failure (§5.6).
   */
  bulkImport = async (req: Request, res: Response) => {
    const result = await zipCodesService.bulkImport(
      req.body as BulkImportZipCodesDto,
    );
    const { summary } = result;
    const written = summary.created + summary.updated + summary.moved;
    const message = result.dryRun
      ? `Preview: ${written} of ${summary.received} ZIP codes would be written`
      : `Imported ${written} of ${summary.received} ZIP codes`;
    sendSuccess(res, result, message);
  };
}

export const zipCodesController = new ZipCodesController();
