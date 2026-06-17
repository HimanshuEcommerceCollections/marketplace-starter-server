import type { UserRole } from "@prisma/client";

// Augments Express's Request so authenticated handlers can read `req.user`
// (populated by the `authenticate` middleware) with full type safety.
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };
    }
  }
}

export {};
