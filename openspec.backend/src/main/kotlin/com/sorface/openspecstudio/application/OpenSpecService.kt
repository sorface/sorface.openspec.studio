package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.*
import com.sorface.openspecstudio.domain.project.ProjectException
import org.springframework.stereotype.Service
import org.springframework.beans.factory.annotation.Value
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant

/** Read-only OpenSpec CLI facade и безопасное удаление change. */
@Service
internal class OpenSpecService(private val projects:ProjectRepository,private val runner:ProcessRunner,private val mapper:ObjectMapper,
    @Value("\${openspec.cli.path:}") configuredExecutable:String=""){
    private val executable=configuredExecutable.trim().takeIf(String::isNotBlank)?.let(Path::of)?:findExecutable("openspec")

    fun overview(projectId:String):OpenSpecOverview{
        val root=root(projectId); val capability=capability(root)
        if(!capability.available) fail("OPENSPEC_UNAVAILABLE","OpenSpec CLI недоступен")
        if(!capability.supported) fail("OPENSPEC_VERSION_UNSUPPORTED","Версия OpenSpec CLI не поддерживается")
        return OpenSpecOverview(capability,list(root).changes)
    }
    fun details(projectId:String,change:String):ChangeDetails{
        requireValidChange(change); val root=root(projectId); ensure(root)
        val summary=list(root).changes.firstOrNull{it.name==change}?:fail("OPENSPEC_CHANGE_INVALID","Изменение не найдено")
        val status=readStatus(root,change)
        val actions=status.artifacts.map{artifact->
            if(artifact.status=="blocked") Action("prepare_artifact",artifact.id,false,"MISSING_DEPENDENCIES")
            else runCatching{readInstructions(root, change, artifact.id)}
                .fold({ Action("prepare_artifact",artifact.id,true,inputPaths=it.dependencies.filter(InstructionDependency::done).map(InstructionDependency::path).filter(String::isNotBlank),outputPaths=listOf(it.resolvedOutputPath).filter(String::isNotBlank),instruction=it)},
                    { error ->
                        if (error is OpenSpecException && error.code == "OPENSPEC_READ_ONLY_VIOLATION") throw error
                        Action("prepare_artifact",artifact.id,false,"INSTRUCTIONS_UNAVAILABLE")
                    })
        }+Action("archive",available=status.isComplete,reason=if(status.isComplete)"" else "CHANGE_INCOMPLETE")
        val snapshot=snapshot(root,change)
        val fingerprint=sha256(mapper.writeValueAsBytes(mapOf("status" to status,"actions" to actions,"files" to snapshot.second)))
        return ChangeDetails(summary,status.schemaName,status.isComplete,status.artifacts,actions,fingerprint,DeletionPreview(snapshot.first))
    }
    fun delete(projectId:String,change:String,input:DeleteChangeCommand):DeleteChangeResult{
        requireValidChange(change); if(input.confirmation!=change)fail("OPENSPEC_DELETE_CONFIRMATION","Подтверждение не совпадает")
        val details=details(projectId,change); if(input.statusFingerprint!=details.fingerprint)fail("OPENSPEC_STATUS_STALE","Статус изменения устарел")
        root(projectId).resolve("openspec/changes/$change").toFile().deleteRecursively()
        return DeleteChangeResult(true,change,details.deletion.files)
    }
    fun validate(projectId:String,change:String):Validation{
        val root=root(projectId);ensure(root);if(change.isNotBlank())requireValidChange(change)
        val args=buildList{add("validate");if(change.isBlank())add("--all")else add(change);addAll(listOf("--strict","--no-interactive","--json"))}
        val result=runReadOnly(root,args,allowFailure=true)
        val json=runCatching{mapper.readTree(result.stdout)}.getOrElse{fail("OPENSPEC_COMMAND_FAILED","OpenSpec validate вернул некорректный JSON")}
        val diagnostics=mutableListOf<Diagnostic>();var valid=true
        json.path("items").forEach{item->if(!item.path("valid").asBoolean())valid=false;item.path("issues").forEach{issue->diagnostics+=Diagnostic(issue.path("level").asText(),issue.path("path").asText(),issue.path("message").asText())}}
        if(json.path("summary").path("totals").path("failed").asInt()>0)valid=false
        return Validation(valid,diagnostics,result.stdout)
    }
    fun rawShow(projectId:String,change:String):JsonNode{requireValidChange(change);return mapper.readTree(runReadOnly(root(projectId),listOf("show",change,"--json")).stdout)}
    internal fun newChange(root:Path,change:String){requireValidChange(change);run(root,listOf("new","change",change,"--json")).requireSuccess()}
    internal fun archive(root:Path,change:String){requireValidChange(change);run(root,listOf("archive",change,"--yes","--json"),Duration.ofMinutes(2)).requireSuccess()}
    internal fun root(projectId:String):Path=projects.get(projectId)?.let{Path.of(it.storePath).toRealPath()}?:throw ProjectException("PROJECT_NOT_FOUND","Проект не найден")
    private fun list(root:Path)=read(root,listOf("list","--json"),ChangeList::class.java)
    private fun readInstructions(root:Path,change:String,artifact:String):Instructions{
        val json=mapper.readTree(runReadOnly(root,listOf("instructions",artifact,"--change",change,"--json")).stdout)
        val dependencyNodes=json.path("dependencies")
        val dependencies=(0 until dependencyNodes.size()).map{index->val item=dependencyNodes[index];InstructionDependency(
            id=item.path("id").asText(),done=item.path("done").asBoolean(),path=item.path("path").asText(),description=item.path("description").asText())}
        return Instructions(artifactId=json.path("artifactId").asText(),changeDir=json.path("changeDir").asText(),instruction=json.path("instruction").asText(),
            context=json.path("context").asText(),rules=strings(json.path("rules")),template=json.path("template").asText(),
            resolvedOutputPath=json.path("resolvedOutputPath").asText(),dependencies=dependencies)
    }
    private fun readStatus(root:Path,change:String):OpenSpecStatus{val json=mapper.readTree(runReadOnly(root,listOf("status","--change",change,"--json")).stdout)
        val artifactNodes=json.path("artifacts");val artifacts=(0 until artifactNodes.size()).map{index->val item=artifactNodes[index]
            Artifact(item.path("id").asText(),item.path("outputPath").asText(),item.path("status").asText(),strings(item.path("requires")),strings(item.path("missingDeps")))}
        return OpenSpecStatus(json.path("changeName").asText(),json.path("schemaName").asText(),json.path("isComplete").asBoolean(),
            strings(json.path("applyRequires")),artifacts)}
    private fun strings(node:JsonNode)=(0 until node.size()).map{node[it].asText()}
    private fun capability(root:Path):OpenSpecCapability{
        val path=executable?:return OpenSpecCapability();val result=runner.run(ProcessCommand(path,listOf("--version"),directory=root,timeout=Duration.ofSeconds(30)),ProcessCancellation.NONE)
        if(!result.successful)return OpenSpecCapability(true,false)
        val version=result.stdout.trim();return OpenSpecCapability(true,version.removePrefix("v").substringBefore('.').toIntOrNull()==1,version)
    }
    private fun ensure(root:Path){val value=capability(root);if(!value.available)fail("OPENSPEC_UNAVAILABLE","OpenSpec CLI недоступен");if(!value.supported)fail("OPENSPEC_VERSION_UNSUPPORTED","Версия OpenSpec CLI не поддерживается")}
    private fun <T>read(root:Path,args:List<String>,type:Class<T>):T{
        val result=runReadOnly(root,args)
        return runCatching{mapper.readValue(result.stdout,type)}.getOrElse{fail("OPENSPEC_COMMAND_FAILED","OpenSpec CLI вернул некорректный JSON")}
    }
    private fun runReadOnly(root:Path,args:List<String>,allowFailure:Boolean=false):ProcessResult{
        val before=treeHash(root);val result=run(root,args);if(before!=treeHash(root))fail("OPENSPEC_READ_ONLY_VIOLATION","Read-only OpenSpec команда изменила Store")
        if(!allowFailure)result.requireSuccess();return result
    }
    private fun run(root:Path,args:List<String>,timeout:Duration=Duration.ofSeconds(30))=runner.run(ProcessCommand(executable?:fail("OPENSPEC_UNAVAILABLE","OpenSpec CLI недоступен"),args,directory=root,
        environment=mapOf("NO_COLOR" to "1","CI" to "1"),timeout=timeout,maxOutputBytes=4L shl 20,allowStderrTruncation=true),ProcessCancellation.NONE)
    private fun ProcessResult.requireSuccess(){if(!successful)fail("OPENSPEC_COMMAND_FAILED","OpenSpec CLI завершился с ошибкой")}
    private fun snapshot(root:Path,change:String):Pair<List<String>,Map<String,String>>{
        val dir=root.resolve("openspec/changes/$change").normalize();if(!dir.startsWith(root.resolve("openspec/changes"))||!Files.isDirectory(dir)||Files.isSymbolicLink(dir))fail("OPENSPEC_CHANGE_INVALID","Изменение не найдено")
        val files=Files.walk(dir).use{stream->stream.filter(Files::isRegularFile).map{root.relativize(it).toString().replace('\\','/')}.sorted().toList()}
        return files to files.associateWith{sha256(Files.readAllBytes(root.resolve(it)))}
    }
    private fun treeHash(root:Path):String{val digest=MessageDigest.getInstance("SHA-256");Files.walk(root).use{stream->stream.filter{Files.isRegularFile(it)&&!it.startsWith(root.resolve(".git"))&&!it.startsWith(root.resolve("node_modules"))}.sorted().forEach{digest.update(root.relativize(it).toString().toByteArray());digest.update(Files.readAllBytes(it))}};return digest.digest().joinToString(""){"%02x".format(it)}}
    /** Проверяет имя change до создания операции или обращения к файловой системе. */
    internal fun requireValidChange(value:String){if(!Regex("^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$").matches(value)||value.length>120||value=="archive")fail("OPENSPEC_CHANGE_INVALID","Некорректное имя изменения")}
    private fun sha256(bytes:ByteArray)=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
    private fun findExecutable(name:String):Path?=System.getenv("PATH").orEmpty().split(System.getProperty("path.separator")).asSequence().filter(String::isNotBlank).map{Path.of(it,name)}.firstOrNull{Files.isRegularFile(it)&&Files.isExecutable(it)}
    private fun fail(code:String,message:String):Nothing=throw OpenSpecException(code,message)
}
