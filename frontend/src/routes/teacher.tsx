import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check, FileText, Loader2, ShieldCheck, Upload, X } from "lucide-react";
import { useState } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideContentDraft, getTeacherDashboard, uploadContentDraft, type ContentDraft } from "@/lib/api/classroom";
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

function TeacherDashboard() {
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [draftKind, setDraftKind] = useState<"lesson" | "assessment">("lesson");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftClassId, setDraftClassId] = useState("");
  const [minimumPassPercent, setMinimumPassPercent] = useState(50);
  const [draftNotes, setDraftNotes] = useState("");
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [publicationNotice, setPublicationNotice] = useState("");
  const dashboard = useQuery({
    queryKey: ["teacher-dashboard", currentUser?.id],
    queryFn: () => getTeacherDashboard(currentUser?.id ?? ""),
    enabled: Boolean(currentUser?.id && currentUser.role === "module_leader"),
    refetchInterval: 3000,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
  const uploadDraft = useMutation({
    mutationFn: () => uploadContentDraft({
      leaderId: currentUser?.id ?? "",
      kind: draftKind,
      title: draftTitle.trim(),
      classId: draftClassId || undefined,
      minimumPassPercent,
      notes: draftNotes,
      file: draftFile,
    }),
    onSuccess: async (draft) => {
      setPublicationNotice("");
      setDraftTitle("");
      setMinimumPassPercent(50);
      setDraftNotes("");
      setDraftFile(null);
      setSelectedDraftId(draft.draft_id);
      await queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", currentUser?.id] });
    },
  });
  const decideDraft = useMutation({
    mutationFn: (decision: "accept" | "reject" | "request_changes") => decideContentDraft(
      selectedDraft?.draft_id ?? "",
      currentUser?.id ?? "",
      decision,
      decision === "request_changes" && !instructions.trim() ? "Please revise this draft and regenerate the preview." : instructions,
    ),
    onSuccess: async (draft) => {
      setInstructions("");
      setSelectedDraftId(draft.draft_id);
      setPublicationNotice(draft.status === "accepted" ? draft.publication_message ?? `${draft.kind === "lesson" ? "Lesson" : "Assessment"} published successfully.` : "");
      await queryClient.invalidateQueries({ queryKey: ["teacher-dashboard", currentUser?.id] });
    },
  });

  const drafts = dashboard.data?.drafts ?? [];
  const activeDrafts = drafts.filter((draft) => draft.status !== "rejected");
  const selectedDraft = activeDrafts.find((draft) => draft.draft_id === selectedDraftId) ?? activeDrafts[0];

  if (currentUser?.role !== "module_leader") {
    return (
      <AppShell title="Teacher dashboard" subtitle="Module leader access is required." accent="Protected">
        <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          Sign in with a module leader account to manage content drafts and approvals.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Module leader dashboard" subtitle="Content uploads, draft previews, and publishing approvals." accent={dashboard.isFetching ? "Syncing" : "Live"}>
      {dashboard.isError && (
        <div className="mb-6 rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {dashboard.error.message}
        </div>
      )}

      <section className="mb-6 grid gap-4">
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
              <option value="">Select a classroom</option>
              {(dashboard.data?.classes ?? []).map((item) => <option key={item.class_id} value={item.class_id}>{item.name}</option>)}
            </select>
            {draftKind === "assessment" && (
              <label className="block rounded-xl border border-border bg-background/60 p-3 text-sm">
                <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Minimum marks to pass</span>
                <div className="mt-2 flex items-center gap-3">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={minimumPassPercent}
                    onChange={(event) => setMinimumPassPercent(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                    className="h-10 max-w-32"
                  />
                  <span className="text-sm text-muted-foreground">% required to pass this assessment</span>
                </div>
              </label>
            )}
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
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setDraftFile(file);
                  if (file && !draftTitle.trim()) {
                    setDraftTitle(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
                  }
                }}
              />
            </label>
            <textarea
              value={draftNotes}
              onChange={(event) => setDraftNotes(event.target.value)}
              placeholder="Optional pasted source text or teacher notes"
              className="min-h-28 w-full rounded-xl border border-input bg-background/70 px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <Button type="submit" className="w-full" disabled={uploadDraft.isPending || !draftClassId || !draftTitle.trim() || (!draftFile && !draftNotes.trim())}>
              {uploadDraft.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
              {uploadDraft.isPending ? "Generating draft preview…" : "Generate draft preview"}
            </Button>
            {uploadDraft.isPending && (
              <p className="text-sm text-muted-foreground" role="status">
                EvolvED is reading the source and building a source-grounded, adaptive teaching sequence. This usually takes under a minute.
              </p>
            )}
            {uploadDraft.isError && <p className="text-sm text-destructive">{uploadDraft.error.message}</p>}
          </form>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="size-4 text-plum" />
            <h2 className="font-display text-xl">Draft preview and approval</h2>
          </div>
          {selectedDraft ? (
            <DraftPreview
              draft={selectedDraft}
              instructions={instructions}
              setInstructions={setInstructions}
              onDecision={(decision) => decideDraft.mutate(decision)}
              deciding={decideDraft.isPending}
              error={decideDraft.isError ? decideDraft.error.message : undefined}
              success={publicationNotice}
            />
          ) : (
            <div className="grid min-h-72 place-items-center rounded-xl bg-muted/30 px-4 text-center text-sm text-muted-foreground">
              Upload source material to create the first lesson or assessment draft.
            </div>
          )}
        </div>
      </section>

    </AppShell>
  );
}

function DraftPreview({
  draft,
  instructions,
  setInstructions,
  onDecision,
  deciding,
  error,
  success,
}: {
  draft: ContentDraft;
  instructions: string;
  setInstructions: (value: string) => void;
  onDecision: (decision: "accept" | "reject" | "request_changes") => void;
  deciding: boolean;
  error?: string;
  success?: string;
}) {
  const content = draft.generated_content;
  const generation = recordValue(content.generation);
  const statusTone = draft.status === "accepted" ? "bg-emerald-500/10 text-emerald-700" : draft.status === "rejected" ? "bg-destructive/10 text-destructive" : "bg-gold/10 text-gold";
  const summary = textValue(content.summary) || textValue(content.fairness);
  const unreadableSource = Boolean(content.needs_readable_source) || isUnreadableSourceText(summary) || arrayValue(content.learning_objectives).some((item) => isUnreadableSourceText(String(item)));
  const sections = unreadableSource ? [] : arrayValue(content.sections);
  const questions = unreadableSource ? [] : arrayValue(content.questions);
  const readableMessage = "This upload was not converted into readable teaching text. Upload a text-based PDF, DOCX, PPTX, Markdown, or paste OCR text in the notes box.";
  const finalDraft = draft.status === "accepted" || draft.status === "rejected";
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-background/70 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs capitalize ${statusTone}`}>{draft.status.replaceAll("_", " ")}</span>
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize text-muted-foreground">{draft.kind}</span>
          {textValue(generation.mode) === "primary_model" && <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-700">Primary AI generation passed</span>}
          {typeof draft.source_material.filename === "string" && <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{draft.source_material.filename}</span>}
        </div>
        <h3 className="font-display text-2xl">{textValue(content.title) || draft.title}</h3>
        {textValue(content.title) && textValue(content.title) !== draft.title && <p className="mt-1 text-xs text-muted-foreground">Draft label: {draft.title}</p>}
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{unreadableSource ? readableMessage : summary || "Generated from uploaded source material."}</p>
        {unreadableSource && (
          <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            EvolvED blocked this preview because the extracted text contains PDF metadata instead of readable lesson content.
          </div>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <Mini label="Duration" value={`${numberValue(content.estimated_duration)} min`} />
          {draft.kind === "assessment" && <Mini label="Pass mark" value={`${Math.round(numberValue(content.minimum_pass_percent) || numberValue(draft.source_material.minimum_pass_percent) || 50)}%`} />}
        </div>
      </div>

      {!unreadableSource && draft.kind === "lesson" && (
        <>
          <Panel title="What learners will be able to do" items={arrayValue(content.learning_objectives).map(String)} />
          <p className="rounded-xl border border-plum/20 bg-plum/5 p-3 text-sm text-muted-foreground">
            Adaptive delivery ready: each section includes guided, standard, concise, and spoken explanations selected from each student&apos;s pace and modality.
          </p>
          <div className="grid gap-3">
            {sections.map((section, index) => {
              const record = recordValue(section);
              return (
                <article key={index} className="rounded-xl border border-border bg-background/70 p-4">
                  <h4 className="font-medium">{textValue(record.title) || `Section ${index + 1}`}</h4>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{textValue(record.summary)}</p>
                  <Panel title="Key points" items={arrayValue(record.subsections).map(String)} compact />
                  <Panel title="Examples" items={arrayValue(record.examples).map(String)} compact />
                  <Panel title="Checks for understanding" items={arrayValue(record.checks_for_understanding).map(String)} compact />
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
                {arrayValue(record.options).length > 0 && (
                  <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
                    {arrayValue(record.options).map((option, optionIndex) => <li key={optionIndex}>{String(option)}</li>)}
                  </ol>
                )}
                {textValue(record.answer) && (
                  <div className="mt-3 rounded-lg bg-muted/40 p-3 text-sm">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Answer</div>
                    <p className="mt-1 text-muted-foreground">{textValue(record.answer)}</p>
                  </div>
                )}
                <Panel title="Rubric" items={arrayValue(record.rubric).map(String)} compact />
                {textValue(record.explanation) && <p className="mt-3 text-sm leading-6 text-muted-foreground">{textValue(record.explanation)}</p>}
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
        <Button type="button" onClick={() => onDecision("accept")} disabled={deciding || finalDraft || unreadableSource}>
          {deciding ? <Loader2 className="animate-spin" /> : <Check />}
          Accept and publish
        </Button>
        <Button type="button" variant="outline" onClick={() => onDecision("request_changes")} disabled={deciding || finalDraft}>
          Request changes
        </Button>
        <Button type="button" variant="outline" onClick={() => onDecision("reject")} disabled={deciding || finalDraft}>
          <X />
          Reject and regenerate
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="rounded-xl border border-emerald-600/25 bg-emerald-500/10 p-3 text-sm text-emerald-700" role="status">{success}</p>}
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
  return text.startsWith("PDF-") || pdfMarkers >= 2 || (digitRatio > 0.28 && alphaRatio < 0.45);
}
