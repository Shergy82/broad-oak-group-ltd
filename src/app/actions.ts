"use server";

import { optimizeHeadlineWithAI, type OptimizeHeadlineWithAIInput } from "@/ai/flows/optimize-headline-with-ai";

export async function getHeadlineSuggestions(
  input: OptimizeHeadlineWithAIInput
): Promise<{ suggestions?: string[]; error?: string }> {
  try {
    const result = await optimizeHeadlineWithAI(input);
    return { suggestions: result };
  } catch (error) {
    console.error("Error optimizing headline:", error);
    // In a production app, you might want to log this error to a monitoring service.
    return { error: "Failed to generate suggestions. Please try again later." };
  }
}
