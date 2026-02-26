import { z } from "zod";

export const VerifierSchema = z.object({
  status: z.enum(["PASSED", "FAILED"]),
  reason: z.string().min(3)
});

export type VerifierResult = z.infer<typeof VerifierSchema>;
