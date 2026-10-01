import type {
  ContactSource as SharedContactSource,
  ContactStatus as SharedContactStatus,
  ConversationMode as SharedConversationMode,
  MessageDirection as SharedMessageDirection,
  MessageSenderType as SharedMessageSenderType,
  CompanyStatus as SharedCompanyStatus,
  GlobalRole as SharedGlobalRole,
  MemberRole as SharedMemberRole,
  UserStatus as SharedUserStatus,
} from "@arthur-ai/shared";
import type {
  CompanyStatus,
  ContactSource,
  ContactStatus,
  ConversationMode,
  GlobalRole,
  MemberRole,
  MessageDirection,
  MessageSenderType,
  UserStatus,
} from "./generated/prisma/client.js";

// Falha o typecheck se os enums do Prisma e do pacote shared divergirem.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

export type EnumParity = [
  Assert<Equals<GlobalRole, SharedGlobalRole>>,
  Assert<Equals<UserStatus, SharedUserStatus>>,
  Assert<Equals<CompanyStatus, SharedCompanyStatus>>,
  Assert<Equals<MemberRole, SharedMemberRole>>,
  Assert<Equals<ContactStatus, SharedContactStatus>>,
  Assert<Equals<ContactSource, SharedContactSource>>,
  Assert<Equals<ConversationMode, SharedConversationMode>>,
  Assert<Equals<MessageDirection, SharedMessageDirection>>,
  Assert<Equals<MessageSenderType, SharedMessageSenderType>>,
];
