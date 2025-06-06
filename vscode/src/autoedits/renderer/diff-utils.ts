import { diff } from 'fast-myers-diff'
import * as uuid from 'uuid'
import * as vscode from 'vscode'

import { getNewLineChar } from '../../completions/text-processing'

import type {
    AddedLineInfo,
    DecorationInfo,
    DecorationLineInfo,
    LineChange,
    ModifiedLineInfo,
} from './decorators/base'

export function getDecorationInfoFromPrediction(
    document: vscode.TextDocument,
    prediction: string,
    range: vscode.Range
): DecorationInfo {
    const currentFileText = document.getText()
    const predictedFileText =
        currentFileText.slice(0, document.offsetAt(range.start)) +
        prediction +
        currentFileText.slice(document.offsetAt(range.end))

    const decorationInfo = getDecorationInfo(currentFileText, predictedFileText)
    return decorationInfo
}

/**
 * Generates decoration information by computing the differences between two texts.
 */
export function getDecorationInfo(
    originalText: string,
    modifiedText: string,
    /**
     * Regex to split a line into chunks for fine-grained diffing.
     * Required for the auto-edit debug panel to render the diff in a readable format.
     * @default WORDS_AND_PUNCTUATION_REGEX
     */
    chunkRegex: RegExp = WORDS_AND_PUNCTUATION_REGEX
): DecorationInfo {
    const originalLines = originalText.split(getNewLineChar(originalText))
    const modifiedLines = modifiedText.split(getNewLineChar(modifiedText))

    const lineInfos = computeDiffOperations(originalLines, modifiedLines, chunkRegex)

    const decorationInfo: DecorationInfo = {
        modifiedLines: [],
        removedLines: [],
        addedLines: [],
        unchangedLines: [],
    }

    for (const lineInfo of lineInfos) {
        switch (lineInfo.type) {
            case 'unchanged':
                decorationInfo.unchangedLines.push(lineInfo)
                break
            case 'added':
                decorationInfo.addedLines.push(lineInfo)
                break
            case 'removed':
                decorationInfo.removedLines.push(lineInfo)
                break
            case 'modified':
                decorationInfo.modifiedLines.push(lineInfo as ModifiedLineInfo)
                break
        }
    }

    return decorationInfo
}

/**
 * Computes the diff operations between two arrays of lines.
 */
function computeDiffOperations(
    originalLines: string[],
    modifiedLines: string[],
    chunkRegex: RegExp
): DecorationLineInfo[] {
    // Compute the list of diff chunks between the original and modified lines.
    // Each diff chunk is a tuple representing the range of changes:
    // [originalStart, originalEnd, modifiedStart, modifiedEnd]
    const diffs = diff(originalLines, modifiedLines)

    // Initialize an array to collect information about each line and its change type.
    const lineInfos: DecorationLineInfo[] = []

    // Initialize indices to keep track of the current position in the original and modified lines.
    let originalIndex = 0 // Current index in originalLines
    let modifiedIndex = 0 // Current index in modifiedLines

    // Iterate over each diff chunk to process changes.
    for (const [originalStart, originalEnd, modifiedStart, modifiedEnd] of diffs) {
        // Process unchanged lines before the current diff
        while (originalIndex < originalStart && modifiedIndex < modifiedStart) {
            lineInfos.push({
                id: uuid.v4(),
                type: 'unchanged',
                originalLineNumber: originalIndex,
                modifiedLineNumber: modifiedIndex,
                text: modifiedLines[modifiedIndex],
            })
            originalIndex++
            modifiedIndex++
        }

        // Calculate the number of deletions and insertions in the current diff chunk.
        const numDeletions = originalEnd - originalStart // Number of lines deleted from originalLines
        const numInsertions = modifiedEnd - modifiedStart // Number of lines added to modifiedLines

        let i = 0

        // Handle modifications
        while (i < Math.min(numDeletions, numInsertions)) {
            const originalLine = originalLines[originalStart + i]
            const modifiedLine = modifiedLines[modifiedStart + i]

            if (originalLine !== modifiedLine) {
                lineInfos.push(
                    createModifiedLineInfo({
                        originalLineNumber: originalStart + i,
                        modifiedLineNumber: modifiedStart + i,
                        originalText: originalLine,
                        modifiedText: modifiedLine,
                        chunkRegex,
                    })
                )
            } else {
                lineInfos.push({
                    id: uuid.v4(),
                    type: 'unchanged',
                    originalLineNumber: originalStart + i,
                    modifiedLineNumber: modifiedStart + i,
                    text: modifiedLine,
                })
            }
            i++
        }

        // Process remaining deletions (removed lines)
        for (let j = i; j < numDeletions; j++) {
            lineInfos.push({
                id: uuid.v4(),
                type: 'removed',
                originalLineNumber: originalStart + j,
                text: originalLines[originalStart + j],
            })
        }

        // Process remaining insertions (added lines)
        for (let j = i; j < numInsertions; j++) {
            lineInfos.push({
                id: uuid.v4(),
                type: 'added',
                modifiedLineNumber: modifiedStart + j,
                text: modifiedLines[modifiedStart + j],
            })
        }

        // Update the indices to the end of the current diff chunk.
        originalIndex = originalEnd
        modifiedIndex = modifiedEnd
    }

    // Process any remaining unchanged lines after the last diff chunk.
    while (originalIndex < originalLines.length && modifiedIndex < modifiedLines.length) {
        lineInfos.push({
            id: uuid.v4(),
            type: 'unchanged',
            originalLineNumber: originalIndex,
            modifiedLineNumber: modifiedIndex,
            text: modifiedLines[modifiedIndex],
        })
        originalIndex++
        modifiedIndex++
    }

    return lineInfos
}

function getModifiedLineChanges({
    originalLineNumber,
    modifiedLineNumber,
    originalText,
    modifiedText,
    chunkRegex,
}: {
    originalLineNumber: number
    modifiedLineNumber: number
    originalText: string
    modifiedText: string
    chunkRegex: RegExp
}): LineChange[] {
    const oldChunks = splitLineIntoChunks(originalText, chunkRegex)
    const newChunks = splitLineIntoChunks(modifiedText, chunkRegex)
    return computeLineChanges({
        oldChunks,
        newChunks,
        originalLineNumber,
        modifiedLineNumber,
    })
}

/**
 * Groups changes from a line by merging consecutive changes of the same type
 */
function groupLineChanges(changes: LineChange[]): LineChange[] {
    const groupedChanges: LineChange[] = []
    let currentGroup: LineChange | null = null

    for (const change of changes) {
        if (currentGroup && currentGroup.type === change.type) {
            currentGroup = {
                ...change,
                text: currentGroup.text + change.text,
                originalRange: new vscode.Range(
                    currentGroup.originalRange.start.line,
                    currentGroup.originalRange.start.character,
                    change.originalRange.end.line,
                    change.originalRange.end.character
                ),
                modifiedRange: new vscode.Range(
                    currentGroup.modifiedRange.start.line,
                    currentGroup.modifiedRange.start.character,
                    change.modifiedRange.end.line,
                    change.modifiedRange.end.character
                ),
            }
            // Update the previous stored group to match `currentGroup`
            groupedChanges[groupedChanges.length - 1] = currentGroup
        } else {
            // New group, push it immediately. We may update it later
            currentGroup = { ...change }
            groupedChanges.push(currentGroup)
        }
    }

    return groupedChanges
}

/**
 * Checks if a line change within a diff is simple enough to show to the user.
 * This is if the diff is set of suitable modifications that are separated by suitable unchanged areas.
 *    Suitable modifications: Pure insertions/deletions or "replacement" changes where an insertion is immediately followed by a deletion or vice versa.
 *    Suitable unchanged areas: An unchanged area that contains some whitespace. This is so we can guard against cases where a character diff splits a word into multiple chunks
 *                              whilst still allowing multiple changes in a line.
 */
export function isSimpleLineDiff(changes: LineChange[]): boolean {
    if (changes.length <= 1) {
        return true
    }

    let lastChange = {
        type: null as LineChange['type'] | null,
        isReplacement: false,
    }

    const groupedChanges = groupLineChanges(changes)
    for (let i = 0; i < groupedChanges.length; i++) {
        const incomingChange = groupedChanges[i]
        if (!lastChange.type) {
            lastChange = {
                type: incomingChange.type,
                isReplacement: false,
            }
            // First change, always simple at this point
            continue
        }

        const incomingModification = incomingChange.type !== 'unchanged'
        if (lastChange.isReplacement && incomingModification) {
            // We just had a replacement and now we have another change.
            // This creates a diff that is difficult to read
            return false
        }

        if (incomingChange.type === 'unchanged') {
            // Check if the unchanged text contains some whitespace, this is an indicator
            // that we can use this to seperate multiple changes without worrying about
            // the diff splitting words into multiple change chunks
            const isSuitableSeparator = /\s/.test(incomingChange.text)
            const isLastChange = i === groupedChanges.length - 1
            if (!isSuitableSeparator && !isLastChange) {
                return false
            }
            lastChange = { type: incomingChange.type, isReplacement: false }
            continue
        }

        lastChange = {
            type: incomingChange.type,
            isReplacement: lastChange.type !== 'unchanged',
        }
    }

    return true
}

/**
 * Creates a ModifiedLineInfo object by computing insertions and deletions within a line.
 */
function createModifiedLineInfo(params: {
    originalLineNumber: number
    modifiedLineNumber: number
    originalText: string
    modifiedText: string
    chunkRegex: RegExp
}): ModifiedLineInfo {
    let changes = getModifiedLineChanges({ ...params, chunkRegex: CHARACTER_REGEX })

    if (!isSimpleLineDiff(changes)) {
        // We weren't able to make a simple line diff with our character diffing
        // Let's recalculate the changes with a word diff, which is likely to be more readable in this case.
        changes = getModifiedLineChanges(params)
    }

    return {
        id: uuid.v4(),
        type: 'modified',
        originalLineNumber: params.originalLineNumber,
        modifiedLineNumber: params.modifiedLineNumber,
        oldText: params.originalText,
        newText: params.modifiedText,
        changes,
    }
}

/**
 * Computes insertions and deletions within a line.
 */
function computeLineChanges({
    oldChunks,
    newChunks,
    originalLineNumber,
    modifiedLineNumber,
}: {
    oldChunks: string[]
    newChunks: string[]
    originalLineNumber: number
    modifiedLineNumber: number
}): LineChange[] {
    const changes: LineChange[] = []
    const chunkDiffs = diff(oldChunks, newChunks)

    let originalOffset = 0 // Position in the original line's text
    let modifiedOffset = 0 // Position in the modified line's text

    let oldIndex = 0
    let newIndex = 0

    function pushUnchangedUntil(targetOldIndex: number, targetNewIndex: number) {
        while (oldIndex < targetOldIndex && newIndex < targetNewIndex) {
            const unchangedText = oldChunks[oldIndex]
            if (unchangedText) {
                const startOriginal = originalOffset
                const startModified = modifiedOffset
                const length = unchangedText.length

                originalOffset += length
                modifiedOffset += length

                const previousChange = changes.at(-1)
                if (previousChange?.type === 'unchanged') {
                    previousChange.text += unchangedText
                    previousChange.originalRange = new vscode.Range(
                        previousChange.originalRange.start.line,
                        previousChange.originalRange.start.character,
                        originalLineNumber,
                        originalOffset
                    )
                    previousChange.modifiedRange = new vscode.Range(
                        previousChange.modifiedRange.start.line,
                        previousChange.modifiedRange.start.character,
                        modifiedLineNumber,
                        modifiedOffset
                    )
                } else {
                    changes.push({
                        id: uuid.v4(),
                        type: 'unchanged',
                        text: unchangedText,
                        originalRange: new vscode.Range(
                            originalLineNumber,
                            startOriginal,
                            originalLineNumber,
                            originalOffset
                        ),
                        modifiedRange: new vscode.Range(
                            modifiedLineNumber,
                            startModified,
                            modifiedLineNumber,
                            modifiedOffset
                        ),
                    })
                }
            }
            oldIndex++
            newIndex++
        }
    }

    for (const [oldStart, oldEnd, newStart, newEnd] of chunkDiffs) {
        // Add unchanged chunks before this diff hunk
        pushUnchangedUntil(oldStart, newStart)

        const deletionText = oldChunks.slice(oldStart, oldEnd).join('')
        const insertionText = newChunks.slice(newStart, newEnd).join('')

        oldIndex = oldEnd
        newIndex = newEnd

        if (!deletionText && !insertionText) {
            // No changes, continue
            continue
        }

        // Identify common whitespace prefix
        let prefixLength = 0
        while (
            prefixLength < deletionText.length &&
            prefixLength < insertionText.length &&
            deletionText[prefixLength] === insertionText[prefixLength] &&
            /\s/.test(deletionText[prefixLength])
        ) {
            prefixLength++
        }

        // Identify common whitespace suffix
        let suffixLength = 0
        while (
            suffixLength < deletionText.length - prefixLength &&
            suffixLength < insertionText.length - prefixLength &&
            deletionText[deletionText.length - 1 - suffixLength] ===
                insertionText[insertionText.length - 1 - suffixLength] &&
            /\s/.test(deletionText[deletionText.length - 1 - suffixLength])
        ) {
            suffixLength++
        }

        // Handle unchanged prefix
        if (prefixLength > 0) {
            const unchangedText = deletionText.slice(0, prefixLength)
            const startOriginal = originalOffset
            const startModified = modifiedOffset

            originalOffset += prefixLength
            modifiedOffset += prefixLength

            changes.push({
                id: uuid.v4(),
                type: 'unchanged',
                text: unchangedText,
                originalRange: new vscode.Range(
                    originalLineNumber,
                    startOriginal,
                    originalLineNumber,
                    originalOffset
                ),
                modifiedRange: new vscode.Range(
                    modifiedLineNumber,
                    startModified,
                    modifiedLineNumber,
                    modifiedOffset
                ),
            })
        }

        // Handle deletion core
        const deletionCore = deletionText.slice(prefixLength, deletionText.length - suffixLength)
        if (deletionCore) {
            const startOriginal = originalOffset
            const startModified = modifiedOffset

            originalOffset += deletionCore.length
            // modifiedOffset does not advance for deletion

            changes.push({
                id: uuid.v4(),
                type: 'delete',
                text: deletionCore,
                originalRange: new vscode.Range(
                    originalLineNumber,
                    startOriginal,
                    originalLineNumber,
                    originalOffset
                ),
                modifiedRange: new vscode.Range(
                    modifiedLineNumber,
                    startModified,
                    modifiedLineNumber,
                    startModified
                ),
            })
        }

        // Handle insertion core
        const insertionCore = insertionText.slice(prefixLength, insertionText.length - suffixLength)
        if (insertionCore) {
            const startOriginal = originalOffset
            const startModified = modifiedOffset

            modifiedOffset += insertionCore.length
            // originalOffset does not advance for insertion

            changes.push({
                id: uuid.v4(),
                type: 'insert',
                text: insertionCore,
                originalRange: new vscode.Range(
                    originalLineNumber,
                    startOriginal,
                    originalLineNumber,
                    startOriginal
                ),
                modifiedRange: new vscode.Range(
                    modifiedLineNumber,
                    startModified,
                    modifiedLineNumber,
                    modifiedOffset
                ),
            })
        }

        // Handle unchanged suffix
        if (suffixLength > 0) {
            const unchangedText = deletionText.slice(deletionText.length - suffixLength)
            const startOriginal = originalOffset
            const startModified = modifiedOffset

            originalOffset += suffixLength
            modifiedOffset += suffixLength

            changes.push({
                id: uuid.v4(),
                type: 'unchanged',
                text: unchangedText,
                originalRange: new vscode.Range(
                    originalLineNumber,
                    startOriginal,
                    originalLineNumber,
                    originalOffset
                ),
                modifiedRange: new vscode.Range(
                    modifiedLineNumber,
                    startModified,
                    modifiedLineNumber,
                    modifiedOffset
                ),
            })
        }
    }

    // Handle any remaining unchanged chunks after the last diff hunk
    while (oldIndex < oldChunks.length && newIndex < newChunks.length) {
        const unchangedText = oldChunks[oldIndex]
        if (unchangedText) {
            const startOriginal = originalOffset
            const startModified = modifiedOffset
            const length = unchangedText.length

            originalOffset += length
            modifiedOffset += length

            changes.push({
                id: uuid.v4(),
                type: 'unchanged',
                text: unchangedText,
                originalRange: new vscode.Range(
                    originalLineNumber,
                    startOriginal,
                    originalLineNumber,
                    originalOffset
                ),
                modifiedRange: new vscode.Range(
                    modifiedLineNumber,
                    startModified,
                    modifiedLineNumber,
                    modifiedOffset
                ),
            })
        }
        oldIndex++
        newIndex++
    }

    return changes
}

// Split line into words, consecutive spaces and punctuation marks
const WORDS_AND_PUNCTUATION_REGEX = /(\w+|\s+|\W)/g

// Split lines by characters
export const CHARACTER_REGEX = /./g

/**
 * Splits a line into chunks for fine-grained diffing.
 */
function splitLineIntoChunks(line: string, chunkRegex: RegExp): string[] {
    return line.match(chunkRegex) || []
}

/**
 * A generic helper for summing up `item.text.length` in an array of objects with a `text` field.
 */
function sumTextLengths<T extends { text: string }>(items: T[]): number {
    return items.reduce((total, { text }) => total + text.length, 0)
}

export interface DecorationStats {
    modifiedLines: number
    removedLines: number
    addedLines: number
    unchangedLines: number
    addedChars: number
    removedChars: number
    unchangedChars: number
}

export function getDecorationStats({
    modifiedLines,
    removedLines,
    addedLines,
    unchangedLines,
}: DecorationInfo): DecorationStats {
    const added = sumTextLengths(addedLines)
    const removed = sumTextLengths(removedLines)
    const unchanged = sumTextLengths(unchangedLines)

    const charsStats = modifiedLines
        .flatMap(line => line.changes)
        .reduce(
            (acc, change) => {
                switch (change.type) {
                    case 'insert':
                        acc.added += change.text.length
                        break
                    case 'delete':
                        acc.removed += change.text.length
                        break
                    case 'unchanged':
                        acc.unchanged += change.text.length
                        break
                }
                return acc
            },
            { added, removed, unchanged }
        )

    return {
        modifiedLines: modifiedLines.length,
        removedLines: removedLines.length,
        addedLines: addedLines.length,
        unchangedLines: unchangedLines.length,
        addedChars: charsStats.added,
        removedChars: charsStats.removed,
        unchangedChars: charsStats.unchanged,
    }
}

/**
 * Checks if the only changes for modified lines are additions of text.
 */
export function isOnlyAddingTextForModifiedLines(modifiedLines: ModifiedLineInfo[]): boolean {
    for (const modifiedLine of modifiedLines) {
        if (modifiedLine.changes.some(change => change.type === 'delete')) {
            return false
        }
    }
    return true
}

export function isOnlyAddingText(decorationInfo: DecorationInfo): boolean {
    // Check if there are no removed lines
    if (decorationInfo.removedLines.length > 0) {
        return false
    }

    // Check if modified lines only have additions (no deletions)
    if (!isOnlyAddingTextForModifiedLines(decorationInfo.modifiedLines)) {
        return false
    }

    // If we have added lines or modified lines with only additions, then we're only adding text
    return decorationInfo.addedLines.length > 0 || decorationInfo.modifiedLines.length > 0
}

/**
 * Checks if the only changes for modified lines are additions of text.
 */
export function isOnlyRemovingTextForModifiedLines(modifiedLines: ModifiedLineInfo[]): boolean {
    for (const modifiedLine of modifiedLines) {
        if (modifiedLine.changes.some(change => change.type === 'insert')) {
            return false
        }
    }
    return true
}

/**
 * Sorts a diff by line number.
 * Handles preferred sorting order when encountering line number conflicts
 */
export function sortDiff(diff: DecorationInfo): DecorationLineInfo[] {
    const sortedDiff = [
        ...diff.addedLines,
        ...diff.modifiedLines,
        ...diff.unchangedLines,
        ...diff.removedLines,
    ].sort((a, b) => {
        const aLine = a.type === 'removed' ? a.originalLineNumber : a.modifiedLineNumber
        const bLine = b.type === 'removed' ? b.originalLineNumber : b.modifiedLineNumber

        if (aLine === bLine) {
            // We have a conflict, this is because the same line number has been used for both added and removed lines.
            // To make a visually appealing diff, we need to ensure that we order these conflicts like so:
            // removed -> added -> modified -> unchanged
            const typeOrder = {
                removed: 0,
                added: 1,
                modified: 2,
                unchanged: 3,
            }
            return typeOrder[a.type] - typeOrder[b.type]
        }

        return aLine - bLine
    })

    return sortedDiff
}

export function getAddedLines(decorationInfo: DecorationInfo): AddedLineInfo[] {
    return decorationInfo.addedLines.sort((a, b) => a.modifiedLineNumber - b.modifiedLineNumber)
}
