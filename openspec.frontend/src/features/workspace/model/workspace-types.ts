export type ViewMode = "edit" | "preview" | "split";


export type WorkspaceMode = "documents" | "context";
export type WorkRole = "analyst" | "developer";

export interface WorkspaceFile {
  id: string;
  name: string;
  icon: string;
}
