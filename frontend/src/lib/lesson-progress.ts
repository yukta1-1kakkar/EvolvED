import type { LessonRoadmapItem } from "@/types/api";

const ACTIVE_ROADMAP_LESSON_KEY = "evolved.activeRoadmapLesson";
const LESSON_CONTEXT_STORAGE_KEY = "evolved.pendingLessonContext";
const NEXT_ROADMAP_LESSON_CONTEXT_KEY = "evolved.nextRoadmapLessonContext";

type ActiveRoadmapLesson = {
  learnerId: string;
  topic: string;
  lessonId: string;
  lessonIndex?: number;
  lesson?: LessonRoadmapItem;
};

export function getCompletedRoadmapLessons(learnerId?: string, topic?: string): Set<string> {
  if (typeof window === "undefined" || !learnerId || !topic) return new Set();

  try {
    const stored = JSON.parse(window.localStorage.getItem(completedKey(learnerId, topic)) ?? "[]");
    return new Set(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

export function getCompletedRoadmapLessonCount(learnerId?: string, topic?: string) {
  if (typeof window === "undefined" || !learnerId || !topic) return 0;
  const value = Number(window.localStorage.getItem(completedCountKey(learnerId, topic)) ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function getCompletedRoadmapLessonItems(learnerId?: string, topic?: string): LessonRoadmapItem[] {
  if (typeof window === "undefined" || !learnerId || !topic) return [];

  try {
    const stored = JSON.parse(window.localStorage.getItem(completedItemsKey(learnerId, topic)) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isRoadmapItem) : [];
  } catch {
    return [];
  }
}

export function setActiveRoadmapLesson(lesson: ActiveRoadmapLesson) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_ROADMAP_LESSON_KEY, JSON.stringify(lesson));
}

export function setNextRoadmapLessonContext(context: unknown | null) {
  if (typeof window === "undefined") return;
  if (context) {
    window.localStorage.setItem(NEXT_ROADMAP_LESSON_CONTEXT_KEY, JSON.stringify(context));
  } else {
    window.localStorage.removeItem(NEXT_ROADMAP_LESSON_CONTEXT_KEY);
  }
}

export function prepareNextRoadmapLessonContext() {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(NEXT_ROADMAP_LESSON_CONTEXT_KEY);
  if (!raw) return false;
  window.sessionStorage.setItem(LESSON_CONTEXT_STORAGE_KEY, raw);
  try {
    const current = JSON.parse(raw) as {
      brief?: unknown;
      lessonIndex?: number;
      remainingLessons?: unknown[];
    };
    const [nextLesson, ...remainingLessons] = Array.isArray(current.remainingLessons) ? current.remainingLessons : [];
    if (nextLesson) {
      window.localStorage.setItem(
        NEXT_ROADMAP_LESSON_CONTEXT_KEY,
        JSON.stringify({ brief: current.brief, selectedLesson: nextLesson, lessonIndex: (current.lessonIndex ?? 0) + 1, remainingLessons }),
      );
    } else {
      window.localStorage.removeItem(NEXT_ROADMAP_LESSON_CONTEXT_KEY);
    }
  } catch {
    window.localStorage.removeItem(NEXT_ROADMAP_LESSON_CONTEXT_KEY);
  }
  return true;
}

export function completeActiveRoadmapLesson(learnerId: string) {
  if (typeof window === "undefined") return;

  try {
    const active = JSON.parse(window.localStorage.getItem(ACTIVE_ROADMAP_LESSON_KEY) ?? "null") as ActiveRoadmapLesson | null;
    if (!active || active.learnerId !== learnerId || !active.topic || !active.lessonId) return;

    const completed = getCompletedRoadmapLessons(active.learnerId, active.topic);
    completed.add(active.lessonId);
    window.localStorage.setItem(completedKey(active.learnerId, active.topic), JSON.stringify([...completed]));
    const completedCount = Math.max(
      getCompletedRoadmapLessonCount(active.learnerId, active.topic),
      (active.lessonIndex ?? completed.size - 1) + 1,
    );
    window.localStorage.setItem(completedCountKey(active.learnerId, active.topic), String(completedCount));
    if (active.lesson && active.lessonIndex !== undefined) {
      const items = getCompletedRoadmapLessonItems(active.learnerId, active.topic);
      items[active.lessonIndex] = active.lesson;
      window.localStorage.setItem(completedItemsKey(active.learnerId, active.topic), JSON.stringify(items.filter(Boolean)));
    }
  } catch {
    // Ignore stale local progress metadata; backend assessment persistence is the source of truth for scores.
  }
}

function completedKey(learnerId: string, topic: string) {
  return `evolved.completedRoadmapLessons:${learnerId}:${encodeURIComponent(topic.trim().toLowerCase())}`;
}

function completedCountKey(learnerId: string, topic: string) {
  return `evolved.completedRoadmapLessonCount:${learnerId}:${encodeURIComponent(topic.trim().toLowerCase())}`;
}

function completedItemsKey(learnerId: string, topic: string) {
  return `evolved.completedRoadmapLessonItems:${learnerId}:${encodeURIComponent(topic.trim().toLowerCase())}`;
}

function isRoadmapItem(value: unknown): value is LessonRoadmapItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<LessonRoadmapItem>;
  return Boolean(item.id && item.title && item.description && item.difficulty && item.estimated_duration && Array.isArray(item.objectives));
}
