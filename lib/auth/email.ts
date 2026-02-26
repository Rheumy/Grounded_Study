import type { SendVerificationRequestParams } from "next-auth/providers/email";
import { logger } from "@/lib/observability/logger";

export async function safeSendVerificationRequest(params: SendVerificationRequestParams) {
  const { identifier } = params;
  logger.info({ email: identifier }, "Magic link requested (delivery disabled)");
  return;
}
