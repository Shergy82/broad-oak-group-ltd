'use client';

import { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Project } from '@/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { askAIAssistant } from '@/ai/flows/general-assistant';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/shared/spinner';
import { Sparkles, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function StaffAIPage() {
  const [queryText, setQueryText] = useState('');
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    if (!db) return;
    setLoadingProjects(true);
    const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(projectsQuery, (snapshot) => {
      const activeProjects = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as Project))
        .filter(p => !p.deletionScheduledAt);
      setProjects(activeProjects);
      setLoadingProjects(false);
    }, (error) => {
        console.error("Error fetching projects:", error);
        setLoadingProjects(false);
    });
    return () => unsubscribe();
  }, []);

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
        <CardTitle>Staff AI Assistant & Project Locations</CardTitle>
        <CardDescription>
          Ask questions or get help with tasks. A list of active project locations is provided below.
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
             <div className="border rounded-lg bg-muted/30 p-4 space-y-2">
                {loadingProjects ? (
                    <div className="flex items-center justify-center h-24">
                        <Spinner />
                    </div>
                ) : projects.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No active projects found.</p>
                ) : (
                    <ul className="space-y-2">
                        {projects.map(project => (
                            <li key={project.id} className="flex items-center justify-between p-2 bg-background rounded-md border">
                                <span className="font-medium text-sm">{project.address}</span>
                                <Button variant="ghost" size="sm" asChild>
                                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(project.address)}`} target="_blank" rel="noopener noreferrer">
                                        <MapPin className="mr-2 h-4 w-4" /> View Map
                                    </a>
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}
             </div>
        </div>
      </CardContent>
    </Card>
  );
}
