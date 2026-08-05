package com.sorface.openspecstudio.application

import com.sorface.openspecstudio.domain.openspec.ChangeCreationDraft
import com.sorface.openspecstudio.domain.openspec.OpenSpecException
import com.sorface.openspecstudio.domain.project.ProjectException
import org.springframework.stereotype.Service
import tools.jackson.databind.ObjectMapper

@Service
internal class ChangeCreationDraftService(private val projects:ProjectRepository,private val drafts:ChangeCreationDraftRepository,private val mapper:ObjectMapper){
    fun get(projectId:String):ChangeCreationDraft?{project(projectId);return drafts.get(projectId)}
    fun save(projectId:String,input:ChangeCreationDraft):ChangeCreationDraft{project(projectId);val item=input.copy(projectId=projectId);validate(item);return drafts.save(item)}
    fun delete(projectId:String){project(projectId);drafts.delete(projectId)}
    private fun validate(item:ChangeCreationDraft){if(item.version!=1||item.stage !in STAGES||item.intent.length>32*1024||item.proposal.length>128*1024||
        item.feedback.length>32*1024||item.questions.size>5||item.assumptions.size>20||item.suggestedNames.size>5||mapper.writeValueAsBytes(item).size>256*1024)
        fail();val ids=item.questions.map{it.id};if(ids.toSet().size!=ids.size||item.answers.keys.any{it !in ids}||item.suggestedNames.any{!NAME.matches(it)}||
            item.changeName.isNotBlank()&&!NAME.matches(item.changeName)||(item.stage in setOf("naming","creating")&&(!item.proposalAccepted||item.proposal.isBlank())))fail()}
    private fun project(id:String)=projects.get(id)?:throw ProjectException("PROJECT_NOT_FOUND","Проект не найден")
    private fun fail():Nothing=throw OpenSpecException("INVALID_CREATION_DRAFT","Некорректный draft")
    private companion object{val STAGES=setOf("intent","clarifying","proposal","naming","creating");val NAME=Regex("[a-z][a-z0-9]*(?:-[a-z0-9]+)*")}
}
