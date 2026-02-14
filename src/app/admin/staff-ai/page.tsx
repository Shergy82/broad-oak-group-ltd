'use client';

import { useState, useMemo, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { askAIAssistant } from '@/ai/flows/general-assistant';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles } from 'lucide-react';
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
  }

  const mapUrl = useMemo(() => {
    const baseUrl = `https://www.google.com/maps/embed/v1/search`;
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;

    if (projects.length === 0) {
      // Fallback to a central location if there are no projects
      return `${baseUrl}?key=${apiKey}&q=${encodeURIComponent('Broad Oak Group, Cheadle, UK')}`;
    }

    const locations = projects
      .map(p => `${p.address}, ${p.council || ''}`)
      .join('|');
      
    return `${baseUrl}?key=${apiKey}&q=${encodeURIComponent(locations)}`;
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
             <div className="aspect-video w-full border rounded-lg overflow-hidden">
                <iframe
                    width="100%"
                    height="100%"
                    style={{ border: 0 }}
                    loading="lazy"
                    allowFullScreen
                    referrerPolicy="no-referrer-when-downgrade"
                    src={mapUrl}
                ></iframe>
             </div>
        </div>
      </CardContent>
    </Card>
  );
}
