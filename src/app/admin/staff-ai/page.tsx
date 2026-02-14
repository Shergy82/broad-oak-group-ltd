'use client';

import { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { askAIAssistant } from '@/ai/flows/general-assistant';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';


export default function StaffAIPage() {
  const [queryText, setQueryText] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!db) return;
    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(projectsQuery, (snapshot) => {
      const activeProjects = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Project))
        .filter(p => !p.deletionScheduledAt);
      setProjects(activeProjects);
    });
    return () => unsubscribe();
  }, []);
  
  const mapUrl = useMemo(() => {
    if (projects.length === 0) {
      return `https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_MAPS_API_KEY}&q=Broad+Oak+Group,Cheadle`;
    }
    const locations = projects.map(p => encodeURIComponent(p.address)).join('|');
    return `https://www.google.com/maps/embed/v1/search?key=${process.env.NEXT_PUBLIC_MAPS_API_KEY}&q=${locations}`;
  }, [projects]);

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
    const presetQuery = "How do I change a tap?";
    setQueryText(presetQuery);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Staff AI Assistant</CardTitle>
        <CardDescription>
          Ask questions or get help with tasks. The map below shows all active project locations.
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
              {isLoading ? <Spinner /> : <>Ask AI <Sparkles className="ml-2 h-4 w-4" /></>}
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
            <h3 className="font-semibold mb-2">AI Response:</h3>
            <div className="p-4 bg-muted/50 rounded-md whitespace-pre-wrap">
              {response}
            </div>
          </div>
        )}

        <div>
             <h3 className="font-semibold mb-2">Project Locations</h3>
             <div className="aspect-video w-full border rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                <iframe
                    className="w-full h-full border-0"
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={mapUrl}>
                </iframe>
             </div>
        </div>
      </CardContent>
    </Card>
  );
}
