import type { AuthContext, TenantContext } from "./request-context.js";

// Preenchidos pelos guards (SessionGuard e CompanyAccessGuard); nunca a partir de input do cliente.
declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenant?: TenantContext;
    }
  }
}
