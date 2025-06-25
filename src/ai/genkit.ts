import {configureGenkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

configureGenkit({
  plugins: [googleAI()],
  logLevel: 'debug',
  defaultModel: 'googleai/gemini-2.0-flash',
});
