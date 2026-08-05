"use client";

import { useEffect, useState } from "react";
import { LogoMark } from "@/components/ui/LogoMark";

export const PROJECT_LOADING_ANIMATION_MAX_MS = 1_600;
const PROJECT_LOADING_EXIT_MS = 320;

interface ProjectLoadingLandingProps {
  initializationComplete: boolean;
}

export function ProjectLoadingLanding({ initializationComplete }: ProjectLoadingLandingProps) {
  const [animationComplete, setAnimationComplete] = useState(false);
  const [phase, setPhase] = useState<"visible" | "exiting" | "hidden">("visible");

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAnimationComplete(true),
      PROJECT_LOADING_ANIMATION_MAX_MS,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!animationComplete || !initializationComplete || phase !== "visible") return;
    const timer = window.setTimeout(() => setPhase("exiting"), 0);
    return () => window.clearTimeout(timer);
  }, [animationComplete, initializationComplete, phase]);

  useEffect(() => {
    if (phase !== "exiting") return;
    const timer = window.setTimeout(() => setPhase("hidden"), PROJECT_LOADING_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      className={`project-loading-landing ${phase === "exiting" ? "exiting" : ""}`}
      role="status"
      aria-live="polite"
      aria-label="OpenSpec Studio загружается"
    >
      <div className="project-loading-brand">
        <div className="project-loading-flight" aria-hidden="true">
          <svg className="project-loading-swallow" viewBox="0 0 40 24">
            <path
              d="M3 10.1 7.2 13.3 3 16.9l7.7-2.8c3.5 1.5 7.3 2.3 11.4 2.2 3.2-.1 6.1-.8 8.8-2.2-2-1.8-4.4-3-7-3.6-4.1-.9-8.5-.6-13 .9L3 10.1Z"
            />
            <path
              d="M10.8 11.4C14.6 5.8 21.3 2.1 34.2.8c-3.7 5.6-8.6 9.3-15.3 11.3l-8.1-.7Z"
            />
            <path d="M11 14.1c4.7 4.5 10.6 6.8 18.4 7.2-2.6-3.8-6.2-6.2-11-7.5l-7.4.3Z" opacity=".78" />
          </svg>
        </div>
        <LogoMark />
        <div className="project-loading-copy">
          <strong>OpenSpec</strong>
          <span>Studio</span>
        </div>
      </div>
    </div>
  );
}
