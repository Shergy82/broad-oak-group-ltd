"use client";

import { useState } from "react";
import { useForm, type SubmitHandler } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Wand2, Loader2, Lightbulb } from "lucide-react";
import { getHeadlineSuggestions } from "@/app/actions";
import { useToast } from "@/hooks/use-toast";

const formSchema = z.object({
  draftHeadline: z.string().min(10, "Please enter a headline of at least 10 characters."),
  productDescription: z.string().min(20, "Please describe your product in at least 20 characters."),
  targetAudience: z.string().min(10, "Please describe your audience in at least 10 characters."),
});

type FormData = z.infer<typeof formSchema>;

export function HeadlineOptimizer() {
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
  });

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    setIsLoading(true);
    setSuggestions([]);
    const result = await getHeadlineSuggestions({
      headline: data.draftHeadline,
    });    
    setIsLoading(false);
    
    if (result.error) {
      toast({
        variant: "destructive",
        title: "An error occurred",
        description: result.error,
      });
    } else if (result.suggestions) {
      setSuggestions(result.suggestions);
    }
  };

  return (
    <section id="headline-optimizer" className="py-12 lg:py-24 bg-secondary">
      <div className="container mx-auto px-4">
        <div className="grid md:grid-cols-2 gap-12 items-start">
          <div>
            <h2 className="text-3xl md:text-4xl font-headline font-bold">Optimize Your Headline with AI</h2>
            <p className="text-lg text-muted-foreground mt-2 mb-6">
              Struggling with a catchy headline? Describe your product and audience, and let our AI provide you with high-converting alternatives.
            </p>
            <Card className="shadow-lg">
              <CardContent className="pt-6">
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="draftHeadline">Draft Headline</Label>
                    <Input id="draftHeadline" placeholder="e.g., The Best Tool for X" {...register("draftHeadline")} />
                    {errors.draftHeadline && <p className="text-sm text-destructive">{errors.draftHeadline.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="productDescription">Product Description</Label>
                    <Textarea id="productDescription" placeholder="Describe what your product does, its key features, and benefits." {...register("productDescription")} />
                    {errors.productDescription && <p className="text-sm text-destructive">{errors.productDescription.message}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="targetAudience">Target Audience</Label>
                    <Input id="targetAudience" placeholder="e.g., Small business owners, marketers" {...register("targetAudience")} />
                    {errors.targetAudience && <p className="text-sm text-destructive">{errors.targetAudience.message}</p>}
                  </div>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="mr-2 h-4 w-4" />
                    )}
                    Generate Suggestions
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
          <div className="mt-8 md:mt-0">
             <h3 className="text-2xl font-headline font-semibold mb-4">AI Suggestions</h3>
            <div className="rounded-lg border bg-background min-h-[300px] flex items-center justify-center p-4">
              <div className="w-full">
                {isLoading && (
                  <div className="flex flex-col items-center justify-center text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
                    <p>Generating ideas...</p>
                  </div>
                )}
                {!isLoading && suggestions.length === 0 && (
                  <div className="flex flex-col items-center justify-center text-center text-muted-foreground">
                    <Lightbulb className="h-8 w-8 mb-4 text-primary/50" />
                    <p>Your AI-powered headline suggestions will appear here.</p>
                  </div>
                )}
                {suggestions.length > 0 && (
                  <ul className="space-y-4">
                    {suggestions.map((s, i) => (
                      <li key={i}>
                        <Card className="bg-background border-primary/20 shadow-sm">
                            <CardContent className="p-4">
                                <p className="font-medium text-primary-foreground font-headline">{s}</p>
                            </CardContent>
                        </Card>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
