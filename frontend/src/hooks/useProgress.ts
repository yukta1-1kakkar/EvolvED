import { useQuery } from "@tanstack/react-query";

import { getProgress } from "@/lib/api/progress";

export function useProgress(learnerId: string | undefined) {
  return useQuery({
    queryKey: ["progress", learnerId],
    queryFn: () => getProgress(learnerId ?? ""),
    enabled: Boolean(learnerId),
    retry: 0,
  });
}
