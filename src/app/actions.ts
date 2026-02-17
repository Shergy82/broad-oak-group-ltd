"use server";

import { optimizeHeadlineWithAI } from "@/ai/flows/optimize-headline-with-ai";
import { findMerchants } from "@/ai/flows/find-merchants-flow";
import type { OptimizeHeadlineWithAIInput, FindMerchantsInput, Merchant } from "@/ai/schemas";

export type { Merchant };

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

export async function findLocalMerchants(
  input: FindMerchantsInput
): Promise<{ merchants?: Merchant[]; error?: string }> {
  try {
    const result = await findMerchants(input);
    return { merchants: result };
  } catch (error) {
    console.error("Error finding merchants:", error);
    return { error: "Failed to find merchants. Please try again later." };
  }
}
