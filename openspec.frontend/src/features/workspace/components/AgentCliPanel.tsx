"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CustomSelect } from "@/components/ui/CustomSelect";
import { IconButton } from "@/components/ui/IconButton";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";

interface AgentCliPanelProps {
  onClose: () => void;
  projects: ProjectsController;
}

export function AgentCliPanel({ onClose, projects }: AgentCliPanelProps) {
  const activeProject = projects.activeProject;
  const availableProviders = useMemo(() => projects.capabilities?.tools.filter((tool) =>
    ["codex", "gigacode"].includes(tool.name)
    && tool.available
    && tool.supported !== false
    && tool.nonInteractive !== false,
  ) ?? [], [projects.capabilities]);
  const [selectedProvider, setSelectedProvider] = useState(activeProject?.defaultAiProvider ?? availableProviders[0]?.name ?? "");
  const [selectedModel, setSelectedModel] = useState(activeProject?.defaultModel ?? "");
  const selectedProviderTool = availableProviders.find((tool) => tool.name === selectedProvider);
  const availableModels = selectedProviderTool?.models ?? [];
  const selectedModelUnavailable = Boolean(selectedModel && !availableModels.includes(selectedModel));
  const providerOptions = availableProviders.map((tool) => ({
    value: tool.name,
    label: `${tool.name} · ${tool.version || "обнаружен"}`,
  }));
  const modelOptions = [
    { value: "", label: "По умолчанию CLI" },
    ...(selectedModelUnavailable ? [{ value: selectedModel, label: `${selectedModel} · недоступна` }] : []),
    ...availableModels.map((model) => ({ value: model, label: model })),
  ];

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeProject || !selectedProvider) return;
    try {
      await projects.configureAi(activeProject.id, selectedProvider, selectedModel.trim());
      onClose();
    } catch {
      // Projects controller renders the safe backend error.
    }
  };

  return (
    <aside className="agent-cli-panel" id="agent-cli-panel" aria-label="Настройка Agent CLI">
      <header className="agent-cli-panel-heading">
        <div>
          <span className="eyebrow">AI CONFIG</span>
          <b>Agent CLI</b>
        </div>
        <IconButton label="Свернуть панель Agent CLI" onClick={onClose}>›</IconButton>
      </header>
      <form className="agent-cli-form" onSubmit={saveProvider}>
        <label>
          Provider
          <CustomSelect ariaLabel="Provider" value={selectedProvider} options={providerOptions} onChange={(value) => {
            setSelectedProvider(value);
            setSelectedModel("");
          }} />
        </label>
        <label>
          <span className="provider-field-heading">
            Модель
            {availableModels.length > 0 && <small>{availableModels.length} доступно</small>}
          </span>
          {availableModels.length ? (
            <CustomSelect ariaLabel="Модель" value={selectedModel} options={modelOptions} onChange={setSelectedModel} />
          ) : (
            <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} placeholder="По умолчанию CLI" />
          )}
        </label>
        {projects.error && <div className="form-error" role="alert">{projects.error.message}</div>}
        <button className="primary-submit" type="submit" disabled={projects.mutationPending || !selectedProvider}>
          {projects.mutationPending ? "Сохранение…" : "Использовать"}
        </button>
      </form>
      <footer>Настройки сохраняются для активного проекта</footer>
    </aside>
  );
}
