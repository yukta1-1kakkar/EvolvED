import { useQuery } from "@tanstack/react-query";

import { getAnalytics } from "@/lib/api";

export function useAnalytics(learnerId: string | undefined) {
  return useQuery({
    queryKey: ["analytics", learnerId],
    queryFn: () => getAnalytics(learnerId ?? ""),
    enabled: Boolean(learnerId),
    retry: 1,
  });
}
