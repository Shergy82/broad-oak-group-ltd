"use server";

import { askAIAssistant, type AskAIAssistantInput } from "@/ai/flows/general-assistant";

export async function getAiAssistantResponse(
  input: AskAIAssistantInput
): Promise<{ response?: string; error?: string }> {
  try {
    const result = await askAIAssistant(input);
    return { response: result.response };
  } catch (error: any) {
    console.error("Error getting AI assistant response:", error);
    // In a production app, you might want to log this error to a monitoring service.
    return { error: error.message || "Failed to get a response. Please try again later." };
  }
}
