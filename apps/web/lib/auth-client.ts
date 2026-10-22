"use client";
import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// The login form handles `twoFactorRedirect` itself (navigates to /login/two-factor).
export const authClient = createAuthClient({ plugins: [twoFactorClient()] });
