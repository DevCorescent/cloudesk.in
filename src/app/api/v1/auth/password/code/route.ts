import { route } from "@/server/http/handler";
import { issueOtp } from "@/server/auth/otp";

// Forgot the current password: a six-digit code is emailed to the account,
// and PATCH /auth/password takes it in place of the current password.
export const POST = route(async (ctx) => {
  const r = await issueOtp(ctx.user.email, "password", { ip: ctx.ip });
  return { expiresAt: r.expiresAt, email: ctx.user.email, ...(r.devCode ? { devCode: r.devCode } : {}) };
});
