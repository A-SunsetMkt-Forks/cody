package com.sourcegraph.cody.chat.ui

import com.intellij.openapi.application.invokeLater
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.ui.MutableCollectionComboBoxModel
import com.intellij.util.concurrency.annotations.RequiresEdt
import com.sourcegraph.cody.agent.CodyAgentService
import com.sourcegraph.cody.agent.protocol.ModelUsage
import com.sourcegraph.cody.agent.protocol_extensions.isCodyProOnly
import com.sourcegraph.cody.agent.protocol_extensions.isDeprecated
import com.sourcegraph.cody.agent.protocol_generated.Chat_ModelsParams
import com.sourcegraph.cody.agent.protocol_generated.Model
import com.sourcegraph.cody.agent.protocol_generated.ModelAvailabilityStatus
import com.sourcegraph.cody.auth.CodyAuthService
import com.sourcegraph.cody.auth.SourcegraphServerPath
import com.sourcegraph.cody.edit.EditCommandPrompt
import com.sourcegraph.cody.ui.LlmComboBoxRenderer
import com.sourcegraph.common.BrowserOpener
import java.util.concurrent.TimeUnit

class LlmDropdown(
    private val modelUsage: ModelUsage,
    private val project: Project,
    private val onSetSelectedItem: (Model) -> Unit,
    val parentDialog: EditCommandPrompt?,
    private val fixedModel: String? = null
) : ComboBox<ModelAvailabilityStatus>(MutableCollectionComboBoxModel()) {

  init {
    renderer = LlmComboBoxRenderer(this)
    isVisible = false
    isOpaque = false

    updateModels()
  }

  private fun updateModels() {
    CodyAgentService.withAgent(project) { agent ->
      val chatModels =
          agent.server
              .chat_models(Chat_ModelsParams(modelUsage.value))
              .completeOnTimeout(null, 10, TimeUnit.SECONDS)
              .get()
      invokeLater {
        updateModelsInUI(
            readOnly = chatModels?.readOnly ?: true, models = chatModels?.models ?: emptyList())
      }
    }
  }

  @RequiresEdt
  private fun updateModelsInUI(readOnly: Boolean, models: List<ModelAvailabilityStatus>) {
    if (project.isDisposed) return
    this.removeAllItems()

    val availableModels = models.map { it }.filterNot { it.model.isDeprecated() }
    availableModels.sortedBy { it.model.isCodyProOnly() }.forEach { addItem(it) }

    val endpoint = CodyAuthService.getInstance(project).getEndpoint()
    val defaultLlm = serverToRecentModel[endpoint]

    selectedItem =
        availableModels.find { it.model.id == fixedModel || it.model.id == defaultLlm?.id }
            ?: models.firstOrNull()

    isEnabled = !readOnly && fixedModel == null
    isVisible = selectedItem != null
    setMaximumRowCount(15)

    revalidate()
  }

  override fun getModel(): MutableCollectionComboBoxModel<ModelAvailabilityStatus> {
    return super.getModel() as MutableCollectionComboBoxModel
  }

  @RequiresEdt
  override fun setSelectedItem(anObject: Any?) {
    if (project.isDisposed) return
    val modelProvider = anObject as? ModelAvailabilityStatus
    if (modelProvider != null) {
      if (!modelProvider.isModelAvailable) {
        BrowserOpener.openInBrowser(project, "https://sourcegraph.com/cody/subscription")
        return
      }

      val endpoint = CodyAuthService.getInstance(project).getEndpoint()
      serverToRecentModel[endpoint] = modelProvider.model

      super.setSelectedItem(anObject)
      onSetSelectedItem(modelProvider.model)
    }
  }

  companion object {
    private val serverToRecentModel = HashMap<SourcegraphServerPath, Model>()
  }
}
