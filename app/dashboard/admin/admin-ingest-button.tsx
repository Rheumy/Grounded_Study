"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type IngestResult =
  | { ok: true; message: string }
  | { ok: true; jobId: string }
  | { ok: false; error: string; jobId?: string };

export function AdminIngestButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const run = async () => {
    setLoading(true);
    setResult(null);
    setIsError(false);

    try {
      const response = await fetch("/api/admin/process-jobs", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as IngestResult;

      if (!response.ok || !body.ok) {
        const msg = "error" in body ? body.error : "Ingestion failed";
        setResult(msg);
        setIsError(true);
      } else if ("message" in body) {
        setResult(body.message);
      } else {
        setResult(`Job processed: ${body.jobId}`);
      }
    } catch {
      setResult("Request failed. Check the console.");
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={run} disabled={loading}>
        {loading ? "Processing..." : "Run ingestion job"}
      </Button>
      {result ? (
        <p className={`text-xs ${isError ? "text-danger" : "text-ink/60"}`}>{result}</p>
      ) : null}
    </div>
  );
}
