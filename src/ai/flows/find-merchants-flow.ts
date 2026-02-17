'use server';

import { ai } from '@/ai/genkit';
import {
    FindMerchantsInputSchema,
    FindMerchantsOutputSchema,
    type FindMerchantsInput
} from '@/ai/schemas';

const findMerchantsPrompt = ai.definePrompt({
  name: 'findMerchantsPrompt',
  input: { schema: FindMerchantsInputSchema },
  output: { schema: FindMerchantsOutputSchema },
  prompt: `
    You are an expert local guide AI. Your task is to generate a list of 5 realistic, but completely fictional, local merchants based on a user's search query and location.

    The user is searching for: "{{query}}"
    Their current location is approximately around latitude {{lat}} and longitude {{lng}}.

    Generate a list of 5 fictional businesses that match this query.
    For each business, provide:
    1. A creative and realistic business name.
    2. A plausible, specific street address located realistically near the user's coordinates.
    3. Plausible latitude and longitude coordinates for that address. The coordinates should be very close to the user's provided location, with small random variations to appear as if they are in the same neighborhood.

    The output MUST be a valid JSON array of objects, conforming to the output schema.
  `,
});

export const findMerchants = ai.defineFlow(
  {
    name: 'findMerchantsFlow',
    inputSchema: FindMerchantsInputSchema,
    outputSchema: FindMerchantsOutputSchema,
  },
  async (input: FindMerchantsInput) => {
    const { output } = await findMerchantsPrompt(input);
    if (!output) {
      return [];
    }
    return output;
  }
);
