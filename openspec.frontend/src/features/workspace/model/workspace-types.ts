export type ViewMode = "edit" | "preview" | "split";


export type WorkspaceMode = "documents" | "context" | "openspec";

export interface WorkspaceFile {
  id: string;
  name: string;
  icon: string;
}
