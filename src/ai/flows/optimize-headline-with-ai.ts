"use server";

import { ai } from "@/ai/genkit";
import { z } from "genkit";

/* =========================
 *  Schema
 * ========================= */

const OptimizeHeadlineWithAIInputSchema = z.object({
  headline: z.string().min(1),
});
export type OptimizeHeadlineWithAIInput = z.infer<
  typeof OptimizeHeadlineWithAIInputSchema
>;

/* =========================
 *  Exported Function (REQUIRED)
 * ========================= */

export async function optimizeHeadlineWithAI(
  input: OptimizeHeadlineWithAIInput
): Promise<string[]> {
  const parsed = OptimizeHeadlineWithAIInputSchema.parse(input);

  const result = await ai.generate({
    model: "googleai/gemini-1.5-flash-latest",
    prompt: [
      "You are a professional copywriting assistant.",
      "Improve the following headline and return 5 concise alternatives.",
      "",
      `Headline: ${parsed.headline}`,
      "",
      "Rules:",
      "- Keep suggestions short",
      "- Professional tone",
      "- No emojis",
      "- Return each suggestion on a new line",
    ].join("\n"),
    config: {
      temperature: 0.6,
    },
  });

  if (!result.text) {
    throw new Error("AI returned no response");
  }

  return result.text
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5);
}
