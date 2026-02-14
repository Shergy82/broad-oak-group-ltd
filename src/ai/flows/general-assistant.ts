'use server';
/**
 * @fileOverview A general purpose AI assistant for tradespeople.
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
  
  const llmResponse = await ai.generate({
    prompt: `You are a helpful AI assistant for tradespeople (plumbers, electricians, etc.) working for a company called Broad Oak Group. Your goal is to provide clear, concise, and practical help.

    - If you are asked for real-time, location-specific information (like "what's the nearest plumbing merchants" or "where is everyone working today?"), you MUST state that you cannot access live location data. You can, however, provide a general list of popular UK-based suppliers for that trade.
    - For all other questions, provide a helpful text-based answer in the 'response' field.
    - Keep your answers direct and to the point.
    - If asked for instructions (e.g., "how to change a tap"), provide a simple, step-by-step guide.
    
    User's query: ${input.query}
    `,
    model: 'googleai/gemini-1.5-flash-latest',
    output: {
      schema: AskAIAssistantOutputSchema,
    },
    config: {
      temperature: 0.5,
    },
  });

  const output = llmResponse.output;
  if (!output) {
      throw new Error('Received an empty response from the AI model.');
  }

  if (!output.response) {
      output.response = "Sorry, I couldn't determine an answer for that.";
  }

  return output;
}
