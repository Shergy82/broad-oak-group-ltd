'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { askAIAssistant } from '@/ai/flows/general-assistant';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles, MapPin } from 'lucide-react';

// Define a type for the location data
type Location = {
  userName: string;
  address: string;
  task: string;
  type: string;
};

export default function StaffAIPage() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsLoading(true);
    setResponse('');
    setLocations([]);
    try {
      const result = await askAIAssistant({ query });
      setResponse(result.response);
      if (result.locations) {
        setLocations(result.locations);
      }
    } catch (error) {
      console.error('AI Assistant Error:', error);
      setResponse('Sorry, something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePresetQuery = () => {
    const presetQuery = "Where is everyone working today?";
    setQuery(presetQuery);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff AI Assistant</CardTitle>
        <CardDescription>
          Ask questions or get help with tasks. The AI is tailored to assist tradespeople at Broad Oak Group.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <Textarea
            placeholder="e.g., How do I correctly install a compression fitting on a copper pipe?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isLoading || !query.trim()}>
              {isLoading ? <Spinner /> : <>Ask AI <Sparkles className="ml-2 h-4 w-4" /></>}
            </Button>
            <Button type="button" variant="outline" onClick={handlePresetQuery}>
                <MapPin className="mr-2 h-4 w-4" /> Where is everyone working today?
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
            <h3 className="font-semibold mb-2">AI Response:</h3>
            <div className="p-4 bg-muted/50 rounded-md whitespace-pre-wrap">
              {response}
            </div>
          </div>
        )}

        {locations.length > 0 && !isLoading && (
            <div className="pt-4 space-y-4">
                 <h3 className="font-semibold mb-2">Today's Work Locations:</h3>
                 <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {locations.map((loc, index) => (
                        <Card key={index}>
                            <CardHeader>
                                <CardTitle className="text-base">{loc.userName}</CardTitle>
                                <CardDescription>{loc.task}</CardDescription>
                            </CardHeader>
                            <CardContent className="text-sm">
                                <p>{loc.address}</p>
                                <p className="capitalize text-muted-foreground">{loc.type.replace('-', ' ')}</p>
                            </CardContent>
                            <CardFooter>
                                <Button asChild variant="link" className="p-0 h-auto">
                                    <a href={`https://www.google.com/maps?q=${encodeURIComponent(loc.address)}`} target="_blank" rel="noopener noreferrer">
                                        View on Map <MapPin className="ml-2 h-4 w-4" />
                                    </a>
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                 </div>
            </div>
        )}

      </CardContent>
    </Card>
  );
}
