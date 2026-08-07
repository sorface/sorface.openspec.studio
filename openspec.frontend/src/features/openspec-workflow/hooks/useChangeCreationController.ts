"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiError } from "@/features/api/api-client";
import {
  deleteChangeCreationDraft,
  getChangeCreationDraft,
  saveChangeCreationDraft,
} from "@/features/openspec-workflow/api/openspec-client";
import {
  applyExplorationResult,
  buildCreationHandoff,
  emptyChangeCreationDraft,
  invalidateCreationResearch,
  isValidChangeName,
} from "@/features/openspec-workflow/model/change-creation-state";
import type {
  ChangeCreationDraft,
  OpenSpecExplorationResult,
} from "@/features/openspec-workflow/model/openspec-types";

export interface ChangeCreationController {
  draft: ChangeCreationDraft;
  loading: boolean;
  saving: boolean;
  error: Error | ApiError | null;
  nameValid: boolean;
  setIntent: (intent: string) => void;
  setAnswer: (questionId: string, values: string[]) => void;
  setProposal: (proposal: string) => void;
  setFeedback: (feedback: string) => void;
  acceptProposal: () => void;
  setChangeName: (name: string) => void;
  markIntent: () => void;
  markClarifying: () => void;
  markCreating: () => void;
  applyExploration: (result: OpenSpecExplorationResult) => void;
  handoff: (withAssumptions?: boolean) => string;
  reset: () => Promise<void>;
  complete: () => Promise<void>;
}

export function useChangeCreationController(projectId?: string): ChangeCreationController {
  const [draft, setDraft] = useState<ChangeCreationDraft>(() => emptyChangeCreationDraft());
  const [loading, setLoading] = useState(!!projectId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | ApiError | null>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    hydrated.current = false;
    if (!projectId) {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (cancelled) return;
        setDraft(emptyChangeCreationDraft());
        setLoading(false);
      });
      return () => { cancelled = true; };
    }
    const abort = new AbortController();
    void Promise.resolve()
      .then(() => {
        if (abort.signal.aborted) return undefined;
        setLoading(true);
        return getChangeCreationDraft(projectId, abort.signal);
      })
      .then((loaded) => {
        if (abort.signal.aborted || loaded === undefined) return;
        setDraft(loaded ?? emptyChangeCreationDraft());
        setError(null);
        hydrated.current = true;
      })
      .catch((cause) => {
        if (!abort.signal.aborted) setError(cause as Error);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [projectId]);

  useEffect(() => {
    if (!projectId || !hydrated.current || (!draft.intent.trim() && !draft.proposal)) return;
    const timer = window.setTimeout(() => {
      setSaving(true);
      saveChangeCreationDraft(projectId, draft)
        .then(() => setError(null))
        .catch((cause) => setError(cause as Error))
        .finally(() => setSaving(false));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [draft, projectId]);

  const update = useCallback((recipe: (current: ChangeCreationDraft) => ChangeCreationDraft) => {
    setDraft((current) => recipe(current));
  }, []);

  const setIntent = useCallback((intent: string) => {
    update((current) => invalidateCreationResearch(current, intent));
  }, [update]);

  const setAnswer = useCallback((questionId: string, values: string[]) => {
    update((current) => ({ ...current, answers: { ...current.answers, [questionId]: values } }));
  }, [update]);

  const setProposal = useCallback((proposal: string) => {
    update((current) => ({ ...current, proposal, proposalAccepted: false }));
  }, [update]);

  const setFeedback = useCallback((feedback: string) => {
    update((current) => ({ ...current, feedback }));
  }, [update]);

  const acceptProposal = useCallback(() => {
    update((current) => ({ ...current, stage: "naming", proposalAccepted: true, feedback: "" }));
  }, [update]);

  const setChangeName = useCallback((name: string) => {
    const normalized = name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-");
    update((current) => ({ ...current, changeName: normalized }));
  }, [update]);

  const markIntent = useCallback(() => {
    update((current) => ({ ...current, stage: "intent" }));
  }, [update]);

  const markClarifying = useCallback(() => {
    update((current) => ({ ...current, stage: "clarifying" }));
  }, [update]);

  const markCreating = useCallback(() => {
    update((current) => ({ ...current, stage: "creating" }));
  }, [update]);

  const applyExploration = useCallback((result: OpenSpecExplorationResult) => {
    update((current) => applyExplorationResult(current, result));
  }, [update]);

  const handoff = useCallback((withAssumptions = false) => (
    buildCreationHandoff(draft, withAssumptions)
  ), [draft]);

  const reset = useCallback(async () => {
    if (projectId) await deleteChangeCreationDraft(projectId);
    setDraft(emptyChangeCreationDraft());
    setError(null);
    hydrated.current = true;
  }, [projectId]);

  const complete = useCallback(async () => {
    if (projectId) await deleteChangeCreationDraft(projectId);
    setDraft(emptyChangeCreationDraft());
    setError(null);
    hydrated.current = true;
  }, [projectId]);

  return useMemo(() => ({
    draft,
    loading,
    saving,
    error,
    nameValid: isValidChangeName(draft.changeName ?? ""),
    setIntent,
    setAnswer,
    setProposal,
    setFeedback,
    acceptProposal,
    setChangeName,
    markIntent,
    markClarifying,
    markCreating,
    applyExploration,
    handoff,
    reset,
    complete,
  }), [
    acceptProposal, applyExploration, complete, draft, error, handoff, loading,
    markClarifying, markCreating, markIntent, reset, saving, setAnswer, setChangeName, setFeedback,
    setIntent, setProposal,
  ]);
}
