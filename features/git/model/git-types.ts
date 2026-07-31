export interface GitChange {
  path: string;
  index: string;
  worktree: string;
}

export interface GitStatus {
  branch: string;
  head: string;
  changes: GitChange[];
  diff: string;
  diffTruncated: boolean;
}
