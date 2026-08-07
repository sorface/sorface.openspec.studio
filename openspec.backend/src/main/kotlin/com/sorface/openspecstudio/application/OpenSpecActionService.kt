package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.*
import com.sorface.openspecstudio.domain.project.ProjectException
import com.sorface.openspecstudio.domain.repository.CloneOperation
import com.sorface.openspecstudio.domain.repository.OperationEvent
import com.sorface.openspecstudio.infrastructure.process.ProcessSupervisor
import org.springframework.stereotype.Service
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.time.Instant

/** OpenSpec action operations и проверяемый draft lifecycle. */
@Service
internal class OpenSpecActionService(private val workflow:OpenSpecService,private val operations:RepositoryStore,private val drafts:OpenSpecOperationStore,
    private val supervisor:ProcessSupervisor,private val mapper:ObjectMapper,
    private val generator:OpenSpecArtifactGenerator=OpenSpecArtifactGenerator.UNAVAILABLE,
    private val explorer:OpenSpecExplorer=OpenSpecExplorer.UNAVAILABLE){
    fun start(projectId:String,input:CreateOpenSpecActionCommand,correlationId:String):CloneOperation{
        val kind=input.kind.trim();if(kind !in KINDS)fail("OPENSPEC_ACTION_BLOCKED","Действие недоступно")
        if(operations.hasActiveOperation(projectId,"openspec"))fail("OPENSPEC_OPERATION_CONFLICT","OpenSpec операция уже выполняется")
        val root=workflow.root(projectId);val change=input.change.trim()
        if(kind!="explore"&&change.isBlank())fail("OPENSPEC_CHANGE_INVALID","Изменение не указано")
        if(kind!="explore")workflow.requireValidChange(change)
        if(kind=="explore"&&input.goal.isBlank())fail("OPENSPEC_ACTION_BLOCKED","Цель операции не указана")
        if(kind in setOf("prepare_artifact","fix_artifact")){val details=workflow.details(projectId,change);if(input.statusFingerprint!=details.fingerprint)fail("OPENSPEC_STATUS_STALE","Статус устарел")
            if(input.goal.isBlank())fail("OPENSPEC_ACTION_BLOCKED","Цель операции не указана")
            val action=details.actions.firstOrNull{it.kind=="prepare_artifact"&&it.artifact==input.artifact}
            if(action?.available!=true||action.instruction==null)fail("OPENSPEC_ACTION_BLOCKED","Артефакт недоступен для подготовки")}
        if(kind=="archive"){
            val details = workflow.details(projectId, change)
            if (input.statusFingerprint != details.fingerprint) fail("OPENSPEC_STATUS_STALE", "Статус устарел")
            val action = details.actions.firstOrNull { it.kind == "archive" }
            if(action?.available!=true)fail("OPENSPEC_ACTION_BLOCKED","Изменение не готово к архивированию")
        }
        val created=operations.createOperation(CloneOperation("",projectId,"openspec","queued",correlationId=correlationId,provider=input.provider,model=input.model,prompt=input.goal,
            openspecAction=kind,openspecChange=change,openspecArtifact=input.artifact,openspecFingerprint=input.statusFingerprint,
            inputJson=mapper.writeValueAsString(input),createdAt=Instant.EPOCH,updatedAt=Instant.EPOCH))
        operations.addEvent(created.id,"queued")
        Thread.ofVirtual().name("openspec-${created.id}").start{execute(created,input,root)}
        return created
    }
    fun list(projectId:String,change:String):List<CloneOperation>{workflow.root(projectId);return drafts.list(projectId,change)}
    fun get(projectId:String,id:String)=operations.getOperation(id)?.takeIf{it.projectId==projectId&&it.kind=="openspec"}?:throw ProjectException("PROJECT_NOT_FOUND","Операция не найдена")
    fun cancel(projectId:String,id:String):CloneOperation{val item=get(projectId,id);if(item.terminal())return item;supervisor.cancel(id);return finish(item,"cancelled")}
    fun events(projectId:String,id:String,after:Long):List<OperationEvent>{get(projectId,id);return operations.listEvents(id,after)}
    fun accept(projectId:String,id:String):DraftSet{
        val operation=get(projectId,id);if(operation.status=="accepted")return drafts.getDraftByOperation(id)?:fail("OPENSPEC_DRAFT_INVALID","Draft не найден")
        if(operation.status!="awaiting_review")fail("OPENSPEC_DRAFT_INVALID","Операция не ожидает проверки")
        val result=runCatching{mapper.readValue(operation.result,ActionResult::class.java)}.getOrElse{fail("OPENSPEC_DRAFT_INVALID","Некорректный результат")}
        val mutations=result.files.map{validateMutation(it);DraftMutation(type=it.type,path=it.path,previousPath=it.previousPath,before=it.before,after=it.after)}
        val set=drafts.saveDraft(DraftSet("",projectId,id,"accepted",mutations,Instant.EPOCH,Instant.EPOCH))
        operations.updateOperation(operation.copy(status="accepted"));return set
    }
    fun reject(projectId:String,id:String):CloneOperation{val item=get(projectId,id);if(item.status!="awaiting_review")fail("OPENSPEC_DRAFT_INVALID","Операция не ожидает проверки");return operations.updateOperation(item.copy(status="rejected"))!!}
    fun draft(projectId:String,id:String)=drafts.getDraft(id)?.takeIf{it.projectId==projectId}?:throw ProjectException("PROJECT_NOT_FOUND","Draft не найден")
    fun write(projectId:String,id:String):DraftSet{
        val set=draft(projectId,id);if(set.status=="written")fail("OPENSPEC_DRAFT_ALREADY_WRITTEN","Draft уже записан")
        val root=workflow.root(projectId);val resolved=set.mutations.map{it to safe(root,it.path)}
        resolved.forEach{(m,path)->when(m.type){"create"->if(Files.exists(path))conflict();"update","delete"->if(!Files.exists(path)||Files.readString(path)!=m.before)conflict();"rename"->{val source=safe(root,m.previousPath);if(!Files.exists(source)||Files.readString(source)!=m.before||Files.exists(path))conflict()}}}
        resolved.forEach{(m,path)->when(m.type){"create","update"->atomic(path,m.after);"delete"->Files.delete(path);"rename"->{Files.createDirectories(path.parent);Files.move(safe(root,m.previousPath),path)}}}
        return drafts.updateDraftStatus(id,"written")?:fail("OPENSPEC_DRAFT_INVALID","Draft не найден")
    }
    private fun execute(operation:CloneOperation,input:CreateOpenSpecActionCommand,root:Path){supervisor.open(operation.id).use{scope->
        val running=operations.updateOperation(operation.copy(status="running"))?:return;operations.addEvent(operation.id,"running")
        try{when(input.kind){
            "create_change"->{if(input.proposal.isBlank())fail("OPENSPEC_ACTION_BLOCKED","Proposal пуст");val path="openspec/changes/${input.change}/proposal.md";if(Files.exists(root.resolve(path)))fail("OPENSPEC_CHANGE_INVALID","Изменение уже существует");
                val result=ActionResult("Proposal подготовлен",listOf(FileMutation("create",path,after=input.proposal)));finish(running,"awaiting_review",result=mapper.writeValueAsString(result))}
            "archive"->{workflow.archive(root,input.change);finish(running,"completed")}
            "explore"->{
                val exploration=explorer.explore(OpenSpecExplorationRequest(operation.id,root,input.goal,input.provider,input.model,
                    {message->operations.addEvent(operation.id,"provider_event",mapper.writeValueAsString(mapOf("message" to message))) }),scope.cancellation)
                finish(running,"awaiting_review",result=mapper.writeValueAsString(ActionResult(exploration.summary,exploration=exploration)))
            }
            "prepare_artifact","fix_artifact"->{
                val details=workflow.details(operation.projectId,input.change)
                val instructions=details.actions.firstOrNull{it.kind=="prepare_artifact"&&it.artifact==input.artifact}?.instruction
                    ?:fail("OPENSPEC_ACTION_BLOCKED","Инструкции артефакта недоступны")
                val generated=generator.generate(OpenSpecArtifactGenerationRequest(operation.id,root,input.change,input.artifact,input.goal,
                    input.provider,input.model,instructions){message->operations.addEvent(operation.id,"provider_event",mapper.writeValueAsString(mapOf("message" to message)))},scope.cancellation)
                val validating=operations.updateOperation(running.copy(status="validating"))?:running;operations.addEvent(operation.id,"validating")
                validateScope(input,generated.files)
                finish(validating,"awaiting_review",result=mapper.writeValueAsString(ActionResult(generated.finalResponse,generated.files)))
            }
            else->fail("OPENSPEC_ACTION_BLOCKED","Действие недоступно")
        }}catch(e:OpenSpecException){finish(running,"failed",e.code,e.message)}catch(e:Exception){finish(running,"failed","OPENSPEC_ACTION_FAILED","OpenSpec action завершился с ошибкой")}
    }}
    private fun finish(item:CloneOperation,status:String,code:String="",message:String="",result:String=item.result):CloneOperation{val current=operations.getOperation(item.id)?:item;if(current.terminal())return current;val updated=operations.updateOperation(current.copy(status=status,errorCode=code,errorMessage=message,result=result))?:current;operations.addEvent(item.id,status,mapper.writeValueAsString(mapOf("code" to code,"message" to message)));return updated}
    private fun validateMutation(m:FileMutation){if(m.type !in setOf("create","update","delete","rename"))fail("OPENSPEC_DRAFT_INVALID","Некорректная мутация");validateRelative(m.path);if(m.type=="rename")validateRelative(m.previousPath)}
    private fun validateRelative(value:String):String{val normalized=value.replace('\\','/');if(normalized.isBlank()||!normalized.startsWith("openspec/")||normalized.split('/').contains("..")||Path.of(normalized).isAbsolute)fail("OPENSPEC_DRAFT_INVALID","Недопустимый путь");return normalized}
    private fun safe(root:Path,value:String):Path{val normalized=validateRelative(value);val path=root.resolve(normalized).normalize();if(!path.startsWith(root)||Files.isSymbolicLink(path))fail("OPENSPEC_DRAFT_INVALID","Недопустимый путь");return path}
    private fun atomic(path:Path,content:String){Files.createDirectories(path.parent);val temporary=Files.createTempFile(path.parent,".osstudio-draft-",".tmp");Files.writeString(temporary,content);Files.move(temporary,path,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)}
    private fun validateScope(input:CreateOpenSpecActionCommand,files:List<FileMutation>){
        val root="openspec/changes/${input.change}/"
        files.forEach{mutation->listOf(mutation.path,mutation.previousPath).filter(String::isNotBlank).forEach{path->
            val normalized=path.replace('\\','/')
            val allowed=when(input.artifact){
                "proposal"->normalized==root+"proposal.md"
                "spec","specs"->normalized==root+"proposal.md"||normalized.startsWith(root+"spec/")||normalized.startsWith(root+"specs/")
                "design"->normalized==root+"design.md"
                "tasks"->normalized==root+"tasks.md"
                else->false
            }
            if(!allowed)fail("AI_SCOPE_VIOLATION","Agent изменил файл вне разрешённого артефакта: $normalized")
        }}
    }
    private fun conflict():Nothing=fail("OPENSPEC_DRAFT_CONFLICT","Файлы изменились после проверки")
    private fun fail(code:String,message:String):Nothing=throw OpenSpecException(code,message)
    private companion object{val KINDS=setOf("explore","create_change","prepare_artifact","fix_artifact","archive")}
}
