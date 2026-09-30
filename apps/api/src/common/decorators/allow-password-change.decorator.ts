import { SetMetadata } from "@nestjs/common";

export const ALLOW_WHILE_PASSWORD_CHANGE = "auth:allowWhilePasswordChange";
/** Rota liberada mesmo com mustChangePassword = true (me, logout, change-password). */
export const AllowWhilePasswordChange = () => SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE, true);
