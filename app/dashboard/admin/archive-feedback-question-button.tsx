"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ArchiveFeedbackQuestionButtonProps = {
  questionId: string;
};

export function ArchiveFeedbackQuestionButton({ questionId }: ArchiveFeedbackQuestionButtonProps) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);

  async function archiveQuestion() {
    setIsArchiving(true);
    setStatus(null);

    const response = await fetch("/api/admin/questions/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId,
        reason: "Archived from admin question feedback review."
      })
    });
    const body = await response.json().catch(() => ({} as { error?: string; message?: string }));

    if (!response.ok) {
      setStatus(body.error ?? "Unable to archive question.");
      setIsArchiving(false);
      return;
    }

    setStatus(body.message ?? "Question archived.");
    setIsArchiving(false);
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="danger"
        onClick={archiveQuestion}
        disabled={isArchiving}
      >
        Archive globally
      </Button>
      {status ? <span>{status}</span> : null}
    </span>
  );
}
