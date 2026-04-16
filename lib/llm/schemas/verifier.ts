import { z } from "zod";

export const VerifierSchema = z.object({
  status: z.enum(["PASSED", "FAILED"]),
  reason: z.string().min(3),
  failureCodes: z.array(z.string()).optional(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]).optional()
});

export type VerifierResult = z.infer<typeof VerifierSchema>;
