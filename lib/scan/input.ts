import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const ScanInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("site"), url: z.string().trim().min(4).max(2048), sitemap: z.boolean().optional(), citeDate: date }),
  z.object({ kind: z.literal("github"), repo: z.string().trim().min(3).max(300) }),
  z.object({ kind: z.literal("markdown"), text: z.string().min(1).max(500_000), citeDate: date }),
]);
