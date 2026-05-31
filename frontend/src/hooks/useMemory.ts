import { useQuery } from "@tanstack/react-query";

import { retrieveMemory } from "@/lib/api";

export function useMemory(query: string) {
  return useQuery({
    queryKey: ["memory", query],
    queryFn: () => retrieveMemory({ query }),
    enabled: query.trim().length > 0,
    retry: 1,
  });
}
