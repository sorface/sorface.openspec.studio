"use client";

import { useMemo, useState, type FormEvent } from "react";
import { LogoMark } from "@/components/ui/LogoMark";
import { ProjectSwitcher } from "@/features/projects/components/ProjectSwitcher";
import type { ProjectsController } from "@/features/projects/hooks/useProjectsController";
import { useSystemStatus } from "@/features/system/hooks/useSystemStatus";

interface WorkspaceHeaderProps {
  draftSaved: boolean;
  projects: ProjectsController;
}

export function WorkspaceHeader({ draftSaved, projects }: WorkspaceHeaderProps) {
  const serverStatus = useSystemStatus();
  const activeProject = projects.activeProject;
  const provider = activeProject?.defaultAiProvider;
  const model = activeProject?.defaultModel;
  const providerTool = projects.capabilities?.tools.find((tool) => tool.name === provider?.toLowerCase());
  const availableProviders = useMemo(() => projects.capabilities?.tools.filter((tool) =>
    ["codex", "gigacode"].includes(tool.name)
    && tool.available
    && tool.supported !== false
    && tool.nonInteractive !== false,
  ) ?? [], [projects.capabilities]);
  const [providerOpen, setProviderOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");

  const toggleProviderSettings = () => {
    if (providerOpen) {
      setProviderOpen(false);
      return;
    }
    setSelectedProvider(provider ?? availableProviders[0]?.name ?? "");
    setSelectedModel(model ?? "");
    setProviderOpen(true);
  };

  const saveProvider = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeProject || !selectedProvider) return;
    try {
      await projects.configureAi(activeProject.id, selectedProvider, selectedModel.trim());
      setProviderOpen(false);
    } catch {
      // Projects controller renders the safe backend error.
    }
  };

  return (
    <header className="topbar">
      <div className="brand">
        <LogoMark />
        <strong>OpenSpec</strong>
        <span>Studio</span>
      </div>

      <ProjectSwitcher controller={projects} />

      <div className="workspace-status">
        <span className="store-id">Store <b>{activeProject?.storePath || "не выбран"}</b></span>
        <span className={`server-status ${serverStatus}`}>
          <i /> {serverStatus === "ready" ? "Локальный server" : serverStatus === "checking" ? "Подключение…" : "Backend недоступен"}
        </span>
        <span className="saved-state"><i /> {draftSaved ? "Файл сохранён" : "Есть изменения"}</span>
      </div>

      <div className="top-actions">
        <div className="provider-settings">
          <button
            className="provider-button"
            disabled={!activeProject || availableProviders.length === 0}
            title={!activeProject ? "Сначала выберите проект" : availableProviders.length === 0 ? "Поддерживаемый agent CLI не обнаружен" : "Настроить agent CLI"}
            aria-expanded={providerOpen}
            aria-haspopup="dialog"
            onClick={toggleProviderSettings}
          >
            <span className="provider-icon" aria-hidden="true">✦</span>
            <span className="provider-label">{provider || "Настроить AI"}</span>
            {model && <small>{model}</small>}
            {provider && providerTool?.available === false && <span className="provider-unavailable">недоступен</span>}
            <svg className={`provider-chevron ${providerOpen ? "open" : ""}`} aria-hidden="true" viewBox="0 0 16 16">
              <path d="m3 6 5 5 5-5" />
            </svg>
          </button>
          {providerOpen && (
            <form className="provider-popover" role="dialog" aria-label="Настройка agent CLI" onSubmit={saveProvider}>
              <div className="provider-popover-heading">
                <b>Agent CLI</b>
                <button type="button" aria-label="Закрыть настройку agent CLI" onClick={() => setProviderOpen(false)}>×</button>
              </div>
              <label>
                Provider
                <select required value={selectedProvider} onChange={(event) => {
                  setSelectedProvider(event.target.value);
                  setSelectedModel("");
                }}>
                  {availableProviders.map((tool) => <option key={tool.name} value={tool.name}>{tool.name} · {tool.version || "обнаружен"}</option>)}
                </select>
              </label>
              <label>
                Модель
                {availableProviders.find((tool) => tool.name === selectedProvider)?.models?.length ? (
                  <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                    <option value="">По умолчанию CLI</option>
                    {availableProviders.find((tool) => tool.name === selectedProvider)?.models?.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                ) : (
                  <input value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} placeholder="По умолчанию CLI" />
                )}
              </label>
              {projects.error && <div className="form-error" role="alert">{projects.error.message}</div>}
              <button className="primary-submit" type="submit" disabled={projects.mutationPending || !selectedProvider}>
                {projects.mutationPending ? "Сохранение…" : "Использовать agent CLI"}
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
