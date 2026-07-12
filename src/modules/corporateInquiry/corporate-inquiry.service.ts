import type { Prisma } from "@prisma/client";
import { corporateInquiryRepository } from "./corporate-inquiry.repository";
import { ApiError } from "../../utils/api-error";
import { buildPagination, buildMeta } from "../../utils/pagination";
import type { CorporateInquiryStatus } from "../../enums";
import type {
  CreateCorporateInquiryDto,
  ListCorporateInquiriesQuery,
} from "./corporate-inquiry.types";

export class CorporateInquiryService {
  /** Persist a public inquiry. Always creates a fresh row (leads aren't deduped). */
  async create(dto: CreateCorporateInquiryDto) {
    return corporateInquiryRepository.create({
      company: dto.company,
      contactName: dto.contact.name,
      contactEmail: dto.contact.email,
      contactPhone: dto.contact.phone,
      headcount: dto.headcount,
      eventType: dto.eventType,
      preferredDate: dto.preferredDate,
      notes: dto.notes,
    });
  }

  /** Staff list — newest first, optionally filtered by status. */
  async list(query: ListCorporateInquiriesQuery) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.CorporateInquiryWhereInput = {
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, total] = await Promise.all([
      corporateInquiryRepository.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
      corporateInquiryRepository.count(where),
    ]);
    return { items, meta: buildMeta(page, limit, total) };
  }

  /** Staff triage transition (NEW → CONTACTED → QUALIFIED → CLOSED, any order). */
  async updateStatus(id: string, status: CorporateInquiryStatus) {
    const existing = await corporateInquiryRepository.findById(id);
    if (!existing) throw ApiError.notFound("Corporate inquiry not found");
    return corporateInquiryRepository.update(id, { status });
  }
}

export const corporateInquiryService = new CorporateInquiryService();
