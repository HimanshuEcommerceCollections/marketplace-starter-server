import type { Prisma } from "@prisma/client";
import { usersRepository } from "./users.repository";
import { ApiError } from "../../utils/api-error";
import { toPublicUser } from "../../utils/user";
import { hashPassword } from "../../utils/password";
import { buildPagination, buildMeta } from "../../utils/pagination";
import { UserStatus } from "../../enums";
import type {
  ListUsersQuery,
  CreateUserDto,
  UpdateMeDto,
  UpdateRoleDto,
  UpdateStatusDto,
} from "./users.types";

export class UsersService {
  async list(query: ListUsersQuery) {
    const { skip, take, page, limit } = buildPagination(query);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [users, total] = await Promise.all([
      usersRepository.findMany({ where, skip, take, orderBy: { createdAt: "desc" } }),
      usersRepository.count(where),
    ]);
    return { items: users.map(toPublicUser), meta: buildMeta(page, limit, total) };
  }

  async getById(id: string) {
    const user = await usersRepository.findById(id);
    if (!user) throw ApiError.notFound("User not found");
    return toPublicUser(user);
  }

  /** Admin-provisioned account: any role, initial password, status ACTIVE. */
  async create(dto: CreateUserDto) {
    const existing = await usersRepository.findByEmail(dto.email);
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const passwordHash = await hashPassword(dto.password);
    const user = await usersRepository.create({
      name: dto.name,
      email: dto.email,
      passwordHash,
      phone: dto.phone,
      brand: dto.brand,
      role: dto.role,
      status: UserStatus.ACTIVE,
    });
    return toPublicUser(user);
  }

  async updateProfile(id: string, dto: UpdateMeDto) {
    const updated = await usersRepository.update(id, dto);
    return toPublicUser(updated);
  }

  async updateRole(id: string, dto: UpdateRoleDto) {
    await this.getById(id);
    return toPublicUser(await usersRepository.update(id, { role: dto.role }));
  }

  async updateStatus(id: string, dto: UpdateStatusDto) {
    await this.getById(id);
    return toPublicUser(await usersRepository.update(id, { status: dto.status }));
  }
}

export const usersService = new UsersService();
