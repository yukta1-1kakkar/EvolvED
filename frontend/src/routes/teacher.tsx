import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowDownUp, Check, Clipboard, FileText, Loader2, Plus, Search, ShieldCheck, Upload, Users, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { createClass, decideContentDraft, getTeacherDashboard, uploadContentDraft, type ContentDraft, type TeacherStudentSummary } from "@/lib/api/classroom";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/teacher")({
  head: () => ({
    meta: [
      { title: "Module Leader - EvolvED" },
      { name: "description", content: "Classroom, approval, ranking, and learner analytics for module leaders." },
    ],
  }),
  component: TeacherDashboard,
});

type SortKey = "name" | "rank" | "progress" | "average_score" | "last_active";
type FilterKey = "all" | "completed" | "in_progress" | "needs_help";

function TeacherDashboard() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("rank");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [className, setClassName] = useState("");
  const [draftKind, setDraftKind] = useState<"lesson" | "assessment">("lesson");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftClassId, setDraftClassId] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [copiedClassId, setCopiedClassId] = useState("");
  const copyResetRef = useRef<number | undefined>(undefined);
  const dashboard = useQuery({
    queryKey: ["teacher-dashboard", currentUser?.id],
    queryFn: () => getTeacherDashboard(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id && currentUser.role === "module_leader"),
  });
  const addClass = useMutation({
    mutationFn: () => createClass(currentUser?.id ?? "", className.trim()),
    onSuccess: async () => {
      setClassName("");
      await queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", currentUser?.id] });
    },
  });
  const uploadDraft = useMutation({
    mutationFn: () => uploadContentDraft({
      leaderId: currentUser?.id ?? "",
      kind: draftKind,
      title: draftTitle.trim(),
      classId: draftClassId || undefined,
      notes: draftNotes,
      file: draftFile,
    }),
    onSuccess: async (draft) => {
      setDraftTitle("");
      setDraftNotes("");
      setDraftFile(null);
      setSelectedDraftId(draft.draft_id);
      await queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", currentUser?.id] });
    },
  });
  const decideDraft = useMutation({
    mutationFn: (decision: "accept" | "reject" | "request_changes") => decideContentDraft(selectedDraft?.draft_id ?? "", currentUser?.id ?? "", decision, instructions),
    onSuccess: async (draft) => {
      setInstructions("");
      setSelectedDraftId(draft.draft_id);
      await queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", currentUser?.id] });
    },
  });

  const students = useMemo(
    () => filterStudents(dashboard.data?.students ?? [], search, sortBy, filter),
    [dashboard.data?.students, filter, search, sortBy],
  );
  const drafts = dashboard.data?.drafts ?? [];
  const selectedDraft = drafts.find((draft) => draft.draft_id === selectedDraftId) ?? drafts[0];

  useEffect(() => () => {
    if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
  }, []);

  const copyInviteLink = (classId: string, href: string) => {
    void navigator.clipboard?.writeText(href);
    setCopiedClassId(classId);
    if (copyResetRef.current) window.clearTimeout(copyResetRef.current);
    copyResetRef.current = window.setTimeout(() => setCopiedClassId(""), 1800);
  };

  if (currentUser?.role !== "module_leader") {
    return (
      <AppShell title="Teacher dashboard" subtitle="Module leader access is required." accent="Protected">
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with a module leader account to manage classes, approvals, and classroom analytics.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Module leader dashboard" subtitle="Classes, approvals, learner analytics, and ranking in one teaching workspace." accent={dashboard.isFetching ? "Syncing" : "Live"}>
      {dashboard.isError && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {dashboard.error.message}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-3 xl:grid-cols-6">
        {dashboard.isLoading ? (
          Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <Stat label="Total students" value={dashboard.data?.totals.total_students ?? 0} />
            <Stat label="Average progress" value={pct(dashboard.data?.totals.average_progress)} />
            <Stat label="Average score" value={pct(dashboard.data?.totals.average_assessment_score)} />
            <Stat label="Lessons published" value={dashboard.data?.totals.lessons_published ?? 0} />
            <Stat label="Lesson approvals" value={dashboard.data?.totals.pending_lesson_approvals ?? 0} />
            <Stat label="Assessment approvals" value={dashboard.data?.totals.pending_assessment_approvals ?? 0} />
          </>
        )}
      </div>

      <section className="mb-6 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Users className="size-4 text-plum" />
            <h2 className="font-display text-xl">Classes</h2>
          </div>
          <form
            className="mb-4 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (className.trim()) addClass.mutate();
            }}
          >
            <Input value={className} onChange={(event) => setClassName(event.target.value)} placeholder="Create class" className="h-10" />
            <Button type="submit" disabled={!className.trim() || addClass.isPending}>
              {addClass.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Add
            </Button>
          </form>
          <div className="space-y-3">
            {(dashboard.data?.classes ?? []).map((item) => (
              <div key={item.class_id} className="rounded-xl border border-border bg-background/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{item.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{item.student_count} students</div>
                  </div>
                  <span className="rounded-full bg-plum/10 px-2.5 py-1 text-xs text-plum">{item.active ? "Active" : "Inactive"}</span>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                  <Clipboard className="size-3.5" />
                  <span className="text-muted-foreground">Join code</span>
                  <strong className="ml-auto tracking-[0.2em]">{item.join_code}</strong>
                </div>
                <div className="mt-2 grid gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs sm:grid-cols-[1fr_auto] sm:items-center">
                  <span className="truncate text-muted-foreground">{inviteHref(item.invite_link, item.join_code)}</span>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded-md border border-border bg-background px-2.5 py-1 font-medium hover:bg-muted"
                    onClick={() => copyInviteLink(item.class_id, inviteHref(item.invite_link, item.join_code))}
                  >
                    {copiedClassId === item.class_id ? "Copied to clipboard" : "Copy link"}
                  </button>
                </div>
              </div>
            ))}
            {!dashboard.isLoading && (dashboard.data?.classes ?? []).length === 0 && (
              <div className="rounded-xl bg-muted/30 p-5 text-sm text-muted-foreground">Create a class to get a join code and invite link.</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="size-4 text-plum" />
            <h2 className="font-display text-xl">Approval workflow</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <WorkflowStep title="Upload" detail="PDF, PPT, DOCX, Markdown, or text source is attached to a draft." />
            <WorkflowStep title="Preview" detail="AI output remains private while the module leader reviews it." />
            <WorkflowStep title="Publish" detail="Accepted lessons personalize per student; assessments stay identical." />
          </div>
        </div>
      </section>

      <section className="mb-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Upload className="size-4 text-plum" />
            <h2 className="font-display text-xl">Content upload</h2>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (draftTitle.trim() && (draftFile || draftNotes.trim())) uploadDraft.mutate();
            }}
          >
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-background/60 p-1">
              {(["lesson", "assessment"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setDraftKind(kind)}
                  className={`rounded-lg px-3 py-2 text-sm capitalize transition-colors ${draftKind === kind ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}
                >
                  {kind}
                </button>
              ))}
            </div>
            <Input value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} placeholder="Draft title" className="h-10" />
            <select value={draftClassId} onChange={(event) => setDraftClassId(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
              <option value="">No class selected</option>
              {(dashboard.data?.classes ?? []).map((item) => <option key={item.class_id} value={item.class_id}>{item.name}</option>)}
            </select>
            <label className="block rounded-xl border border-dashed border-border bg-background/60 p-4 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground"><FileText className="size-4" /> PDF, PPTX, DOCX, Markdown, or text</span>
              <span className="mt-3 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center justify-center rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background shadow-sm hover:opacity-90">
                  Choose file
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{draftFile?.name ?? "No file chosen"}</span>
              </span>
              <input
                type="file"
                accept=".pdf,.pptx,.docx,.md,.markdown,.txt"
                className="sr-only"
                onChange={(event) => setDraftFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <textarea
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="Optional pasted source text or teacher notes"
              className="min-h-28 w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button type="submit" className="w-full" disabled={uploadDraft.isPending || !draftTitle.trim() || (!draftFile && !draftNotes.trim())}>
              {uploadDraft.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              Generate draft preview
            </Button>
            {uploadDraft.isError && <p className="text-sm text-destructive">{uploadDraft.error.message}</p>}
          </form>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="size-4 text-plum" />
            <h2 className="font-display text-xl">Draft preview and approval</h2>
          </div>
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {drafts.map((draft) => (
              <button
                key={draft.draft_id}
                type="button"
                onClick={() => setSelectedDraftId(draft.draft_id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${selectedDraft?.draft_id === draft.draft_id ? "border-plum bg-plum/10 text-plum" : "border-border text-muted-foreground"}`}
              >
                {draft.kind}: {draft.title}
              </button>
            ))}
          </div>
          {selectedDraft ? (
            <DraftPreview
              draft={selectedDraft}
              instructions={instructions}
              setInstructions={setInstructions}
              onDecision={(decision) => decideDraft.mutate(decision)}
              deciding={decideDraft.isPending}
              error={decideDraft.isError ? decideDraft.error.message : undefined}
            />
          ) : (
            <div className="grid min-h-72 place-items-center rounded-xl bg-muted/30 px-4 text-center text-sm text-muted-foreground">
              Upload source material to create the first lesson or assessment draft.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Student list</div>
            <h2 className="mt-1 font-display text-xl">Class analytics</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search students" className="h-10 w-56 pl-9" />
            </div>
            <select value={sortBy} onChange={(event) => setSortBy(event.target.value as SortKey)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="rank">Rank</option>
              <option value="name">Name</option>
              <option value="progress">Progress</option>
              <option value="average_score">Average score</option>
              <option value="last_active">Last active</option>
            </select>
            <select value={filter} onChange={(event) => setFilter(event.target.value as FilterKey)} className="h-10 rounded-md border border-input bg-background px-3 text-sm">
              <option value="all">All</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In progress</option>
              <option value="needs_help">Needs help</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                {["Name", "Progress", "Current lesson", "Average score", "Rank", "Accessibility", "Last active"].map((heading) => (
                  <th key={heading} className="py-3 pr-4 font-medium">
                    <span className="inline-flex items-center gap-1">{heading}<ArrowDownUp className="size-3" /></span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.learner_id} className="border-b border-border/60">
                  <td className="py-3 pr-4 font-medium">{student.name}</td>
                  <td className="py-3 pr-4">{pct(student.progress)}</td>
                  <td className="max-w-56 truncate py-3 pr-4 text-muted-foreground">{student.current_lesson}</td>
                  <td className="py-3 pr-4">{pct(student.average_score)}</td>
                  <td className="py-3 pr-4">#{student.rank || "-"}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{accessibilityLabel(student.accessibility_settings)}</td>
                  <td className="py-3 pr-4 text-muted-foreground">{formatDate(student.last_active)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!dashboard.isLoading && students.length === 0 && (
          <div className="grid min-h-32 place-items-center rounded-xl bg-muted/30 text-sm text-muted-foreground">
            No students match the current search and filters.
          </div>
        )}
      </section>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-2xl">{value}</div>
    </div>
  );
}

function WorkflowStep({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-4">
      <div className="font-medium">{title}</div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}

function inviteHref(path: string, joinCode: string) {
  const relative = path.startsWith("/join-class") ? path : `/join-class?code=${encodeURIComponent(joinCode)}`;
  return typeof window === "undefined" ? relative : new URL(relative, window.location.origin).toString();
}

function DraftPreview({
  draft,
  instructions,
  setInstructions,
  onDecision,
  deciding,
  error,
}: {
  draft: ContentDraft;
  instructions: string;
  setInstructions: (value: string) => void;
  onDecision: (decision: "accept" | "reject" | "request_changes") => void;
  deciding: boolean;
  error?: string;
}) {
  const content = draft.generated_content;
  const statusTone = draft.status === "accepted" ? "bg-emerald-500/10 text-emerald-700" : draft.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-gold/10 text-gold";
  const summary = textValue(content.summary) || textValue(content.fairness);
  const unreadableSource = Boolean(content.needs_readable_source) || isUnreadableSourceText(summary) || arrayValue(content.learning_objectives).some((item) => isUnreadableSourceText(String(item)));
  const sections = unreadableSource ? [] : arrayValue(content.sections);
  const questions = unreadableSource ? [] : arrayValue(content.questions);
  const readableMessage = "This upload was not converted into readable teaching text. Upload a text-based PDF, DOCX, PPTX, Markdown, or paste OCR text in the notes box.";
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background/70 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs capitalize ${statusTone}`}>{draft.status.replaceAll("_", " ")}</span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize text-muted-foreground">{draft.kind}</span>
          {typeof draft.source_material.filename === "string" && <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{draft.source_material.filename}</span>}
        </div>
        <h3 className="font-display text-2xl">{draft.title}</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{unreadableSource ? readableMessage : summary || "Generated from uploaded source material."}</p>
        {unreadableSource && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            EvolvED blocked this preview because the extracted text contains PDF metadata instead of readable lesson content.
          </div>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Mini label="Duration" value={`${numberValue(content.estimated_duration)} min`} />
          <Mini label="Difficulty" value={unreadableSource ? "Needs readable source" : textValue(content.difficulty) || "Draft"} />
          <Mini label="Source chars" value={String(numberValue(draft.source_material.characters))} />
        </div>
      </div>

      {!unreadableSource && draft.kind === "lesson" && (
        <>
          <Panel title="Learning objectives" items={arrayValue(content.learning_objectives).map(String)} />
          <div className="grid gap-3">
            {sections.map((section, index) => {
              const record = recordValue(section);
              return (
                <article key={index} className="rounded-xl border border-border bg-background/70 p-4">
                  <h4 className="font-medium">{textValue(record.title) || `Section ${index + 1}`}</h4>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{textValue(record.summary)}</p>
                  <Panel title="Subsections" items={arrayValue(record.subsections).map(String)} compact />
                </article>
              );
            })}
          </div>
          <Panel title="Flowchart" items={arrayValue(recordValue(arrayValue(content.flowcharts)[0]).steps).map(String)} />
        </>
      )}

      {!unreadableSource && draft.kind === "assessment" && (
        <div className="space-y-3">
          {questions.map((question, index) => {
            const record = recordValue(question);
            return (
              <article key={index} className="rounded-xl border border-border bg-background/70 p-4">
                <div className="mb-2 flex gap-2 text-xs text-muted-foreground">
                  <span>{textValue(record.type) || "question"}</span>
                  <span>{textValue(record.bloom_level) || "understand"}</span>
                </div>
                <h4 className="font-medium">{textValue(record.question)}</h4>
                <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                  {arrayValue(record.options).map((option, optionIndex) => <li key={optionIndex}>{String(option)}</li>)}
                </ol>
              </article>
            );
          })}
        </div>
      )}

      <textarea
        value={instructions}
        onChange={(event) => setInstructions(event.target.value)}
        placeholder={draft.kind === "lesson" ? "Update box: e.g. simplify section 2, add one example, regenerate diagram prompt" : "Update box: e.g. replace question 3, add more MCQs, increase Bloom level"}
        className="min-h-24 w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => onDecision("accept")} disabled={deciding || draft.status === "accepted" || unreadableSource}>
          {deciding ? <Loader2 className="animate-spin" /> : <Check />}
          Accept and publish
        </Button>
        <Button type="button" variant="outline" onClick={() => onDecision("request_changes")} disabled={deciding || !instructions.trim()}>
          Request changes
        </Button>
        <Button type="button" variant="outline" onClick={() => onDecision("reject")} disabled={deciding}>
          <X />
          Reject and regenerate
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value || "-"}</div>
    </div>
  );
}

function Panel({ title, items, compact = false }: { title: string; items: string[]; compact?: boolean }) {
  if (!items.length) return null;
  return (
    <div className={compact ? "mt-3" : "rounded-xl border border-border bg-background/70 p-4"}>
      <div className="mb-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{title}</div>
      <ul className="space-y-1 text-sm text-muted-foreground">
        {items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
      </ul>
    </div>
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isUnreadableSourceText(value: string) {
  const text = value.trim();
  if (!text) return false;
  const lower = text.toLowerCase();
  const pdfMarkers = [" obj", " endobj", " xref", " trailer", " linearized", " startxref"].filter((marker) => lower.includes(marker)).length;
  const digitRatio = [...text].filter((char) => /\d/.test(char)).length / Math.max(1, text.length);
  const alphaRatio = [...text].filter((char) => /[a-z]/i.test(char)).length / Math.max(1, text.length);
  const words = lower.match(/[a-z][a-z-]{2,}/g) ?? [];
  return text.startsWith("PDF-") || pdfMarkers >= 2 || (digitRatio > 0.28 && alphaRatio < 0.45) || englishSignal(words) < 0.04;
}

function englishSignal(words: string[]) {
  if (words.length < 80) return 1;
  const common = new Set([
    "the", "of", "and", "to", "in", "for", "is", "are", "as", "with", "from", "by", "on", "that", "this", "it",
    "be", "or", "an", "has", "have", "was", "were", "can", "will", "should", "chapter", "image", "images",
    "imaging", "medical", "digital", "system", "systems", "data", "learning", "artificial", "intelligence",
    "technology", "technologies", "development", "healthcare", "source", "content", "analysis", "process",
    "use", "used", "using", "between", "into", "these", "their", "which", "such", "more", "also",
  ]);
  return words.filter((word) => common.has(word)).length / Math.max(1, words.length);
}

function filterStudents(students: TeacherStudentSummary[], search: string, sortBy: SortKey, filter: FilterKey) {
  const query = search.trim().toLowerCase();
  return students
    .filter((student) => filter === "all" || student.status === filter)
    .filter((student) => !query || student.name.toLowerCase().includes(query) || student.current_lesson.toLowerCase().includes(query))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "last_active") return safeTime(b.last_active) - safeTime(a.last_active);
      if (sortBy === "rank") return Number(a.rank || 9999) - Number(b.rank || 9999);
      return Number(b[sortBy] ?? 0) - Number(a[sortBy] ?? 0);
    });
}

function pct(value?: number) {
  return `${Math.round((value ?? 0) * 100)}%`;
}

function formatDate(value?: string | null) {
  if (!value) return "No activity";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "No activity" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function safeTime(value?: string | null) {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}

function accessibilityLabel(settings: Record<string, unknown>) {
  const enabled = Object.entries(settings).filter(([, value]) => Boolean(value)).map(([key]) => key.replaceAll("_", " "));
  return enabled.length ? enabled.slice(0, 2).join(", ") : "Default";
}
