import type { URI } from 'vscode-uri'

import type { UIToolStatus } from '../chat/types'
import type { RangeData } from '../common/range'
import type { Message } from '../sourcegraph-api'
import type { MessagePart } from '../sourcegraph-api/completions/types'
import type { Range } from '../sourcegraph-api/graphql/client'

export type ContextFileType = 'file' | 'symbol'

/**
 * Fields that are common to any context item included in chat messages.
 */
interface ContextItemCommon {
    /**
     * The URI of the document (such as a file) where this context resides.
     */
    uri: URI

    /**
     * If only a subset of a file is included as context, the range of that subset.
     */
    range?: RangeData

    /**
     * The content, either the entire document or the range subset.
     */
    content?: string | null

    repoName?: string
    revision?: string

    /**
     * For anything other than a file or symbol, the title to display (e.g., "Terminal Output").
     */
    title?: string

    /**
     * The description of the context item used to display in mentions menu.
     */
    description?: string

    /**
     * The source of this context item.
     *
     * NOTE: For item explicitly added by the user, the source should be 'user' as
     * it will be used to determine the {@link ChatContextTokenUsage} type, which is also
     * used for prioritizing context items where user-added items are prioritized over
     * non-user-added items, such as {@link getContextItemTokenUsageType}.
     */
    source?: ContextItemSource

    /**
     * The token count of the item's content.
     */
    size?: number

    /**
     * Whether the item is excluded by Cody Ignore.
     */
    isIgnored?: boolean

    /**
     * Whether the content of the item is too large to be included as context.
     */
    isTooLarge?: boolean

    /**
     * If isTooLarge is true, the reason why the file was deemed too long to be included in the context.
     */
    isTooLargeReason?: string

    /**
     * The ID of the {@link ContextMentionProvider} that supplied this context item (or `undefined`
     * if from a built-in context source such as files and symbols).
     */
    provider?: string

    /**
     * Lucid icon name for the context item
     */
    icon?: string

    /**
     * Optional metadata about where this context item came from or how it was scored, which
     * can help a user or dev working on Cody understand why this item is appearing in context.
     */
    metadata?: string[]

    /**
     * Optional badge to display with the context item.
     */
    badge?: string
}

/**
 * The source of this context.
 */
export enum ContextItemSource {
    /** Explicitly @-mentioned by the user in chat */
    User = 'user',

    /** From the current editor state and open tabs/documents */
    Editor = 'editor',

    /** From symf search */
    Search = 'search',

    /** In initial context */
    Initial = 'initial',

    /** Query-based context that is not added by user */
    Priority = 'priority',

    /** Remote search */
    Unified = 'unified',

    /** Selected code from the current editor */
    Selection = 'selection',

    /** Output from the terminal */
    Terminal = 'terminal',

    /** From source control history */
    History = 'history',

    /** Agentic context */
    Agentic = 'agentic',
}

/**
 * An item (such as a file or symbol) that is included as context in a chat message.
 */
export type ContextItem =
    | ContextItemFile
    | ContextItemRepository
    | ContextItemTree
    | ContextItemSymbol
    | ContextItemOpenCtx
    | ContextItemOpenLink // Not a context item, but opens a link to documentation.
    | ContextItemCurrentSelection
    | ContextItemCurrentFile
    | ContextItemCurrentRepository
    | ContextItemCurrentDirectory
    | ContextItemCurrentOpenTabs
    | ContextItemMedia
    | ContextItemToolState

/**
 * Context items to show by default in the chat input, or as suggestions in the chat UI.
 */
export interface DefaultContext {
    initialContext: ContextItem[]
    corpusContext: ContextItem[]
}

/**
 * A context item that represents a repository.
 */
export interface ContextItemRepository extends ContextItemCommon {
    type: 'repository'
    repoName: string
    repoID: string
    content: null
}

/**
 * A context item that represents a tree (directory).
 */
export interface ContextItemTree extends ContextItemCommon {
    type: 'tree'

    /** Only workspace root trees are supported right now. */
    isWorkspaceRoot: true

    content: null
    name: string
}

/**
 * Not a context item, but an item that can be presented with context choices and opens a link to documentation.
 */
export interface ContextItemOpenLink extends ContextItemCommon {
    type: 'open-link'
    content: null
    name: string
}

/**
 * An OpenCtx context item returned from a provider.
 */
export interface ContextItemOpenCtx extends ContextItemCommon {
    type: 'openctx'
    provider: 'openctx'
    title: string
    uri: URI
    providerUri: string
    mention?: {
        uri: string
        data?: any
        description?: string
    }
}

export interface ContextItemCurrentSelection extends ContextItemCommon {
    type: 'current-selection'
}

export interface ContextItemCurrentFile extends ContextItemCommon {
    type: 'current-file'
}

export interface ContextItemCurrentRepository extends ContextItemCommon {
    type: 'current-repository'
}

export interface ContextItemCurrentDirectory extends ContextItemCommon {
    type: 'current-directory'
}

export interface ContextItemCurrentOpenTabs extends ContextItemCommon {
    type: 'current-open-tabs'
}

export interface ContextItemMedia extends ContextItemCommon {
    type: 'media'
    mimeType: string
    filename: string
    data: string // Base64 encoded file content
    content?: string
}

/**
 * A file (or a subset of a file given by a range) that is included as context in a chat message.
 */
export interface ContextItemFile extends ContextItemCommon {
    type: 'file'

    /**
     * Name of remote repository, this is how mention resolve logic checks
     * that we need to resolve this context item mention via remote search file
     */
    remoteRepositoryName?: string

    ranges?: Range[]
}

/**
 * A symbol (which is a range within a file) that is included as context in a chat message.
 */
export interface ContextItemSymbol extends ContextItemCommon {
    type: 'symbol'

    /** The name of the symbol, used for presentation only (not semantically meaningful). */
    symbolName: string

    /** The kind of symbol, used for presentation only (not semantically meaningful). */
    kind: SymbolKind

    /**
     * Name of remote repository, this is how mention resolve logic checks
     * that we need to resolve this context item mention via remote search file
     */
    remoteRepositoryName?: string
}

/**
 * A context item that represents a tool state from an agent execution.
 */
export interface ContextItemToolState extends ContextItemCommon {
    type: 'tool-state'

    /**
     * Unique identifier for the tool execution
     */
    toolId: string

    /**
     * Name of the tool that was executed
     */
    toolName: string

    /**
     * Current status of the tool execution
     */
    status: UIToolStatus

    /**
     * How long the tool execution took (in milliseconds)
     */
    duration?: number

    /**
     * The specific kind of tool output this represents
     */
    outputType: 'search-result' | 'terminal-output' | 'file-diff' | 'file-view' | 'status' | 'mcp'

    /**
     * For search results, the list of found items
     */
    searchResultItems?: ContextItem[]

    /**
     * For tools that return multiple content parts, the raw parts are stored here
     */
    parts?: MessagePart[]

    /**
     * For tools that return context items, the context items are stored here
     */
    context?: ContextItem[]
}

/** The valid kinds of a symbol. */
export type SymbolKind = 'class' | 'function' | 'method'

/** {@link ContextItem} with the `content` field set to the content. */
export type ContextItemWithContent = ContextItem & { content: string }

/**
 * A system chat message that adds a context item to the conversation.
 */
export interface ContextMessage extends Required<Omit<Message, 'cacheEnabled' | 'content'>> {
    /**
     * Context messages are always "from" the human. (In the future, this could be from "system" for
     * LLMs that support that kind of message, but that `speaker` value is not currently supported
     * by the `Message` type.)
     */
    speaker: 'human'

    /**
     * The context item that this message introduces into the conversation.
     */
    file: ContextItem

    content?: MessagePart[] | undefined | null
}

export const GENERAL_HELP_LABEL = 'Search for a file to include, or type # for symbols...'
export const NO_SYMBOL_MATCHES_HELP_LABEL = ' (language extensions may be loading)'
export const FILE_RANGE_TOOLTIP_LABEL = 'Type a line range to include, e.g. 5-10...'
export const LARGE_FILE_WARNING_LABEL =
    'Warning: File too large. Add line range with : or use @# to choose a symbol'
export const IGNORED_FILE_WARNING_LABEL = 'File ignored by an admin setting.'
