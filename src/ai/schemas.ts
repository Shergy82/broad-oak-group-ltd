import { z } from 'genkit';

// Schemas for findMerchants
export const FindMerchantsInputSchema = z.object({
  query: z.string().describe('The type of merchant to search for, e.g., "plumbers" or "best coffee shops".'),
  lat: z.number().describe('The latitude of the search center.'),
  lng: z.number().describe('The longitude of the search center.'),
});
export type FindMerchantsInput = z.infer<typeof FindMerchantsInputSchema>;

export const MerchantSchema = z.object({
  name: z.string().describe('The name of the business.'),
  address: z.string().describe('A plausible, specific street address for the business.'),
  lat: z.number().describe('The latitude coordinate for the address.'),
  lng: z.number().describe('The longitude coordinate for the address.'),
  category: z.string().describe('The business category, e.g., "Plumbing", "Cafe".'),
});
export type Merchant = z.infer<typeof MerchantSchema>;

export const FindMerchantsOutputSchema = z.array(MerchantSchema);

// Schemas for optimizeHeadlineWithAI
export const OptimizeHeadlineWithAIInputSchema = z.object({
    headline: z.string().min(1),
});
export type OptimizeHeadlineWithAIInput = z.infer<typeof OptimizeHeadlineWithAIInputSchema>;
