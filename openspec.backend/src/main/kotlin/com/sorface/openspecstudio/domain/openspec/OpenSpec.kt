package com.sorface.openspecstudio.domain.openspec

import com.fasterxml.jackson.annotation.JsonIgnore
import java.time.Instant

data class OpenSpecCapability(val available:Boolean=false,val supported:Boolean=false,val version:String="")
data class ChangeSummary(val name:String,val completedTasks:Int=0,val totalTasks:Int=0,val lastModified:Instant=Instant.EPOCH,val status:String="",
    val valid:Boolean=false,val archiveAvailable:Boolean=false)
data class ChangeList(val changes:List<ChangeSummary> = emptyList())
data class Artifact(val id:String,val outputPath:String="",val status:String="",val requires:List<String> = emptyList(),val missingDeps:List<String> = emptyList())
data class InstructionDependency(val id:String,val done:Boolean=false,val path:String="",val description:String="")
data class Instructions(val artifactId:String="",val changeDir:String="",val instruction:String="",val context:String="",val rules:List<String> = emptyList(),
    val template:String="",val resolvedOutputPath:String="",val dependencies:List<InstructionDependency> = emptyList())
data class OpenSpecStatus(val changeName:String="",val schemaName:String="",val isComplete:Boolean=false,val applyRequires:List<String> = emptyList(),val artifacts:List<Artifact> = emptyList())
data class Diagnostic(val level:String,val path:String="",val message:String)
data class Validation(val valid:Boolean,val diagnostics:List<Diagnostic> = emptyList(),val rawOutput:String="")
data class Action(val kind:String,val artifact:String="",val available:Boolean,val reason:String="",val inputPaths:List<String> = emptyList(),val outputPaths:List<String> = emptyList(),@get:JsonIgnore val instruction:Instructions?=null)
data class DeletionPreview(val files:List<String> = emptyList(),val totalFiles:Int=files.size)
data class ChangeDetails(val summary:ChangeSummary,val schema:String,val complete:Boolean,val artifacts:List<Artifact>,val actions:List<Action>,val fingerprint:String,val deletion:DeletionPreview)
data class OpenSpecOverview(val capability:OpenSpecCapability,val changes:List<ChangeSummary>)
data class ValidateCommand(val change:String="")
data class DeleteChangeCommand(val confirmation:String,val statusFingerprint:String)
data class DeleteChangeResult(val deleted:Boolean,val change:String,val deletedFiles:List<String>)

data class FileMutation(val type:String,val path:String,val previousPath:String="",val before:String="",val after:String="")
data class ActionResult(val finalResponse:String="",val files:List<FileMutation> = emptyList(),val diagnostics:List<Diagnostic> = emptyList(),
    val exploration:ExplorationResult?=null)
data class CreateOpenSpecActionCommand(val kind:String,val change:String="",val artifact:String="",val goal:String="",val proposal:String="",
    val provider:String="",val model:String="",val statusFingerprint:String="")

data class DraftMutation(val id:String="",val setId:String="",val type:String,val path:String,val previousPath:String="",val before:String="",val after:String="")
data class DraftSet(val id:String,val projectId:String,val operationId:String,val status:String,val mutations:List<DraftMutation>,val createdAt:Instant,val updatedAt:Instant)

data class ExplorationQuestion(val id:String,val prompt:String,val why:String="",val kind:String,val options:List<String> = emptyList())
data class ExplorationResult(val state:String,val summary:String,val questions:List<ExplorationQuestion> = emptyList(),
    val assumptions:List<String> = emptyList(),val proposal:String="",val suggestedNames:List<String> = emptyList())
data class ChangeCreationDraft(val projectId:String="",val version:Int=1,val stage:String="intent",val intent:String="",val summary:String="",
    val questions:List<ExplorationQuestion> = emptyList(),val answers:Map<String,List<String>> = emptyMap(),val assumptions:List<String> = emptyList(),
    val proposal:String="",val suggestedNames:List<String> = emptyList(),val proposalAccepted:Boolean=false,val changeName:String="",
    val contextFingerprint:String="",val feedback:String="",val createdAt:Instant=Instant.EPOCH,val updatedAt:Instant=Instant.EPOCH)

class OpenSpecException(val code:String,override val message:String):RuntimeException(message)
