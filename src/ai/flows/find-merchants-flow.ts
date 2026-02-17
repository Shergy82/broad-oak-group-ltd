'use server';

import { ai } from '@/ai/genkit';
import {
    FindMerchantsInputSchema,
    FindMerchantsOutputSchema,
    type FindMerchantsInput,
    type Merchant,
} from '@/ai/schemas';


const findMerchantsPrompt = ai.definePrompt({
  name: 'findMerchantsPrompt',
  model: 'googleai/gemini-1.5-flash-latest',
  input: { schema: FindMerchantsInputSchema },
  output: { schema: FindMerchantsOutputSchema },
  prompt: `
    You are an expert local guide AI. Your task is to generate a list of 5 realistic, but completely fictional, local merchants based on a user's search query and location.

    The user is searching for: "{{query}}"
    Their current location is approximately around latitude {{lat}} and longitude {{lng}}.

    Generate a list of 5 fictional businesses that match this query.
    Each business must be a JSON object with the following properties: "name" (string), "address" (string), "lat" (number), "lng" (number), "category" (string).

    - The "name" should be creative and realistic.
    - The "address" should be a plausible, specific street address located realistically near the user's coordinates.
    - "lat" and "lng" should be plausible coordinates for that address, very close to the user's location.
    - The "category" should match the user's query (e.g., "Plumbing", "Cafe").

    The entire output MUST be ONLY a valid JSON array of these 5 objects, conforming to the output schema. Do not include any other text, explanation, or markdown.
  `,
});

export async function findMerchants(input: FindMerchantsInput): Promise<Merchant[]> {
    const { output } = await findMerchantsPrompt(input);
    if (!output) {
      return [];
    }
    return output;
}
