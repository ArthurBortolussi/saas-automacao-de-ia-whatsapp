import { Injectable } from "@nestjs/common";
import type { AdminDashboardResponse, AdminUserItem, ListUsersQuery, Paginated } from "@arthur-ai/shared";
import { toCompanySummary } from "../companies/company.mapper.js";
import { PrismaService } from "../prisma/prisma.service.js";

const RECENT_COMPANIES = 5;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async dashboard(): Promise<AdminDashboardResponse> {
    const [companies, activeCompanies, onboardingCompanies, users, recent] = await this.prisma.$transaction([
      this.prisma.company.count(),
      this.prisma.company.count({ where: { status: "ACTIVE" } }),
      this.prisma.company.count({ where: { status: "ONBOARDING" } }),
      this.prisma.user.count(),
      this.prisma.company.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: RECENT_COMPANIES }),
    ]);
    return {
      totals: { companies, activeCompanies, onboardingCompanies, users },
      recentCompanies: recent.map(toCompanySummary),
    };
  }

  async listUsers(query: ListUsersQuery): Promise<Paginated<AdminUserItem>> {
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { membership: { include: { company: { select: { id: true, name: true } } } } },
      }),
      this.prisma.user.count(),
    ]);
    return {
      items: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        globalRole: user.globalRole,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        company: user.membership
          ? { id: user.membership.company.id, name: user.membership.company.name, role: user.membership.role }
          : null,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
