import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type { Company, User } from "@arthur-ai/database";
import {
  createContactSchema,
  listContactsQuerySchema,
  updateContactSchema,
  uuidSchema,
  type ContactDetail,
  type ContactSummary,
  type CreateContactData,
  type ListContactsQuery,
  type Paginated,
  type UpdateContactData,
} from "@arthur-ai/shared";
import { CurrentCompany, CurrentUser } from "../common/decorators/context.decorators.js";
import { CompanyAccessGuard } from "../common/guards/company-access.guard.js";
import { ContactsService } from "./contacts.service.js";

@Controller("companies/:companyId/contacts")
@UseGuards(CompanyAccessGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  list(
    @CurrentCompany() company: Company,
    @Query({ schema: listContactsQuerySchema }) query: ListContactsQuery,
  ): Promise<Paginated<ContactSummary>> {
    return this.contacts.list(company, query);
  }

  @Post()
  create(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @Body({ schema: createContactSchema }) body: CreateContactData,
  ): Promise<ContactDetail> {
    return this.contacts.create(company, body, actor);
  }

  @Get(":contactId")
  get(
    @CurrentCompany() company: Company,
    @Param("contactId", { schema: uuidSchema }) contactId: string,
  ): Promise<ContactDetail> {
    return this.contacts.get(company, contactId);
  }

  @Patch(":contactId")
  update(
    @CurrentCompany() company: Company,
    @CurrentUser() actor: User,
    @Param("contactId", { schema: uuidSchema }) contactId: string,
    @Body({ schema: updateContactSchema }) body: UpdateContactData,
  ): Promise<ContactDetail> {
    return this.contacts.update(company, contactId, body, actor);
  }
}
