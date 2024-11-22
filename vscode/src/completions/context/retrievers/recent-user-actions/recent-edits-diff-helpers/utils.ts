import { PromptString } from '@sourcegraph/cody-shared'
import { displayPath } from '@sourcegraph/cody-shared/src/editor/displayPath'
import { structuredPatch } from 'diff'
import type * as vscode from 'vscode'
import type { TextDocumentChange } from './base'

/**
 * Represents a group of text document changes with their line range information.
 * The grouped changes are consecutive changes made in the document that should be treated as a single entity when computing diffs.
 *
 * @example
 * When typing "hello world" in a document, each character typed generates a separate change event.
 * These changes are grouped together as a single entity in this interface.
 */
export interface TextDocumentChangeGroup {
    /** Array of individual text document changes in this group */
    changes: TextDocumentChange[]

    /**
     * The starting line number of the changes in this group
     */
    changeStartLine: number

    /**
     * The ending line number of the changes in this group
     */
    changeEndLine: number
}

/**
 * Groups consecutive text document changes together based on line overlap.
 * This function helps create more meaningful diffs by combining related changes that occur on overlapping lines.
 *
 * For example, when a user types multiple characters or performs multiple edits in the same area of text,
 * these changes are grouped together as a single logical change instead of being treated as separate changes.
 *
 * @param changes - Array of individual text document changes to be grouped
 * @returns Array of TextDocumentChangeGroup objects, each containing related changes and their combined line range
 *
 * The predicate used for grouping checks if:
 * - The original ranges of two changes overlap (for modifications/deletions)
 * - The inserted range of the first change overlaps with the original range of the second change
 * This ensures that changes affecting the same or adjacent lines are grouped together.
 */
export function groupChangesForSimilarLinesTogether(
    changes: TextDocumentChange[]
): TextDocumentChangeGroup[] {
    if (changes.length === 0) {
        return []
    }
    const groupedChanges = groupConsecutiveItemsByPredicate(
        changes,
        (lastChange: TextDocumentChange, change: TextDocumentChange) => {
            return (
                doesLinesOverlapForRanges(lastChange.change.range, change.change.range) ||
                doesLinesOverlapForRanges(lastChange.insertedRange, change.change.range)
            )
        }
    )
    return groupedChanges.map(currentGroup => {
        const range = getMinMaxRangeLines(currentGroup)
        return {
            changes: currentGroup,
            changeStartLine: range[0],
            changeEndLine: range[1],
        }
    })
}

/**
 * Combines consecutive text document change groups that have non-overlapping line ranges.
 * The function can generally be called after `groupChangesForSimilarLinesTogether` to further consolidate changes.
 *
 * This function takes an array of `TextDocumentChangeGroup` objects and merges consecutive groups
 * where their line ranges do not overlap. By combining these non-overlapping groups, it creates
 * larger groups of changes that can be processed together, even if they affect different parts
 * of the document, as long as they occurred consecutively.
 *
 * @param groupedChanges - Array of `TextDocumentChangeGroup` objects to be combined.
 * @returns Array of `TextDocumentChangeGroup` objects where consecutive non-overlapping groups have been merged.
 *
 * The predicate used for grouping checks if:
 * - The line ranges of two groups do not overlap.
 *   - Specifically, it checks that `a.changeStartLine` to `a.changeEndLine` does not overlap with `b.changeStartLine` to `b.changeEndLine`.
 * This ensures that consecutive groups with non-overlapping line ranges are combined together.
 */
export function combineNonOverlappingLinesSchemaTogether(
    groupedChanges: TextDocumentChangeGroup[]
): TextDocumentChangeGroup[] {
    if (groupedChanges.length === 0) {
        return []
    }
    const combinedGroups = groupConsecutiveItemsByPredicate(
        groupedChanges,
        (a: TextDocumentChangeGroup, b: TextDocumentChangeGroup) => {
            return !doLineSpansOverlap(
                a.changeStartLine,
                a.changeEndLine,
                b.changeStartLine,
                b.changeEndLine
            )
        }
    )
    return combinedGroups.map(changes => ({
        changes: changes.flatMap(change => change.changes),
        changeStartLine: Math.min(...changes.map(change => change.changeStartLine)),
        changeEndLine: Math.max(...changes.map(change => change.changeEndLine)),
    }))
}

function getMinMaxRangeLines(documentChanges: TextDocumentChange[]): [number, number] {
    let minLine = Number.POSITIVE_INFINITY
    let maxLine = Number.NEGATIVE_INFINITY
    for (const change of documentChanges) {
        const ranges = [change.change.range, change.insertedRange]
        for (const range of ranges) {
            minLine = Math.min(minLine, range.start.line)
            maxLine = Math.max(maxLine, range.end.line)
        }
    }
    return [minLine, maxLine]
}

/**
 * Utility function to combine consecutive items in an array based on a predicate.
 */
export function groupConsecutiveItemsByPredicate<T>(
    items: T[],
    shouldGroup: (a: T, b: T) => boolean
): T[][] {
    return items.reduce<T[][]>((groups, item) => {
        if (groups.length === 0) {
            groups.push([item])
        } else {
            const lastGroup = groups[groups.length - 1]
            const lastItem = lastGroup[lastGroup.length - 1]
            if (shouldGroup(lastItem, item)) {
                lastGroup.push(item)
            } else {
                groups.push([item])
            }
        }
        return groups
    }, [])
}

export function computeDiffWithLineNumbers(
    uri: vscode.Uri,
    originalContent: string,
    modifiedContent: string,
    numContextLines: number
): PromptString {
    const hunkDiffs = []
    const filename = displayPath(uri)
    const patch = structuredPatch(
        `a/${filename}`,
        `b/${filename}`,
        originalContent,
        modifiedContent,
        '',
        '',
        { context: numContextLines }
    )
    for (const hunk of patch.hunks) {
        const diffString = getDiffStringForHunkWithLineNumbers(hunk)
        hunkDiffs.push(diffString)
    }
    const gitDiff = PromptString.fromStructuredGitDiff(uri, hunkDiffs.join('\nthen\n'))
    return gitDiff
}

export function getDiffStringForHunkWithLineNumbers(hunk: Diff.Hunk): string {
    const lines = []
    let oldLineNumber = hunk.oldStart
    let newLineNumber = hunk.newStart
    for (const line of hunk.lines) {
        if (line.length === 0) {
            continue
        }
        if (line[0] === '-') {
            lines.push(`${oldLineNumber}${line[0]}| ${line.slice(1)}`)
            oldLineNumber++
        } else if (line[0] === '+') {
            lines.push(`${newLineNumber}${line[0]}| ${line.slice(1)}`)
            newLineNumber++
        } else if (line[0] === ' ') {
            lines.push(`${newLineNumber}${line[0]}| ${line.slice(1)}`)
            oldLineNumber++
            newLineNumber++
        }
    }
    return lines.join('\n')
}

export function applyTextDocumentChanges(
    content: string,
    changes: vscode.TextDocumentContentChangeEvent[]
): string {
    for (const change of changes) {
        content =
            content.slice(0, change.rangeOffset) +
            change.text +
            content.slice(change.rangeOffset + change.rangeLength)
    }
    return content
}

export function doesLinesOverlapForRanges(a: vscode.Range, b: vscode.Range): boolean {
    return doLineSpansOverlap(a.start.line, a.end.line, b.start.line, b.end.line)
}

function doLineSpansOverlap(
    firstStart: number,
    firstEnd: number,
    secondStart: number,
    secondEnd: number
): boolean {
    return firstStart <= secondEnd && firstEnd >= secondStart
}
