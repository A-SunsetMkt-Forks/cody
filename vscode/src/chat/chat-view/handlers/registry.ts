import type { ChatMessage } from '@sourcegraph/cody-shared'
import { isCodyTesting } from '../chat-helpers'
import { AgenticHandler } from './AgenticHandler'
import { ChatHandler } from './ChatHandler'
import { DeepCodyHandler } from './DeepCodyHandler'
import { EditHandler } from './EditHandler'
import { SearchHandler } from './SearchHandler'
import type { AgentHandler, AgentTools } from './interfaces'

/**
 * The agentRegistry maps agent IDs to their handler factory functions
 */
const agentRegistry = new Map<string, (id: string, tools: AgentTools) => AgentHandler>([
    ['search', (_id, _tools) => new SearchHandler()],
    ['edit', (_id, { contextRetriever, editor }) => new EditHandler('edit', contextRetriever, editor)],
    [
        'insert',
        (_id, { contextRetriever, editor }) => new EditHandler('insert', contextRetriever, editor),
    ],
])

/**
 * Gets an agent handler for the specified agent and model ID
 */
export function getAgent(model: string, intent: ChatMessage['intent'], tools: AgentTools): AgentHandler {
    const { contextRetriever, editor, chatClient } = tools

    // Special case for agentic intent
    if (intent === 'agentic') {
        return new AgenticHandler(contextRetriever, editor, chatClient)
    }

    // Return appropriate handler or fallback to chat handler
    const intentHandler = intent && agentRegistry.get(intent)
    if (intentHandler) return intentHandler(intent, tools)

    // Try to get handler from registry based on model or intent
    const modelHandler = agentRegistry.get(model)
    if (modelHandler) return modelHandler(model, tools)

    // Use agentic chat (Deep Cody) handler if enabled.
    // Skip in agent testing mode to avoid non-deterministic results causing
    // recordings to fail consistently.
    if (!isCodyTesting && DeepCodyHandler.isAgenticChatEnabled()) {
        return new DeepCodyHandler(contextRetriever, editor, chatClient)
    }

    return new ChatHandler(contextRetriever, editor, chatClient)
}
