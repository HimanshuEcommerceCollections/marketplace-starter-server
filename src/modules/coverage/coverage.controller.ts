import type { Request, Response } from "express";
import { coverageService } from "./coverage.service";
import { sendSuccess } from "../../utils/api-response";
import { isStaffRole } from "../../constants/roles";
import type {
  CoverageCheckQuery,
  PutAreaCoverageDto,
  ServiceCoverageAreaParams,
  ServiceCoverageCheckQuery,
  ServiceCoverageParams,
} from "./coverage.types";

/**
 * Coverage responses are NEVER cached, at any layer.
 *
 * An in-process TTL map means an admin who disables a ZIP watches bookings keep
 * landing in it, and Render can run multiple instances, so two customers get
 * different answers to "do you serve me?" — unreproducible by support. The cost
 * does not justify the risk: four index probes, ~0.2ms of DB CPU, dominated
 * 20-100x by the network round trip. Latency is removed on the CLIENT instead
 * (fire only on a complete 5-digit ZIP, 400ms debounce, AbortController, and an
 * in-component memo map).
 */
function noStore(res: Response): void {
  res.setHeader("Cache-Control", "private, no-store");
}

export class CoverageController {
  /**
   * GET /coverage/check — anonymous availability check.
   * `optionalAuthenticate` only so STAFF get the precise reason and matched
   * rule; anonymous callers get the collapsed public reason.
   */
  check = async (req: Request, res: Response) => {
    noStore(res);
    const query = req.query as unknown as CoverageCheckQuery;
    const staff = !!req.user && isStaffRole(req.user.role);
    const result = await coverageService.check({
      zip: query.zip,
      serviceId: query.serviceId,
      serviceSlug: query.serviceSlug,
      staff,
    });
    sendSuccess(res, result, "Coverage checked");
  };

  /**
   * GET (service-scoped) /check — the same resolver the booking flow calls, so
   * what an admin sees is by construction what a customer gets. Role-aware in
   * exactly the same way as the anonymous check.
   */
  checkForService = async (req: Request, res: Response) => {
    noStore(res);
    const { serviceId } = req.params as unknown as ServiceCoverageParams;
    const { zip } = req.query as unknown as ServiceCoverageCheckQuery;
    const staff = !!req.user && isStaffRole(req.user.role);
    const result = await coverageService.check({ zip, serviceId, staff });
    sendSuccess(res, result, "Coverage checked");
  };

  /** GET (service-scoped) / — the full coverage document for the admin editor. */
  getDocument = async (req: Request, res: Response) => {
    noStore(res);
    const { serviceId } = req.params as unknown as ServiceCoverageParams;
    sendSuccess(
      res,
      await coverageService.getDocument(serviceId),
      "Coverage fetched",
    );
  };

  /** PUT (service-scoped) /areas/:areaId — whole-intent replace for one market. */
  putArea = async (req: Request, res: Response) => {
    noStore(res);
    const { serviceId, areaId } =
      req.params as unknown as ServiceCoverageAreaParams;
    const result = await coverageService.putAreaCoverage(
      serviceId,
      areaId,
      req.body as PutAreaCoverageDto,
    );
    sendSuccess(res, result, "Coverage updated");
  };
}

export const coverageController = new CoverageController();
