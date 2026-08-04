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
        <LogoMark />
        <div className="project-loading-copy">
          <strong>OpenSpec</strong>
          <span>Studio</span>
        </div>
      </div>
    </div>
  );
}
