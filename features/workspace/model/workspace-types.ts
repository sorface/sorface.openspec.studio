export type ViewMode = "edit" | "preview" | "split";


export type WorkspaceMode = "documents" | "context" | "git" | "openspec";

export interface WorkspaceFile {
  id: string;
  name: string;
  icon: string;
}
