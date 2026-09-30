import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";

@Module({
  imports: [CompaniesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
