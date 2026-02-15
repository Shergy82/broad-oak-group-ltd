'use client';

import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UserProfile } from '@/types';

export function StaffAIWidget({ userProfile }: { userProfile: UserProfile }) {
  const [queryText, setQueryText] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;

    const auth = getAuth();
    if (!auth.currentUser) {
      setResponse('You must be logged in to use the AI assistant.');
      return;
    }

    setIsLoading(true);
    setResponse('');

    try {
      const functions = getFunctions(undefined, 'europe-west2');

      // 🔒 Callable function – NO CORS issues
      const askAI = httpsCallable<
        { query: string },
        { response: string }
      >(functions, 'askAIAssistant');

      const result = await askAI({
        query: queryText.trim(),
      });

      setResponse(result.data.response);
    } catch (error: any) {
      console.error('AI Assistant Error:', error);
      setResponse(
        error?.message ||
          'Sorry, something went wrong. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetQuery = () => {
    setQueryText('How do I change a tap?');
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Textarea
          placeholder="e.g., How do I correctly install a compression fitting on a copper pipe?"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          rows={4}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={isLoading || !queryText.trim()}
          >
            {isLoading ? (
              <Spinner />
            ) : (
              <>
                Ask AI <Sparkles className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handlePresetQuery}
            disabled={isLoading}
          >
            Ask a preset question
          </Button>
        </div>
      </form>

      {isLoading && (
        <div className="flex justify-center py-4">
          <Spinner size="lg" />
        </div>
      )}

      {response && !isLoading && (
        <div className="pt-4">
          <h3 className="mb-2 font-semibold">AI Response</h3>
          <div className="rounded-md bg-muted/50 p-4 whitespace-pre-wrap">
            {response}
          </div>
        </div>
      )}
    </div>
  );
}
