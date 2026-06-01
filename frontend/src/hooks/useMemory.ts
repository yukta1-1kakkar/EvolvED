import { useQuery } from "@tanstack/react-query";

import { retrieveMemory } from "@/lib/api";

export function useMemory(learnerId: string | undefined, query: string) {
  return useQuery({
    queryKey: ["memory", learnerId, query],
    queryFn: () => retrieveMemory({ learner_id: learnerId ?? "", query }),
    enabled: Boolean(learnerId && query.trim().length > 0),
    retry: 1,
  });
}
