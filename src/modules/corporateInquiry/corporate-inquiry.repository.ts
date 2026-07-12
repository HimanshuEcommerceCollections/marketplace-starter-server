import { prisma } from "../../db/client";
import type { Prisma } from "@prisma/client";

export class CorporateInquiryRepository {
  findMany(args: Prisma.CorporateInquiryFindManyArgs) {
    return prisma.corporateInquiry.findMany(args);
  }
  count(where?: Prisma.CorporateInquiryWhereInput) {
    return prisma.corporateInquiry.count({ where });
  }
  findById(id: string) {
    return prisma.corporateInquiry.findUnique({ where: { id } });
  }
  create(data: Prisma.CorporateInquiryUncheckedCreateInput) {
    return prisma.corporateInquiry.create({ data });
  }
  update(id: string, data: Prisma.CorporateInquiryUncheckedUpdateInput) {
    return prisma.corporateInquiry.update({ where: { id }, data });
  }
}

export const corporateInquiryRepository = new CorporateInquiryRepository();
