import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller.js";
import { ContactsService } from "./contacts.service.js";

@Module({
  controllers: [ContactsController],
  providers: [ContactsService],
})
export class ContactsModule {}
