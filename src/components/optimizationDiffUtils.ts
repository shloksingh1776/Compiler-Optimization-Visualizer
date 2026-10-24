import {
  formatInstruction,
  tacInstructionsEqual,
  type TACFunction,
  type TACInstruction,
  type TACProgram,
} from '../compiler/index.ts';

export type OptimizationDiffRowStatus = 'unchanged' | 'changed' | 'removed' | 'added';

export interface OptimizationDiffRow {
  readonly status: OptimizationDiffRowStatus;
  readonly before: string | null;
  readonly after: string | null;
  readonly beforeIndex: number | null;
  readonly afterIndex: number | null;
  /** True if semantic TAC metadata changed but the printed instruction text did not. */
  readonly metadataOnly: boolean;
}

export interface OptimizationDiffCounts {
  readonly unchanged: number;
  readonly changed: number;
  readonly removed: number;
  readonly added: number;
}

export interface OptimizationDiffSection {
  readonly id: string;
  readonly title: string;
  readonly beforeFunction: TACFunction | null;
  readonly afterFunction: TACFunction | null;
  readonly rows: readonly OptimizationDiffRow[];
  readonly counts: OptimizationDiffCounts;
  readonly metadataChanged: boolean;
}

export interface OptimizationDiffResult {
  readonly sections: readonly OptimizationDiffSection[];
  readonly counts: OptimizationDiffCounts;
  readonly programMetadataChanged: boolean;
}

type EditOperation =
  | { readonly kind: 'equal'; readonly beforeIndex: number; readonly afterIndex: number }
  | { readonly kind: 'remove'; readonly beforeIndex: number }
  | { readonly kind: 'add'; readonly afterIndex: number };

function emptyCounts(): OptimizationDiffCounts {
  return { unchanged: 0, changed: 0, removed: 0, added: 0 };
}

function countRows(rows: readonly OptimizationDiffRow[]): OptimizationDiffCounts {
  const counts = { unchanged: 0, changed: 0, removed: 0, added: 0 };
  for (const row of rows) counts[row.status] += 1;
  return counts;
}

function appendGapRows(
  operations: readonly EditOperation[],
  before: readonly TACInstruction[],
  after: readonly TACInstruction[],
  rows: OptimizationDiffRow[],
): void {
  const removed = operations.filter((operation) => operation.kind === 'remove');
  const added = operations.filter((operation) => operation.kind === 'add');
  const pairedCount = Math.min(removed.length, added.length);

  // Pair instructions in the same unmatched region as rewrites. Remaining old/new
  // instructions are genuine removals/additions. The LCS anchors preserve order.
  for (let index = 0; index < pairedCount; index += 1) {
    const beforeIndex = (removed[index] as Extract<EditOperation, { kind: 'remove' }>).beforeIndex;
    const afterIndex = (added[index] as Extract<EditOperation, { kind: 'add' }>).afterIndex;
    const beforeText = formatInstruction(before[beforeIndex]!);
    const afterText = formatInstruction(after[afterIndex]!);
    rows.push({
      status: 'changed',
      before: beforeText,
      after: afterText,
      beforeIndex,
      afterIndex,
      metadataOnly: beforeText === afterText,
    });
  }
  for (let index = pairedCount; index < removed.length; index += 1) {
    const beforeIndex = (removed[index] as Extract<EditOperation, { kind: 'remove' }>).beforeIndex;
    rows.push({
      status: 'removed',
      before: formatInstruction(before[beforeIndex]!),
      after: null,
      beforeIndex,
      afterIndex: null,
      metadataOnly: false,
    });
  }
  for (let index = pairedCount; index < added.length; index += 1) {
    const afterIndex = (added[index] as Extract<EditOperation, { kind: 'add' }>).afterIndex;
    rows.push({
      status: 'added',
      before: null,
      after: formatInstruction(after[afterIndex]!),
      beforeIndex: null,
      afterIndex,
      metadataOnly: false,
    });
  }
}

/**
 * Ordered instruction diff using a longest-common-subsequence table. Matching is
 * structural (including variable scope) rather than based only on printed text;
 * sourceNodeId alone is deliberately ignored by `tacInstructionsEqual`.
 */
export function diffTACInstructions(
  before: readonly TACInstruction[],
  after: readonly TACInstruction[],
): readonly OptimizationDiffRow[] {
  const beforeLength = before.length;
  const afterLength = after.length;
  const lcs: Uint32Array[] = Array.from(
    { length: beforeLength + 1 },
    () => new Uint32Array(afterLength + 1),
  );

  for (let beforeIndex = beforeLength - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLength - 1; afterIndex >= 0; afterIndex -= 1) {
      lcs[beforeIndex]![afterIndex] = tacInstructionsEqual(before[beforeIndex]!, after[afterIndex]!)
        ? 1 + lcs[beforeIndex + 1]![afterIndex + 1]!
        : Math.max(lcs[beforeIndex + 1]![afterIndex]!, lcs[beforeIndex]![afterIndex + 1]!);
    }
  }

  const operations: EditOperation[] = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLength || afterIndex < afterLength) {
    if (
      beforeIndex < beforeLength
      && afterIndex < afterLength
      && tacInstructionsEqual(before[beforeIndex]!, after[afterIndex]!)
    ) {
      operations.push({ kind: 'equal', beforeIndex, afterIndex });
      beforeIndex += 1;
      afterIndex += 1;
    } else if (
      beforeIndex < beforeLength
      && (afterIndex >= afterLength || lcs[beforeIndex + 1]![afterIndex]! >= lcs[beforeIndex]![afterIndex + 1]!)
    ) {
      operations.push({ kind: 'remove', beforeIndex });
      beforeIndex += 1;
    } else {
      operations.push({ kind: 'add', afterIndex });
      afterIndex += 1;
    }
  }

  const rows: OptimizationDiffRow[] = [];
  let gap: EditOperation[] = [];
  const flushGap = () => {
    if (gap.length > 0) appendGapRows(gap, before, after, rows);
    gap = [];
  };

  for (const operation of operations) {
    if (operation.kind !== 'equal') {
      gap.push(operation);
      continue;
    }
    flushGap();
    const beforeText = formatInstruction(before[operation.beforeIndex]!);
    const afterText = formatInstruction(after[operation.afterIndex]!);
    rows.push({
      status: 'unchanged',
      before: beforeText,
      after: afterText,
      beforeIndex: operation.beforeIndex,
      afterIndex: operation.afterIndex,
      metadataOnly: false,
    });
  }
  flushGap();
  return rows;
}

function functionMetadataChanged(before: TACFunction | null, after: TACFunction | null): boolean {
  if (!before || !after) return before !== after;
  const beforeLocals = [...(before.localVariables ?? [])].sort();
  const afterLocals = [...(after.localVariables ?? [])].sort();
  return before.name !== after.name
    || before.returnType !== after.returnType
    || before.parameters.length !== after.parameters.length
    || before.parameters.some((parameter, index) => {
      const candidate = after.parameters[index];
      return !candidate || candidate.name !== parameter.name || candidate.type !== parameter.type;
    })
    || beforeLocals.length !== afterLocals.length
    || beforeLocals.some((name, index) => name !== afterLocals[index]);
}

function buildSection(
  id: string,
  title: string,
  beforeInstructions: readonly TACInstruction[],
  afterInstructions: readonly TACInstruction[],
  beforeFunction: TACFunction | null,
  afterFunction: TACFunction | null,
): OptimizationDiffSection {
  const rows = diffTACInstructions(beforeInstructions, afterInstructions);
  return {
    id,
    title,
    beforeFunction,
    afterFunction,
    rows,
    counts: countRows(rows),
    metadataChanged: functionMetadataChanged(beforeFunction, afterFunction),
  };
}

function sameStringSet(before: readonly string[] | undefined, after: readonly string[] | undefined): boolean {
  const left = [...(before ?? [])].sort();
  const right = [...(after ?? [])].sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Build honest before/after instruction diffs for the main program and all function bodies. */
export function buildOptimizationDiff(before: TACProgram, after: TACProgram): OptimizationDiffResult {
  const sections: OptimizationDiffSection[] = [buildSection(
    'main',
    'Main program',
    before.instructions,
    after.instructions,
    null,
    null,
  )];
  const beforeFunctions = before.functions ?? {};
  const afterFunctions = after.functions ?? {};
  const functionNames = [...new Set([...Object.keys(beforeFunctions), ...Object.keys(afterFunctions)])];

  for (const name of functionNames) {
    const beforeFunction = beforeFunctions[name] ?? null;
    const afterFunction = afterFunctions[name] ?? null;
    sections.push(buildSection(
      `function:${name}`,
      `Function: ${name}`,
      beforeFunction?.instructions ?? [],
      afterFunction?.instructions ?? [],
      beforeFunction,
      afterFunction,
    ));
  }

  const counts = sections.reduce((total, section) => ({
    unchanged: total.unchanged + section.counts.unchanged,
    changed: total.changed + section.counts.changed,
    removed: total.removed + section.counts.removed,
    added: total.added + section.counts.added,
  }), emptyCounts());

  return {
    sections,
    counts,
    programMetadataChanged: !sameStringSet(before.globalVariables, after.globalVariables),
  };
}
