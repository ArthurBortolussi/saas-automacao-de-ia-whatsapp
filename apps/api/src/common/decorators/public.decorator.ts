import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC = "auth:isPublic";
/** Rota acessível sem sessão (ex.: login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
