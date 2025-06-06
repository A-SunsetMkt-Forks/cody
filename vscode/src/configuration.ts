import * as vscode from 'vscode'

import {
    type ClientConfiguration,
    CodyAutoSuggestionMode,
    type CodyIDE,
    OLLAMA_DEFAULT_URL,
    type PickResolvedConfiguration,
    PromptString,
    cenv,
    setStaticResolvedConfigurationValue,
} from '@sourcegraph/cody-shared'

import type { ChatModelProviderConfig } from '@sourcegraph/cody-shared/src/models/sync'
import { CONFIG_KEY, type ConfigKeys } from './configuration-keys'
import { localStorage } from './services/LocalStorageProvider'

interface ConfigGetter {
    get<T>(section: (typeof CONFIG_KEY)[ConfigKeys], defaultValue?: T): T
}

/**
 * All configuration values, with some sanitization performed.
 */
export function getConfiguration(
    config: ConfigGetter = vscode.workspace.getConfiguration()
): ClientConfiguration {
    function getHiddenSetting<T>(configKey: string, defaultValue?: T): T {
        return config.get<T>(`cody.${configKey}` as any, defaultValue)
    }

    let debugRegex: RegExp | null = null
    try {
        const debugPattern: string | null = config.get<string | null>(CONFIG_KEY.debugFilter, null)
        if (debugPattern) {
            if (debugPattern === '*') {
                debugRegex = /.*/
            } else {
                debugRegex = new RegExp(debugPattern)
            }
        }
    } catch (error: any) {
        void vscode.window.showErrorMessage(
            "Error parsing cody.debug.filter regex - using default '*'",
            error
        )
        debugRegex = /.*/
    }

    let codyAutoSuggestionsMode = config.get<string>(
        CONFIG_KEY.suggestionsMode,
        CodyAutoSuggestionMode.Autocomplete
    )

    // Backward compatibility with the older auto-edit config name.
    // If auto-edit was turned on - override the suggestion mode to "auto-edit".
    // TODO: clean up after the beta release
    // https://linear.app/sourcegraph/issue/CODY-4701/clean-up-backwards-compatbility-settings-after-the-release
    if (
        codyAutoSuggestionsMode === 'auto-edit (Experimental)' ||
        codyAutoSuggestionsMode === 'auto-edit (Beta)'
    ) {
        codyAutoSuggestionsMode = CodyAutoSuggestionMode.Autoedit

        void vscode.workspace
            .getConfiguration()
            .update(
                CONFIG_KEY.suggestionsMode,
                CodyAutoSuggestionMode.Autoedit,
                vscode.ConfigurationTarget.Global
            )
    }

    return {
        net: {
            mode: config.get<string | null | undefined>(CONFIG_KEY.netMode, undefined),
            proxy: {
                endpoint: config.get<string | null | undefined>(CONFIG_KEY.netProxyEndpoint, undefined),
                cacert: config.get<string | null | undefined>(CONFIG_KEY.netProxyCacert, undefined),
                skipCertValidation: config.get<boolean | null | undefined>(
                    CONFIG_KEY.netProxySkipCertValidation,
                    false
                ),
            },
            // this is vscode's config that we need to watch. This is because it
            // might require us to re-try auth. Settings aren't actually used so
            // we stringify them.
            vscode: JSON.stringify(config.get<object>('http' as any, {})),
        },
        codebase: sanitizeCodebase(config.get(CONFIG_KEY.codebase)),
        serverEndpoint: config.get<string>(CONFIG_KEY.serverEndpoint),
        customHeaders: config.get<Record<string, string>>(CONFIG_KEY.customHeaders),
        debugVerbose: config.get<boolean>(CONFIG_KEY.debugVerbose, false),
        debugFilter: debugRegex,
        telemetryLevel: getHiddenSetting<'all' | 'off'>('telemetry.level', 'all'),
        autocomplete: codyAutoSuggestionsMode === CodyAutoSuggestionMode.Autocomplete,
        autocompleteLanguages: config.get(CONFIG_KEY.autocompleteLanguages, {
            '*': true,
        }),
        chatPreInstruction: PromptString.fromConfig(config, CONFIG_KEY.chatPreInstruction, undefined),
        editPreInstruction: PromptString.fromConfig(config, CONFIG_KEY.editPreInstruction, undefined),
        commandCodeLenses: config.get(CONFIG_KEY.commandCodeLenses, false),
        autocompleteAdvancedProvider: config.get<ClientConfiguration['autocompleteAdvancedProvider']>(
            CONFIG_KEY.autocompleteAdvancedProvider,
            'default'
        ),
        autocompleteCompleteSuggestWidgetSelection: config.get(
            CONFIG_KEY.autocompleteCompleteSuggestWidgetSelection,
            true
        ),
        autocompleteFormatOnAccept: config.get(CONFIG_KEY.autocompleteFormatOnAccept, true),
        autocompleteDisableInsideComments: config.get(
            CONFIG_KEY.autocompleteDisableInsideComments,
            false
        ),
        codeActions: config.get(CONFIG_KEY.codeActionsEnabled, true),
        commandHints: config.get(CONFIG_KEY.commandHintsEnabled, false),

        /**
         * Instance must have feature flag enabled to use this feature.
         */
        agenticContextExperimentalOptions: config.get(CONFIG_KEY.agenticContextExperimentalOptions, {}),

        chatAgenticContext: config.get(CONFIG_KEY.chatAgenticContext, true),

        authExternalProviders: config.get(CONFIG_KEY.authExternalProviders, []),

        /**
         * Hidden settings for internal use only.
         */

        internalUnstable: getHiddenSetting(
            'internal.unstable',
            cenv.CODY_CONFIG_ENABLE_INTERNAL_UNSTABLE
        ),
        internalDebugContext: getHiddenSetting('internal.debug.context', false),
        internalDebugState: getHiddenSetting('internal.debug.state', false),
        internalDebugTokenUsage: getHiddenSetting('internal.debug.tokenUsage', false),

        autocompleteAdvancedModel: getHiddenSetting('autocomplete.advanced.model', null),
        autocompleteExperimentalGraphContext: getHiddenSetting<
            ClientConfiguration['autocompleteExperimentalGraphContext']
        >('autocomplete.experimental.graphContext', null),
        experimentalNoodle: getHiddenSetting('experimental.noodle', false),

        experimentalTracing: getHiddenSetting('experimental.tracing', false),

        experimentalSupercompletions: getHiddenSetting('experimental.supercompletions', false),
        experimentalAutoEditEnabled: codyAutoSuggestionsMode === CodyAutoSuggestionMode.Autoedit,
        experimentalAutoEditConfigOverride: getHiddenSetting(
            'experimental.autoedit.config.override',
            undefined
        ),
        experimentalAutoEditRendererTesting: getHiddenSetting(
            'experimental.autoedit-renderer-testing',
            false
        ),
        experimentalMinionAnthropicKey: getHiddenSetting('experimental.minion.anthropicKey', undefined),
        experimentalNoxideEnabled: getHiddenSetting('experimental.noxide.enabled', true),
        experimentalGuardrailsTimeoutSeconds: getHiddenSetting('experimental.guardrailsTimeoutSeconds'),

        rulesEnabled: config.get(CONFIG_KEY.rulesEnabled, false),

        autocompleteExperimentalOllamaOptions: getHiddenSetting(
            'autocomplete.experimental.ollamaOptions',
            {
                url: OLLAMA_DEFAULT_URL,
                model: 'codellama:7b-code',
            }
        ),
        autocompleteExperimentalFireworksOptions: getHiddenSetting(
            'autocomplete.experimental.fireworksOptions',
            undefined
        ),

        // Note: In spirit, we try to minimize agent-specific code paths in the VSC extension.
        // We currently use this flag for the agent to provide more helpful error messages
        // when something goes wrong, and to suppress event logging in the agent.
        // Rely on this flag sparingly.
        isRunningInsideAgent: getHiddenSetting('advanced.agent.running', false),
        hasNativeWebview: getHiddenSetting('advanced.hasNativeWebview', true),
        agentIDE: getHiddenSetting<CodyIDE>('advanced.agent.ide.name'),
        agentIDEVersion: getHiddenSetting('advanced.agent.ide.version'),
        agentExtensionVersion: getHiddenSetting('advanced.agent.extension.version'),
        agentHasPersistentStorage: getHiddenSetting('advanced.agent.capabilities.storage', false),
        autocompleteFirstCompletionTimeout: getHiddenSetting<number>(
            'autocomplete.advanced.timeout.firstCompletion',
            3_500
        ),
        providerLimitPrompt: getHiddenSetting<number | undefined>('provider.limit.prompt', undefined),
        devModels: getHiddenSetting<ChatModelProviderConfig[] | undefined>('dev.models', undefined),

        telemetryClientName: getHiddenSetting<string | undefined>('telemetry.clientName'),

        /**
         * Overrides always take precedence over other configuration. Specific
         * override flags should be preferred over opaque blanket settings /
         * environment variables such as TESTING_MODE which can make it
         * difficult to understand the broad impact such a setting can have.
         */
        overrideAuthToken: getHiddenSetting<string | undefined>('override.authToken'),
        overrideServerEndpoint: getHiddenSetting<string | undefined>('override.serverEndpoint'),
    }
}

function sanitizeCodebase(codebase: string | undefined): string {
    if (!codebase) {
        return ''
    }
    const protocolRegexp = /^(https?):\/\//
    const trailingSlashRegexp = /\/$/
    return codebase.replace(protocolRegexp, '').trim().replace(trailingSlashRegexp, '')
}

/**
 * Set the global {@link resolvedConfig} value with the given {@link AuthCredentials} and otherwise
 * use global config and client state.
 *
 * Call this only when this value is guaranteed not to change during execution (such as in CLI
 * programs).
 */
export function setStaticResolvedConfigurationWithAuthCredentials({
    configuration,
    auth,
}: PickResolvedConfiguration<{ configuration: 'customHeaders'; auth: true }>): void {
    setStaticResolvedConfigurationValue({
        configuration: { ...getConfiguration(), customHeaders: configuration.customHeaders },
        auth,
        clientState: localStorage.getClientState(),
        isReinstall: false,
    })
}
