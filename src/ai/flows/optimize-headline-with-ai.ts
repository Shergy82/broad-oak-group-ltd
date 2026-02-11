'use server';

/**
 * @fileOverview A general purpose AI assistant for tradespeople.
 *
 * - askAIAssistant - A function that takes a user's query and returns a helpful response.
 * - AskAIAssistantInput - The input type for the askAIAssistant function.
 * - AskAIAssistantOutput - The return type for the askAIAssistant function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const AskAIAssistantInputSchema = z.object({
  query: z.string().describe("The user's question or prompt."),
});
export type AskAIAssistantInput = z.infer<typeof AskAIAssistantInputSchema>;

const AskAIAssistantOutputSchema = z.object({
  response: z.string().describe('The AI-generated answer.'),
});
export type AskAIAssistantOutput = z.infer<typeof AskAIAssistantOutputSchema>;

export async function askAIAssistant(
  input: AskAIAssistantInput
): Promise<AskAIAssistantOutput> {
  return askAIAssistantFlow(input);
}

const askAIAssistantPrompt = ai.definePrompt({
  name: 'askAIAssistantPrompt',
  input: {schema: AskAIAssistantInputSchema},
  // No output schema, to get a raw text response
  prompt: `You are a helpful AI assistant for tradespeople (plumbers, electricians, etc.) working for a company called Broad Oak Group. Your goal is to provide clear, concise, and practical help.

  User's query: {{{query}}}

  IMPORTANT:
  - If you are asked for real-time, location-specific information (like "what's the nearest plumbing merchants"), you MUST state that you cannot access live location data. You can, however, provide a general list of popular UK-based suppliers for that trade.
  - Keep your answers direct and to the point.
  - If asked for instructions (e.g., "how to change a tap"), provide a simple, step-by-step guide.`,
});

const askAIAssistantFlow = ai.defineFlow(
  {
    name: 'askAIAssistantFlow',
    inputSchema: AskAIAssistantInputSchema,
    outputSchema: AskAIAssistantOutputSchema,
  },
  async input => {
    const llmResponse = await askAIAssistantPrompt(input);
    
    // Manually construct the output to match the schema
    return {
        response: llmResponse.text,
    };
  }
);
