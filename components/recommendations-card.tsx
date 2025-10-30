'use client';

import { useQuery } from '@tanstack/react-query';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { client } from '@/lib/hono'; // Assuming you have a Hono client setup

export const RecommendationsCard = () => {
  const { data: recommendations, isLoading, isError, error } = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () => {
      const response = await client.api.recommendations.$get();
      if (!response.ok) {
        throw new Error('Failed to fetch recommendations');
      }
      const { data } = await response.json();
      return data as string[]; // Type assertion for the recommendations array
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    retry: 1, // Retry once on failure
  });

  if (isLoading) {
    return (
      <Card className="border-none drop-shadow-sm h-[200px]">
        <CardHeader>
          <CardTitle className="text-xl line-clamp-1">
            <Skeleton className="h-6 w-36" />
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[calc(100%-4rem)]">
          <Loader2 className="size-6 text-slate-300 animate-spin mb-2" />
          <Skeleton className="h-4 w-48" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
       <Card className="border-rose-500/50 drop-shadow-sm h-[200px]">
         <CardHeader>
           <CardTitle className="text-xl line-clamp-1 text-rose-500">
             Spending Suggestions
           </CardTitle>
         </CardHeader>
         <CardContent className="flex flex-col items-center justify-center h-[calc(100%-4rem)]">
           <AlertTriangle className="size-6 text-rose-500 mb-2" />
           <p className="text-sm text-muted-foreground text-center">
             Could not load suggestions. Please try again later.
           </p>
            {/* Optional: Show specific error */}
            {/* <p className="text-xs text-rose-500 mt-1">{error?.message}</p> */}
         </CardContent>
       </Card>
    );
  }

  return (
    <Card className="border-none drop-shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl line-clamp-1">
          Spending Suggestions
        </CardTitle>
      </CardHeader>
      <CardContent>
        {recommendations && recommendations.length > 0 ? (
          <ul className="space-y-2 text-sm text-muted-foreground list-disc pl-5">
            {recommendations.map((rec, index) => (
              <li key={index}>{rec}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No specific recommendations available right now.
          </p>
        )}
      </CardContent>
    </Card>
  );
};

