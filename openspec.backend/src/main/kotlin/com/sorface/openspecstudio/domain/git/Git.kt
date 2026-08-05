package com.sorface.openspecstudio.domain.git

import com.sorface.openspecstudio.domain.repository.CloneOperation

data class GitChange(val path: String, val index: String, val worktree: String)

data class GitStatus(
    val branch: String,
    val detached: Boolean,
    val head: String,
    val upstream: String,
    val ahead: Int,
    val behind: Int,
    val localBranches: List<String>,
    val remoteBranches: List<String>,
    val remotes: List<String>,
    val changes: List<GitChange>,
    val diff: String,
    val diffTruncated: Boolean,
)

data class GitPathsCommand(val paths: List<String>)
data class GitCommitCommand(val paths: List<String>, val message: String, val expectedHead: String)
data class GitCreateBranchCommand(val name: String)
data class GitSwitchBranchCommand(val branch: String = "", val remoteBranch: String = "", val localBranch: String = "")
data class GitFetchCommand(val remote: String)
data class GitPushCommand(val remote: String = "", val targetBranch: String = "")
typealias GitOperation = CloneOperation

/** Ошибка Git use case со стабильным кодом HTTP API. */
class GitException(val code: String, override val message: String) : RuntimeException(message)
