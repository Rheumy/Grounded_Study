"use client";

import { useEffect, useState } from "react";

const DEMO_INTERVAL_MS = 2200;
const FINAL_PHASE_INDEX = 3;

export function HomepageDemo() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncPreference = () => {
      const reduced = mediaQuery.matches;
      setPrefersReducedMotion(reduced);
      setPhaseIndex(reduced ? FINAL_PHASE_INDEX : 0);
    };

    syncPreference();
    mediaQuery.addEventListener("change", syncPreference);

    return () => mediaQuery.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) {
      return;
    }

    const interval = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % (FINAL_PHASE_INDEX + 1));
    }, DEMO_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [prefersReducedMotion]);

  const isQuestionPhase = phaseIndex === FINAL_PHASE_INDEX;
  const statusText =
    phaseIndex === 0
      ? "Uploading…"
      : phaseIndex === 1
        ? "Extracting and indexing…"
        : "Ready · 24 pages";

  return (
    <div
      className="rounded-3xl border border-ink/10 bg-fog p-5"
      aria-label="SULCAI upload and question demo"
    >
      <div className="mb-4 flex items-center justify-between text-xs font-medium uppercase tracking-[0.18em] text-ink/45">
        <span>Demo</span>
        <span>{isQuestionPhase ? "Question ready" : "Study material"}</span>
      </div>

      {isQuestionPhase ? (
        <div className="space-y-4 rounded-2xl border border-ink/10 bg-white p-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">
              Which valve abnormality most directly explains the murmur described in the lecture?
            </p>
            <div className="space-y-2 text-sm text-ink/70">
              {[
                "Aortic stenosis",
                "Mitral regurgitation",
                "Pulmonary stenosis",
                "Tricuspid regurgitation"
              ].map((option, index) => (
                <div
                  key={option}
                  className={`rounded-xl border px-3 py-2 ${
                    index === 1
                      ? "border-accent/30 bg-accentSoft text-ink"
                      : "border-ink/10 bg-fog"
                  }`}
                >
                  {option}
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-ink/55">Source: Cardiology lecture 04, p. 12</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-ink/10 bg-white p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-ink">Cardiology lecture 04.pdf</p>
              <p className="mt-1 text-xs text-ink/55">Imported study material</p>
            </div>
            <div className="rounded-xl border border-ink/10 px-2 py-1 text-xs text-ink/55">PDF</div>
          </div>
          <div className="rounded-2xl border border-dashed border-ink/15 bg-fog px-4 py-6 text-sm text-ink/70">
            {statusText}
          </div>
        </div>
      )}

      <div className="mt-4 flex gap-2">
        {Array.from({ length: FINAL_PHASE_INDEX + 1 }).map((_, index) => (
          <span
            key={index}
            className={`h-2 w-2 rounded-full ${
              index === phaseIndex ? "bg-accent" : "bg-ink/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
