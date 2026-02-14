'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { askAIAssistant } from '@/ai/flows/general-assistant';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles, Map } from 'lucide-react';
import { collection, onSnapshot, query as firestoreQuery, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';

export default function StaffAIPage() {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    if (!db) return;
    const projectsQuery = firestoreQuery(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(projectsQuery, (snapshot) => {
      const activeProjects = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Project))
        .filter(p => !p.deletionScheduledAt);
      setProjects(activeProjects);
    });
    return () => unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsLoading(true);
    setResponse('');
    try {
      const result = await askAIAssistant({ query });
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
    setQuery(presetQuery);
  };

  const interactiveMapUrl = useMemo(() => {
    if (projects.length === 0) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Broad Oak Group, Cheadle, UK')}`;
    }
    const destination = projects[0].address;
    const waypoints = projects.slice(1).map(p => encodeURIComponent(p.address)).join('|');
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&waypoints=${waypoints}`;
  }, [projects]);


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
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            rows={4}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isLoading || !query.trim()}>
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
                    src={`https://www.google.com/maps/embed/v1/place?key=${process.env.NEXT_PUBLIC_MAPS_API_KEY}&q=Broad+Oak+Group,Cheadle`}>
                </iframe>
             </div>
             <div className="text-right mt-2">
                 <Button asChild variant="link">
                    <a href={interactiveMapUrl} target="_blank" rel="noopener noreferrer">
                        <Map className="mr-2 h-4 w-4" />
                        View Interactive Map
                    </a>
                 </Button>
             </div>
        </div>
      </CardContent>
    </Card>
  );
}
