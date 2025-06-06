package com.sourcegraph.config

import com.google.gson.JsonObject
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.application.ApplicationInfo
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.VirtualFile
import com.sourcegraph.cody.agent.CodyAgentService
import com.sourcegraph.cody.agent.protocol_generated.ExtensionConfiguration
import com.sourcegraph.cody.auth.CodyAuthService
import com.sourcegraph.cody.auth.CodySecureStore
import com.sourcegraph.cody.auth.SourcegraphServerPath
import com.sourcegraph.cody.config.CodyApplicationSettings
import com.sourcegraph.utils.CodyEditorUtil
import com.typesafe.config.ConfigFactory
import com.typesafe.config.ConfigRenderOptions
import com.typesafe.config.ConfigValueFactory
import java.nio.file.Path
import java.nio.file.Paths
import java.util.concurrent.CompletableFuture
import kotlin.io.path.readText
import org.jetbrains.annotations.Contract
import org.jetbrains.annotations.VisibleForTesting

object ConfigUtil {
  const val DOTCOM_URL = "https://sourcegraph.com/"
  const val CODY_DISPLAY_NAME = "Cody"
  const val CODE_SEARCH_DISPLAY_NAME = "Code Search"
  const val SOURCEGRAPH_DISPLAY_NAME = "Sourcegraph"
  private const val FEATURE_FLAGS_ENV_VAR = "CODY_JETBRAINS_FEATURES"
  val renderOptions = ConfigRenderOptions.defaults().setComments(false).setOriginComments(false)

  private val logger = Logger.getInstance(ConfigUtil::class.java)

  private val featureFlags: Map<String, Boolean> by lazy {
    parseFeatureFlags(System.getenv(FEATURE_FLAGS_ENV_VAR))
  }

  fun getIntellijProductCode(): Long {
    val build = ApplicationInfo.getInstance().build
    val intellijProductCodeMap =
        mapOf(
            "IU" to 1L, // IntelliJ IDEA Ultimate
            "IC" to 2L, // IntelliJ IDEA Community
            "IE" to 3L, // IntelliJ IDEA Educational
            "PS" to 4L, // PhpStorm
            "WS" to 5L, // WebStorm
            "PY" to 6L, // PyCharm Professional
            "PC" to 7L, // PyCharm Community
            "PE" to 8L, // PyCharm Educational
            "RM" to 9L, // RubyMine
            "OC" to 10L, // AppCode
            "CL" to 11L, // CLion
            "GO" to 12L, // GoLand
            "DB" to 13L, // DataGrip
            "RD" to 14L, // Rider
            "AI" to 15L, // Android Studio
        )
    return intellijProductCodeMap[build.productCode] ?: 0L
  }

  @VisibleForTesting
  fun parseFeatureFlags(envVarValue: String?): Map<String, Boolean> {
    return envVarValue
        ?.split(',')
        ?.mapNotNull { it.trim().split('=').takeIf { pair -> pair.size == 2 } }
        ?.associate { (key, value) -> key.trim() to value.trim().toBoolean() } ?: emptyMap()
  }

  /**
   * Returns true if the specified feature flag is enabled. Feature flags are currently set in the
   * environment variable CODY_JETBRAINS_FEATURES. The format is
   *
   * ```
   *  CODY_JETBRAINS_FEATURES=cody.feature.1=true,cody.feature.2=false
   * ```
   *
   * For instance:
   * ```
   * export CODY_JETBRAINS_FEATURES=cody.feature.inline-edits=true
   * ```
   *
   * @param flagName The name of the feature flag
   * @return true if the feature flag is enabled, false otherwise
   */
  @JvmStatic fun isFeatureFlagEnabled(flagName: String) = featureFlags.getOrDefault(flagName, false)

  @JvmStatic
  fun getAgentConfiguration(
      project: Project,
      endpoint: SourcegraphServerPath? = null,
      token: String? = null,
      customConfigContent: String? = null
  ): ExtensionConfiguration {

    return ExtensionConfiguration(
        anonymousUserID = CodyApplicationSettings.instance.anonymousUserId,
        serverEndpoint = endpoint?.url,
        accessToken = token,
        customHeaders = emptyMap(),
        proxy = UserLevelConfig.getProxy(),
        autocompleteAdvancedProvider =
            UserLevelConfig.getAutocompleteProviderType()?.vscodeSettingString(),
        debug = isCodyDebugEnabled(),
        verboseDebug = isCodyVerboseDebugEnabled(),
        customConfigurationJson = getCustomConfiguration(project, customConfigContent),
    )
  }

  @JvmStatic
  fun getAuthorizationHeadersAsJson(project: Project): JsonObject {
    val endpoint = CodyAuthService.getInstance(project).getEndpoint()
    val authHeaders = CompletableFuture<Map<String, String>>()

    if (isCodyEnabled()) {
      CodyAgentService.withAgent(project) { agent ->
        agent.server.internal_getAuthHeaders(endpoint.url).thenAccept { headers ->
          authHeaders.complete(headers)
        }
      }
    } else {
      val token = CodySecureStore.getInstance().getFromSecureStore(endpoint.url)
      if (token != null) {
        authHeaders.complete(mapOf("Authorization" to "token $token"))
      }
    }

    val jsonObject = JsonObject()
    authHeaders.get().forEach { (key, value) -> jsonObject.addProperty(key, value) }
    return jsonObject
  }

  @JvmStatic
  fun getConfigAsJson(project: Project): JsonObject {
    return JsonObject().apply {
      addProperty("instanceURL", CodyAuthService.getInstance(project).getEndpoint().url)
      addProperty("pluginVersion", getPluginVersion())
      addProperty("anonymousUserId", CodyApplicationSettings.instance.anonymousUserId)
    }
  }

  @JvmStatic fun shouldConnectToDebugAgent() = System.getenv("CODY_AGENT_DEBUG_REMOTE") == "true"

  @JvmStatic
  fun getConfigDir(project: Project): Path {
    val settingsDir =
        project.basePath?.let { Paths.get(it) }?.resolve(".idea")
            ?: Paths.get(System.getProperty("user.home"))
    return settingsDir.resolve(".sourcegraph")
  }

  @JvmStatic
  fun getSettingsFile(project: Project): Path {
    return getConfigDir(project).resolve("cody_settings.json")
  }

  @JvmStatic
  fun getConfigurationEntries(project: Project, key: String): List<Pair<String, Any>> {
    val config = ConfigFactory.parseString(getCustomConfiguration(project)).resolve()
    return config.entrySet().mapNotNull { configEntry ->
      val parts = com.typesafe.config.ConfigUtil.splitPath(configEntry.key)
      if (parts.joinToString(".").startsWith(key)) parts.last() to configEntry.value.unwrapped()
      else null
    }
  }

  @JvmStatic
  fun getCustomConfiguration(project: Project, customConfigContent: String? = null): String {
    // Needed by Edit commands to trigger smart-selection; without it things break.
    // So it isn't optional in JetBrains clients, which do not offer language-neutral solutions
    // to this problem; instead we hardwire it to use the indentation-based provider.
    val additionalProperties =
        mapOf(
            "cody.experimental.foldingRanges" to "indentation-based",
            "cody.advanced.agent.ide.productCode" to getIntellijProductCode())

    try {
      val text =
          try {
            customConfigContent ?: getSettingsFile(project).readText()
          } catch (e: Exception) {
            logger.info("No user defined settings file found. Proceeding with empty custom config")
            ""
          }

      var config = ConfigFactory.parseString(text).resolve()
      val globalConfig = ConfigFactory.parseString(GlobalCodySettings.getConfigJson()).resolve()
      additionalProperties.forEach { (key, value) ->
        config = config.withValue(key, ConfigValueFactory.fromAnyRef(value))
      }

      return config.withFallback(globalConfig).root().render(renderOptions)
    } catch (e: Exception) {
      logger.error("Failed to parse Cody config", e)
      return ""
    }
  }

  @JvmStatic
  fun updateCustomConfiguration(project: Project, key: String, value: String? = null) {
    val config = ConfigFactory.parseString(getSettingsFile(project).readText()).resolve()
    val updatedConfig =
        if (value == null) {
          config.withoutPath(key)
        } else {
          try {
            val subconfig = ConfigFactory.parseString(value)
            config.withValue(key, subconfig.root())
          } catch (e: Exception) {
            config.withValue(key, ConfigValueFactory.fromAnyRef(value))
          }
        }
    setCustomConfiguration(project, updatedConfig.root().render(renderOptions))
  }

  @JvmStatic
  fun setCustomConfiguration(project: Project, customConfigContent: String): VirtualFile? {
    val config = ConfigFactory.parseString(customConfigContent).resolve()
    val content = config.root().render(renderOptions)
    return CodyEditorUtil.createFileOrUseExisting(
        project, getSettingsFile(project).toUri().toString(), content = content, overwrite = true)
        ?: run {
          logger.warn("Could not create settings file")
          return null
        }
  }

  @JvmStatic
  @Contract(pure = true)
  fun getPluginVersion(): String {
    // Internal version
    val plugin = PluginManagerCore.getPlugin(PluginId.getId("com.sourcegraph.jetbrains"))
    return if (plugin != null) plugin.version else "unknown"
  }

  @JvmStatic
  fun getPluginReleaseDate(): java.util.Date? {
    val plugin = PluginManagerCore.getPlugin(PluginId.getId("com.sourcegraph.jetbrains"))
    return plugin?.releaseDate
  }

  @JvmStatic fun isCodyEnabled(): Boolean = CodyApplicationSettings.instance.isCodyEnabled

  @JvmStatic fun isCodyDebugEnabled(): Boolean = CodyApplicationSettings.instance.isCodyDebugEnabled

  @JvmStatic fun isDevMode(): Boolean = System.getProperty("cody-agent.is-dev-mode") == "true"

  @JvmStatic
  fun isCodyUIHintsEnabled(): Boolean = CodyApplicationSettings.instance.isCodyUIHintsEnabled

  @JvmStatic
  fun isCodyVerboseDebugEnabled(): Boolean =
      CodyApplicationSettings.instance.isCodyVerboseDebugEnabled ||
          System.getProperty("sourcegraph.verbose-logging") == "true"

  @JvmStatic
  fun isCodyAutocompleteEnabled(): Boolean =
      CodyApplicationSettings.instance.isCodyAutocompleteEnabled

  @JvmStatic
  fun isCustomAutocompleteColorEnabled(): Boolean =
      CodyApplicationSettings.instance.isCustomAutocompleteColorEnabled

  @JvmStatic
  fun getCustomAutocompleteColor(): Int? = CodyApplicationSettings.instance.customAutocompleteColor

  @JvmStatic
  fun getWorkspaceRootPath(project: Project): Path {
    return Paths.get(getWorkspaceRoot(project))
  }

  @JvmStatic
  fun getWorkspaceRoot(project: Project): String {
    // The base path should only be null for the default project. The agent server assumes that
    // the workspace root is not null, so we have to provide some default value. Feel free to
    // change to something else than the home directory if this is causing problems.
    return project.basePath ?: System.getProperty("user.home")
  }

  @JvmStatic
  fun getAllEditors(): List<Editor> {
    val openProjects = ProjectManager.getInstance().openProjects
    return openProjects
        .toList()
        .flatMap { project: Project -> FileEditorManager.getInstance(project).allEditors.toList() }
        .filterIsInstance<TextEditor>()
        .map { fileEditor: FileEditor -> (fileEditor as TextEditor).editor }
        .toList()
  }

  @JvmStatic
  fun getBlacklistedAutocompleteLanguageIds(): List<String> {
    return CodyApplicationSettings.instance.blacklistedLanguageIds
  }

  @JvmStatic
  fun getShouldAcceptNonTrustedCertificatesAutomatically(): Boolean {
    return CodyApplicationSettings.instance.shouldAcceptNonTrustedCertificatesAutomatically
  }

  @JvmStatic
  fun isIntegrationTestModeEnabled() = java.lang.Boolean.getBoolean("cody.integration.testing")
}
