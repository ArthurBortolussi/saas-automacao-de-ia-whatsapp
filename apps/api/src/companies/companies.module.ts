import { Module } from "@nestjs/common";
import { CompaniesService } from "./companies.service.js";
import { CompanyController } from "./company.controller.js";

@Module({
  controllers: [CompanyController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
