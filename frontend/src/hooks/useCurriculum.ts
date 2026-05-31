import { useQuery } from "@tanstack/react-query";

import { getCurriculum } from "@/lib/api";

export function useCurriculum() {
  return useQuery({
    queryKey: ["curriculum"],
    queryFn: getCurriculum,
    retry: 1,
    staleTime: 5 * 60 * 1000,
  });
}
