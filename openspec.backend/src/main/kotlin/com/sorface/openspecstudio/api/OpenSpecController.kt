package com.sorface.openspecstudio.api

import com.sorface.openspecstudio.application.ChangeCreationDraftService
import com.sorface.openspecstudio.application.OpenSpecService
import com.sorface.openspecstudio.application.OpenSpecActionService
import com.sorface.openspecstudio.config.correlationId
import com.sorface.openspecstudio.domain.openspec.ChangeCreationDraft
import com.sorface.openspecstudio.domain.openspec.DeleteChangeCommand
import com.sorface.openspecstudio.domain.openspec.ValidateCommand
import com.sorface.openspecstudio.domain.openspec.CreateOpenSpecActionCommand
import jakarta.servlet.http.HttpServletRequest
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter

@RestController
@RequestMapping("/api/v1/projects/{projectId}/openspec")
internal class OpenSpecController(private val service:OpenSpecService,private val creation:ChangeCreationDraftService,private val actions:OpenSpecActionService){
    @GetMapping("/changes") fun overview(@PathVariable projectId:String)=service.overview(projectId)
    @GetMapping("/changes/{change}") fun details(@PathVariable projectId:String,@PathVariable change:String)=service.details(projectId,change)
    @DeleteMapping("/changes/{change}") fun delete(@PathVariable projectId:String,@PathVariable change:String,@RequestBody input:DeleteChangeCommand)=service.delete(projectId,change,input)
    @PostMapping("/validate") fun validate(@PathVariable projectId:String,@RequestBody input:ValidateCommand)=service.validate(projectId,input.change)
    @GetMapping("/change-creation-draft") fun getDraft(@PathVariable projectId:String):ResponseEntity<ChangeCreationDraft> = creation.get(projectId)?.let{ResponseEntity.ok(it)}?:ResponseEntity.noContent().build()
    @PutMapping("/change-creation-draft") fun saveDraft(@PathVariable projectId:String,@RequestBody input:ChangeCreationDraft)=creation.save(projectId,input)
    @DeleteMapping("/change-creation-draft") fun deleteDraft(@PathVariable projectId:String):ResponseEntity<Void>{creation.delete(projectId);return ResponseEntity.noContent().build()}
    @PostMapping("/actions") @ResponseStatus(HttpStatus.ACCEPTED)
    fun start(@PathVariable projectId:String,@RequestBody input:CreateOpenSpecActionCommand,request:HttpServletRequest)=actions.start(projectId,input,correlationId(request))
    @GetMapping("/operations") fun operations(@PathVariable projectId:String,@RequestParam change:String)=mapOf("items" to actions.list(projectId,change))
    @GetMapping("/operations/{operationId}") fun operation(@PathVariable projectId:String,@PathVariable operationId:String)=actions.get(projectId,operationId)
    @DeleteMapping("/operations/{operationId}") fun cancel(@PathVariable projectId:String,@PathVariable operationId:String)=actions.cancel(projectId,operationId)
    @PostMapping("/operations/{operationId}/accept") @ResponseStatus(HttpStatus.CREATED)
    fun accept(@PathVariable projectId:String,@PathVariable operationId:String)=actions.accept(projectId,operationId)
    @PostMapping("/operations/{operationId}/reject") fun reject(@PathVariable projectId:String,@PathVariable operationId:String)=actions.reject(projectId,operationId)
    @GetMapping("/drafts/{draftId}") fun draft(@PathVariable projectId:String,@PathVariable draftId:String)=actions.draft(projectId,draftId)
    @PostMapping("/drafts/{draftId}/write") fun write(@PathVariable projectId:String,@PathVariable draftId:String)=actions.write(projectId,draftId)
    @GetMapping("/operations/{operationId}/events",produces=[MediaType.TEXT_EVENT_STREAM_VALUE])
    fun events(@PathVariable projectId:String,@PathVariable operationId:String,@RequestHeader(name="Last-Event-ID",required=false)last:String?):SseEmitter{
        actions.get(projectId,operationId);val emitter=SseEmitter(0L);Thread.ofVirtual().start{var after=last?.toLongOrNull()?:0L;try{while(true){actions.events(projectId,operationId,after).forEach{event->emitter.send(SseEmitter.event().id(event.sequence.toString()).name(event.type).data(event.payload));after=event.sequence};if(actions.get(projectId,operationId).terminal())break;Thread.sleep(100)};emitter.complete()}catch(e:Exception){emitter.completeWithError(e)}};return emitter}
}
