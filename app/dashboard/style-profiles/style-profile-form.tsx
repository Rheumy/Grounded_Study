"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function StyleProfileForm() {
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setStatus(null);

    const formEl = event.currentTarget;
    const examplesVal = (formEl.elements.namedItem("examplesText") as HTMLTextAreaElement).value.trim();
    const instructionsVal = (formEl.elements.namedItem("instructionsText") as HTMLTextAreaElement).value.trim();
    const fileInput = formEl.elements.namedItem("sampleFile") as HTMLInputElement;
    const hasFiles = fileInput.files && fileInput.files.length > 0;

    if (!examplesVal && !instructionsVal && !hasFiles) {
      setError(
        "Please provide at least one input: paste sample questions, upload a file, or add instructions."
      );
      return;
    }

    setLoading(true);
    const form = new FormData(formEl);

    const response = await fetch("/api/style-profiles", {
      method: "POST",
      body: form
    });

    setLoading(false);

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError(body.error ?? "Failed to save question format");
      return;
    }

    formEl.reset();
    setStatus("Saved. You can now choose this format when generating questions.");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="rounded-2xl border border-ink/10 bg-ink/[0.02] p-4">
        <p className="text-sm font-medium text-ink">Build a clearer question format</p>
        <p className="mt-1 text-sm text-ink/65">
          Add whatever you have: pasted examples, files, or plain-English instructions. Clearer
          examples usually lead to better question style and better feedback.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">Format name</span>
          <Input name="name" placeholder="e.g. Clinical short-answer revision" required />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">Exam or course name</span>
          <Input name="courseName" placeholder="e.g. Year 2 anatomy final" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">Institution or board</span>
          <Input name="institution" placeholder="e.g. University of Melbourne" />
        </label>
        <label className="space-y-2">
          <span className="text-sm font-medium text-ink">Country or region</span>
          <Input name="countryRegion" placeholder="e.g. Australia" />
        </label>
        <label className="space-y-2 md:col-span-2">
          <span className="text-sm font-medium text-ink">Candidate level or training stage</span>
          <Input name="candidateLevel" placeholder="e.g. Final-year medical student" />
        </label>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-5">
          <div className="space-y-2 rounded-2xl border border-ink/10 bg-white p-4">
            <label className="text-sm font-medium text-ink">
              Paste sample questions, model answers, or marking guides
            </label>
            <p className="text-xs text-ink/55">
              Include examples that show the wording, structure, and answer style you want. Marking
              guides and model answers make short-answer grading more reliable.
            </p>
            <Textarea
              name="examplesText"
              rows={8}
              placeholder="Paste sample questions here, for example:&#10;&#10;Q1. Explain the role of mitochondria in aerobic respiration.&#10;Model answer: Mitochondria generate ATP through aerobic respiration...&#10;Marking guide: 1 mark for ATP, 1 mark for aerobic respiration, 1 mark for reference to the cell."
            />
          </div>

          <div className="space-y-2 rounded-2xl border border-ink/10 bg-white p-4">
            <label className="text-sm font-medium text-ink">Instructions for tone, level, or focus</label>
            <p className="text-xs text-ink/55">
              Use this for any constraints not shown in the samples, such as exam level, topic
              emphasis, or preferred feedback style.
            </p>
            <Textarea
              name="instructionsText"
              rows={4}
              placeholder="e.g. Questions should match standard undergraduate engineering exams, prefer application over recall, and keep explanations clear and direct."
            />
          </div>
        </div>

        <div className="space-y-5">
          <div className="space-y-2 rounded-2xl border border-ink/10 bg-white p-4">
            <label className="text-sm font-medium text-ink">
              Upload sample files (optional)
            </label>
            <p className="text-xs text-ink/55">
              Upload past papers, marking guides, model answers, or rubrics as PDF, Word, or image
              files. File upload stays optional, but it can improve extraction quality.
            </p>
            <Input
              name="sampleFile"
              type="file"
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,image/*"
              multiple
            />
          </div>

          <div className="rounded-2xl border border-accent/20 bg-accentSoft/40 p-4">
            <p className="text-sm font-medium text-ink">For short-answer or essay-style formats</p>
            <p className="mt-1 text-sm text-ink/65">
              Feedback is strongest when you include marking guides, rubrics, or model answers.
              Without them, grading still works on a best-effort basis but may be less definitive.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={loading} className="shadow-sm">
          {loading ? "Analysing and saving..." : "Save question format"}
        </Button>
        {status ? <p className="text-sm text-ink/60">{status}</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>
    </form>
  );
}
