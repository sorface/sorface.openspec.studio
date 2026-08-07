export interface GitChange {
  path: string;
  index: string;
  worktree: string;
}

export interface GitStatus {
  branch: string;
  detached: boolean;
  head: string;
  upstream: string;
  ahead: number;
  behind: number;
  localBranches: string[];
  remoteBranches: string[];
  remotes: string[];
  changes: GitChange[];
  diff: string;
  diffTruncated: boolean;
}

export interface GitBranchCommit {
  sha: string;
  shortSha: string;
  author: string;
  authoredAt: string;
  message: string;
}
