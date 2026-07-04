import type { QueryClient } from "@tanstack/react-query";

import { lessonQueryKey } from "@/hooks/useLesson";
import { generateLesson } from "@/lib/api";
import type { ApiRecord, LessonRoadmapItem } from "@/types/api";

export type LessonBrief = {
  topic: string;
  education_level: string;
  familiarity_level: string;
  pace: string;
  learning_style: string;
  availability: string;
  accessibility_support: boolean;
};

export function makeInitialBrief(
  user: {
    learningTopic?: string;
    educationLevel?: string;
    topicFamiliarity?: string;
    pacePreference?: string;
    preferredModality?: string;
    learningAvailability?: string;
    accessibilitySupport?: boolean;
  } | null | undefined,
  topicOverride?: string,
): LessonBrief {
  return {
    topic: topicOverride?.trim() || (user?.learningTopic ?? ""),
    education_level: user?.educationLevel || "Undergraduate",
    familiarity_level: user?.topicFamiliarity || "beginner",
    pace: user?.pacePreference || "balanced",
    learning_style: user?.preferredModality || "reading",
    availability: user?.learningAvailability || "30_min",
    accessibility_support: Boolean(user?.accessibilitySupport),
  };
}

export function constraintsFromBrief(brief: LessonBrief): ApiRecord {
  return {
    education_level: toEducationLabel(brief.education_level),
    familiarity_level: toFamiliarityLabel(brief.familiarity_level),
    pace: toPaceLabel(brief.pace),
    learning_style: toLearningStyleLabel(brief.learning_style),
    availability: toAvailabilityLabel(brief.availability),
    accessibility: {
      additional_support: brief.accessibility_support,
      dyslexia_support: brief.accessibility_support,
      chunked_explanations: brief.accessibility_support,
      readable_spacing: brief.accessibility_support,
      symbolic_math_required: isMathTopic(brief.topic),
      focus_mode_available: true,
    },
  };
}

export function roadmapItemToRecord(item: LessonRoadmapItem): ApiRecord {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    difficulty: item.difficulty,
    estimated_duration: item.estimated_duration,
    objectives: item.objectives,
  };
}

export function prefetchRoadmapLessons(queryClient: QueryClient, learnerId: string, brief: LessonBrief, lessons: LessonRoadmapItem[]) {
  const seen = new Set<string>();
  return Promise.allSettled(
    lessons
      .filter((lesson) => {
        if (seen.has(lesson.id)) return false;
        seen.add(lesson.id);
        return true;
      })
      .map((lesson) => {
        const request = {
          learner_id: learnerId,
          topic: brief.topic,
          selected_lesson: roadmapItemToRecord(lesson),
          constraints: constraintsFromBrief(brief),
        };
        return queryClient.prefetchQuery({
          queryKey: lessonQueryKey(request),
          queryFn: () => generateLesson(request),
          staleTime: 5 * 60 * 1000,
        });
      }),
  );
}

function toEducationLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "school") return "School";
  if (normalized === "postgraduate") return "Postgraduate";
  if (normalized.includes("professional") || normalized.includes("independent")) return "Professional or independent learner";
  return "Undergraduate";
}

function toFamiliarityLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "intermediate") return "Intermediate";
  if (normalized === "advanced") return "Advanced";
  return "Beginner";
}

function toPaceLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "gentle") return "Gentle and Thorough";
  if (normalized === "fast") return "Fast and Challenging";
  return "Balanced";
}

function toLearningStyleLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "visual") return "Visual Examples and Diagrams";
  if (normalized === "audio") return "Audio Learning";
  if (normalized === "reading" || normalized === "written") return "Detailed Written Explanations";
  return "Detailed Written Explanations";
}

function toAvailabilityLabel(value?: string) {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "60_min" || normalized === "1 hr/day") return "1 hr/day";
  if (normalized === "120_min" || normalized === "2 hr/day") return "2 hr/day";
  return "30 min/day";
}

function isMathTopic(topic: string) {
  return /\b(calculus|algebra|vector|matrix|matrices|eigen|derivative|gradient|hessian|limit|projection|norm)\b/i.test(topic);
}
