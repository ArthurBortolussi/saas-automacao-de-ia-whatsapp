import { SetMetadata } from "@nestjs/common";

export const SKIP_ORIGIN_CHECK = "csrf:skipOriginCheck";
/**
 * Dispensa a checagem de Origin. Só para chamadas servidor→servidor que se autenticam por
 * outro meio (ex.: webhooks da Meta, validados pela assinatura X-Hub-Signature-256).
 */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);
