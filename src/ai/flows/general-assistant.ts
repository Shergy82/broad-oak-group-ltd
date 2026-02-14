'use server';
/**
 * @fileOverview A general purpose AI assistant for tradespeople.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { startOfToday } from 'date-fns';

// Tool to get current shifts
const getCurrentShifts = ai.defineTool(
  {
    name: 'getCurrentShifts',
    description: "Get a list of all shifts scheduled for today.",
    inputSchema: z.object({}),
    outputSchema: z.array(z.object({
        userName: z.string(),
        address: z.string(),
        task: z.string(),
        type: z.string().describe("Can be 'am', 'pm', or 'all-day'"),
    })),
  },
  async () => {
    if (!db) return [];

    const today = startOfToday();
    const start = Timestamp.fromDate(today);
    const end = Timestamp.fromDate(new Date(today.getTime() + 24 * 60 * 60 * 1000 - 1));

    const shiftsQuery = query(
      collection(db, 'shifts'),
      where('date', '>=', start),
      where('date', '<=', end)
    );

    const snapshot = await getDocs(shiftsQuery);
    if (snapshot.empty) {
        return [];
    }
    
    return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
            userName: data.userName || 'Unknown',
            address: data.address || 'Unknown',
            task: data.task || 'No task specified',
            type: data.type || 'all-day',
        };
    });
  }
);


const AskAIAssistantInputSchema = z.object({
  query: z.string().describe("The user's question or prompt."),
});
export type AskAIAssistantInput = z.infer<typeof AskAIAssistantInputSchema>;

const AskAIAssistantOutputSchema = z.object({
  response: z.string().describe('The AI-generated answer.'),
  locations: z.array(z.object({
    userName: z.string(),
    address: z.string(),
    task: z.string(),
    type: z.string(),
  })).optional().describe("A list of work locations, if the user asked for them."),
});
export type AskAIAssistantOutput = z.infer<typeof AskAIAssistantOutputSchema>;

export async function askAIAssistant(
  input: AskAIAssistantInput
): Promise<AskAIAssistantOutput> {
  
  const llmResponse = await ai.generate({
    prompt: `You are a helpful AI assistant for tradespeople (plumbers, electricians, etc.) working for a company called Broad Oak Group. Your goal is to provide clear, concise, and practical help.

    - If you are asked for real-time, location-specific information (like "what's the nearest plumbing merchants"), you MUST state that you cannot access live location data. You can, however, provide a general list of popular UK-based suppliers for that trade.
    - If asked "where is everyone working today?", "show me today's work locations", or a similar query about current job sites, use the getCurrentShifts tool to get the data. Then, populate the 'locations' field in the output with the tool's results and provide a brief summary in the 'response' field.
    - For all other questions, provide a helpful text-based answer in the 'response' field and leave the 'locations' field empty.
    - Keep your answers direct and to the point.
    - If asked for instructions (e.g., "how to change a tap"), provide a simple, step-by-step guide.
    
    User's query: ${input.query}
    `,
    model: 'googleai/gemini-1.5-flash-latest',
    tools: [getCurrentShifts],
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

  // Ensure response is always a string, even if the model doesn't provide one.
  if (!output.response) {
      if (output.locations && output.locations.length > 0) {
          output.response = `I found ${output.locations.length} job site(s) for today.`;
      } else if (llmResponse.toolRequests.length > 0) {
          output.response = "No one is scheduled to work today.";
      } else {
          output.response = "Sorry, I couldn't determine an answer for that.";
      }
  }

  return output;
}
