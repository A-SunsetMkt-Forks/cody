package com.sourcegraph.cody.initialization

import com.intellij.AppTopics
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.ex.EditorEventMulticasterEx
import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.util.registry.Registry
import com.intellij.util.concurrency.AppExecutorUtil
import com.sourcegraph.cody.agent.CodyAgentService
import com.sourcegraph.cody.auth.PlgEsAccess
import com.sourcegraph.cody.auth.deprecated.DeprecatedCodyAccountManager
import com.sourcegraph.cody.config.CodyApplicationSettings
import com.sourcegraph.cody.config.CodySettingsFileChangeListener
import com.sourcegraph.cody.config.CodyWindowAdapter
import com.sourcegraph.cody.config.migration.ClientConfigCleanupMigration
import com.sourcegraph.cody.config.migration.SettingsMigration
import com.sourcegraph.cody.config.notification.CodySettingChangeListener
import com.sourcegraph.cody.config.ui.CheckUpdatesTask
import com.sourcegraph.cody.error.SentryService
import com.sourcegraph.cody.listeners.CodyCaretListener
import com.sourcegraph.cody.listeners.CodyDocumentListener
import com.sourcegraph.cody.listeners.CodyFocusChangeListener
import com.sourcegraph.cody.listeners.CodySelectionListener
import com.sourcegraph.cody.statusbar.CodyStatusService
import com.sourcegraph.cody.telemetry.TelemetryV2
import com.sourcegraph.config.ConfigUtil
import java.util.concurrent.TimeUnit

class PostStartupActivity : ProjectActivity {

  // TODO(olafurpg): this activity is taking ~2.5s to run during tests, which indicates that we're
  // doing something wrong, which may be slowing down agent startup. Not fixing it now but this
  // deserves more investigation.
  override suspend fun execute(project: Project) {
    SentryService
        .getInstance() // Initialize Sentry as early as possible to report early unhandled errors
    VerifyJavaBootRuntimeVersion().runActivity(project)
    SettingsMigration().runActivity(project)
    ClientConfigCleanupMigration().runActivity(project)

    // Handle PLG ES access disable logic
    if (PlgEsAccess.isDisabled()) {
      val accountManager = DeprecatedCodyAccountManager.getInstance()
      val savedAccounts = accountManager.getAccounts()
      savedAccounts.forEach { account ->
        if (account.server.isDotcom() || PlgEsAccess.isWorkspaceInstance(account.server.url)) {
          // Clear the account credentials
          com.intellij.ide.passwordSafe.PasswordSafe.instance.set(
              account.credentialAttributes(), null)
        }
      }
    }

    if (CodyApplicationSettings.instance.automaticallyDisableJcefOutOfProcess) {
      Registry.get("ide.browser.jcef.out-of-process.enabled").setValue(false)
    }

    CodyWindowAdapter.addWindowFocusListener(project)

    AppExecutorUtil.getAppScheduledExecutorService()
        .scheduleWithFixedDelay({ CheckUpdatesTask(project).queue() }, 0, 4, TimeUnit.HOURS)

    // For integration tests we do not want to start agent immediately as we would like to first
    // do some setup.
    if (!ConfigUtil.isIntegrationTestModeEnabled()) {
      CodyAgentService.getInstance(project).startAgent()
    }

    CodyStatusService.resetApplication(project)

    val disposable = CodyAgentService.getInstance(project)

    // WARNING: All listeners should check if an event they are receiving is matching project
    // they were created for. Otherwise, we risk propagating events to the wrong agent instance.
    val multicaster = EditorFactory.getInstance().eventMulticaster as EditorEventMulticasterEx
    multicaster.addFocusChangeListener(CodyFocusChangeListener(project), disposable)
    multicaster.addCaretListener(CodyCaretListener(project), disposable)
    multicaster.addSelectionListener(CodySelectionListener(project), disposable)
    multicaster.addDocumentListener(CodyDocumentListener(project), disposable)
    project.messageBus
        .connect(disposable)
        .subscribe(AppTopics.FILE_DOCUMENT_SYNC, CodySettingsFileChangeListener(project))

    // DO NOT remove those lines.
    // Project level listeners need to be used at least once to get initialized.
    project.service<CodySettingChangeListener>()

    TelemetryV2.sendTelemetryEvent(project, "extension", "started")
  }
}
