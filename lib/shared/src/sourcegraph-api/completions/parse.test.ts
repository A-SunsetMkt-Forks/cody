import dedent from 'dedent'
import { describe, expect, it } from 'vitest'
import { CompletionsResponseBuilder } from './CompletionsResponseBuilder'
import { parseEvents } from './parse'

describe('parseEvents', () => {
    const helloWorldEvents = {
        events: [
            {
                completion: 'Hello',
                stopReason: undefined,
                content: [],
                type: 'completion',
                usage: undefined,
            },
            {
                completion: 'Hello, world!',
                stopReason: undefined,
                content: [],
                type: 'completion',
                usage: undefined,
            },
        ],
        remainingBuffer: dedent`event: done
                                data: {}`,
    }

    it('parseEvents with deltaText', () => {
        const builder = CompletionsResponseBuilder.fromUrl(
            'https://sourcegraph.com/.api/completions/stream?api-version=2'
        )
        expect(
            parseEvents(
                builder,
                dedent`event: completion
                       data: {"deltaText":"Hello"}

                       event: completion
                       data: {"deltaText":", world!"}

                       event: done
                       data: {}
                       `
            )
        ).toStrictEqual(helloWorldEvents)
    })

    it('parseEvents with completion', () => {
        const builder = CompletionsResponseBuilder.fromUrl(
            'https://sourcegraph.com/.api/completions/stream?api-version=1'
        )
        expect(
            parseEvents(
                builder,
                dedent`event: completion
                       data: {"completion":"Hello"}

                       event: completion
                       data: {"completion":"Hello, world!"}

                       event: done
                       data: {}
                       `
            )
        ).toStrictEqual(helloWorldEvents)
    })

    it('parseEvents with usage data', () => {
        const builder = CompletionsResponseBuilder.fromUrl(
            'https://sourcegraph.com/.api/completions/stream?api-version=2'
        )
        expect(
            parseEvents(
                builder,
                dedent`event: completion
                       data: {"usage":{"completion_tokens":8,"prompt_tokens":15,"total_tokens":23}}

                       event: done
                       data: {}
                       `
            )
        ).toStrictEqual({
            events: [
                {
                    completion: '',
                    stopReason: undefined,
                    content: [],
                    type: 'completion',
                    usage: {
                        completionTokens: 8,
                        promptTokens: 15,
                        totalTokens: 23,
                    },
                },
            ],
            remainingBuffer: dedent`event: done
                                    data: {}`,
        })
    })
})
