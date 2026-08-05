"use client";

import { ChangeCreationWizard } from "@/features/openspec-workflow/components/ChangeCreationWizard";
import { useChangeCreationController } from "@/features/openspec-workflow/hooks/useChangeCreationController";
import type { OpenSpecWorkflowController } from "@/features/openspec-workflow/hooks/useOpenSpecWorkflowController";

interface OpenSpecChangeCreationPageProps {
  controller: OpenSpecWorkflowController;
  projectId?: string;
  onClose: () => void;
  onChangeCreated: (proposalPath: string) => void;
}

export function OpenSpecChangeCreationPage({
  controller,
  projectId,
  onClose,
  onChangeCreated,
}: OpenSpecChangeCreationPageProps) {
  const creation = useChangeCreationController(projectId);

  if (controller.status === "idle") {
    return <section className="openspec-panel"><div className="openspec-state">Выберите проект для создания change.</div></section>;
  }
  if (controller.status === "loading") {
    return <section className="openspec-panel"><div className="openspec-state">Загрузка OpenSpec workflow…</div></section>;
  }
  if (controller.status === "unavailable") {
    return (
      <section className="openspec-panel">
        <div className="openspec-state error" role="alert">
          <b>OpenSpec CLI недоступен или не поддерживается</b>
          <p>{controller.error?.message}</p>
          <button type="button" onClick={controller.refresh}>Повторить</button>
        </div>
      </section>
    );
  }

  return (
    <ChangeCreationWizard
      agentAvailable={controller.agentAvailable}
      creation={creation}
      workflow={controller}
      onClose={onClose}
      onCreated={onChangeCreated}
    />
  );
}
