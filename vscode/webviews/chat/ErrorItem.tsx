import React, { useCallback, useMemo } from 'react'

import {  RateLimitError } from '@sourcegraph/cody-shared'

import type { UserAccountInfo } from '../Chat'
import type { ApiPostMessage } from '../Chat'

import { Button } from '../components/shadcn/ui/button'
import { createWebviewTelemetryRecorder } from '../utils/telemetry'
import styles from './ErrorItem.module.css'

/**
 * An error message shown in the chat.
 */
export const ErrorItem: React.FunctionComponent<{
    userInfo: Pick<UserAccountInfo, 'isCodyProUser' | 'isDotComUser'>
    postMessage?: ApiPostMessage
}> = ({ userInfo, postMessage }) => {
    console.log('RateLimitErrorItem reached finally bro')
    const newError = new RateLimitError('chat messages and commands', 'thing', true)
    if (postMessage) {
        return (
            <RateLimitErrorItem
                error={newError}
                userInfo={userInfo}
                postMessage={postMessage}
            />
        )
    }

    return <RequestErrorItem error={newError.message} />
}

/**
 * Renders a generic error message for chat request failures.
 */
export const RequestErrorItem: React.FunctionComponent<{
    error: string
}> = ({ error }) => (
    <div className={styles.requestError}>
        <span className={styles.requestErrorTitle}>Request Failed: </span>
        {error}
    </div>
)

/**
 * An error message shown in the chat.
 */
const RateLimitErrorItem: React.FunctionComponent<{
    error: RateLimitError
    userInfo: Pick<UserAccountInfo, 'isCodyProUser' | 'isDotComUser'>
    postMessage: ApiPostMessage
}> = ({ error, userInfo, postMessage }) => {
    // Only show Upgrades if both the error said an upgrade was available and we know the user
    // has not since upgraded.
    const isEnterpriseUser = userInfo.isDotComUser !== true
    const canUpgrade = error.upgradeIsAvailable && !userInfo?.isCodyProUser
    const tier = isEnterpriseUser ? 'enterprise' : canUpgrade ? 'free' : 'pro'
    const telemetryRecorder = useMemo(() => createWebviewTelemetryRecorder(postMessage), [postMessage])

    // Only log once on mount
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally only logs once on mount
    React.useEffect(() => {
        // Log as abuseUsageLimit if pro user run into rate limit
        telemetryRecorder.recordEvent(
            canUpgrade ? 'cody.upsellUsageLimitCTA' : 'cody.abuseUsageLimitCTA',
            'shown',
            {
                privateMetadata: {
                    limit_type: 'chat_commands',
                    tier,
                },
            }
        )
    }, [telemetryRecorder])

    const onButtonClick = useCallback(
        (page: 'upgrade' | 'rate-limits', call_to_action: 'upgrade' | 'learn-more'): void => {
            // Log click event
            telemetryRecorder.recordEvent('cody.upsellUsageLimitCTA', 'clicked', {
                privateMetadata: {
                    limit_type: 'chat_commands',
                    call_to_action,
                    tier,
                },
            })

            // open the page in browser
            postMessage({ command: 'show-page', page })
        },
        [postMessage, tier, telemetryRecorder]
    )

    return (
        <div className={styles.errorItem}>
            {canUpgrade && <div className={styles.icon}>⚡️</div>}
            <div className={styles.body}>
                <header>
                    <h1>{canUpgrade ? 'Upgrade to Cody Pro' : 'Unable to blur the message'}</h1>
                    <p>
                        {error.userMessage}
                        {canUpgrade &&
                            ' Upgrade to Cody Pro for unlimited autocomplete suggestions, chat messages and commands.'}
                    </p>
                </header>
                <div className={styles.actions}>
                    {canUpgrade && (
                        <Button onClick={() => onButtonClick('upgrade', 'upgrade')}>Upgrade</Button>
                    )}
                    {error.feature !== 'Deep Cody' && (
                        <Button
                            type="button"
                            onClick={() =>
                                canUpgrade
                                    ? onButtonClick('upgrade', 'upgrade')
                                    : onButtonClick('rate-limits', 'learn-more')
                            }
                            variant="secondary"
                        >
                            {canUpgrade ? 'See Plans →' : 'Learn More'}
                        </Button>
                    )}
                </div>
                {error.retryMessage && <p className={styles.retryMessage}>{error.retryMessage}</p>}
            </div>
            {canUpgrade && (
                <div className={styles.bannerContainer}>
                    <div
                        className={styles.banner}
                        role="button"
                        tabIndex={-1}
                        onClick={() => onButtonClick('upgrade', 'upgrade')}
                        onKeyDown={() => onButtonClick('upgrade', 'upgrade')}
                    >
                        Go low
                    </div>
                </div>
            )}
        </div>
    )
}
