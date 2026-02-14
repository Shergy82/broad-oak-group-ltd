'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { askAIAssistant } from '@/ai/flows/general-assistant';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StaffShiftMap } from '@/components/admin/StaffShiftMap';

export default function StaffAIPage() {
  const [queryText, setQueryText] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!queryText.trim()) return;
    setIsLoading(true);
    setResponse('');
    try {
      const result = await askAIAssistant({ query: queryText });
      setResponse(result.response);
    } catch (error) {
      console.error('AI Assistant Error:', error);
      setResponse('Sorry, something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetQuery = () => {
    setQueryText('How do I change a tap?');
  };

  return (
    <div className="space-y-6">
      {/* STAFF AI ASSISTANT */}
      <Card>
        <CardHeader>
          <CardTitle>Staff AI Assistant</CardTitle>
          <CardDescription>
            Ask questions or get help with tasks.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Textarea
              placeholder="e.g., How do I correctly install a compression fitting on a copper pipe?"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              rows={4}
            />

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isLoading || !queryText.trim()}>
                {isLoading ? (
                  <Spinner />
                ) : (
                  <>
                    Ask AI <Sparkles className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <Button type="button" variant="outline" onClick={handlePresetQuery}>
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
        </CardContent>
      </Card>

      {/* TODAY'S SHIFTS MAP */}
      <Card>
        <CardHeader>
          <CardTitle>Today’s Shift Locations</CardTitle>
          <CardDescription>
            Live view of staff locations for today
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaffShiftMap />
        </CardContent>
      </Card>
    </div>
  );
}
