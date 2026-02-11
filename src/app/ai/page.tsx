"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Wand2, Loader2, Sparkles } from "lucide-react";
import { getAiAssistantResponse } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";

export default function AiPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
        toast({
            variant: "destructive",
            title: "Query is empty",
            description: "Please enter a question or prompt.",
        });
        return;
    }

    setIsLoading(true);
    setResponse("");
    const result = await getAiAssistantResponse({ query });
    setIsLoading(false);
    
    if (result.error) {
      toast({
        variant: "destructive",
        title: "An error occurred",
        description: result.error,
      });
    } else if (result.response) {
      setResponse(result.response);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Assistant</CardTitle>
        <CardDescription>
          Your general-purpose AI helper. Ask for instructions, find information, or get help with a task.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid md:grid-cols-2 gap-8 items-start">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="ai-query">Your Question</Label>
                <Textarea
                    id="ai-query"
                    placeholder="e.g., How do I change a compression fitting on a copper pipe?"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    rows={5}
                />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="mr-2 h-4 w-4" />
              )}
              Ask AI
            </Button>
          </form>

          <div className="space-y-2">
             <Label>AI Response</Label>
            <div className="rounded-lg border bg-muted min-h-[220px] flex items-center justify-center p-4">
              <div className="w-full">
                {isLoading && (
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
                    <p>Thinking...</p>
                  </div>
                )}
                {!isLoading && !response && (
                  <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
                    <Sparkles className="h-8 w-8 mb-4 text-primary/50" />
                    <p>The AI's response will appear here.</p>
                  </div>
                )}
                {response && (
                  <div className="whitespace-pre-wrap text-sm">{response}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
