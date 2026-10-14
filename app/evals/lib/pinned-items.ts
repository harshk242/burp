import { DatasetItemSchema, type DatasetItem } from "./schema";
import type { FetchedItem } from "./verify-dataset";

export class PinnedItemError extends Error {
  constructor(problems: string[]) {
    super(`pinned dataset item(s) do not match the dataset schema:\n${problems.map((p) => `  ${p}`).join("\n")}`);
    this.name = "PinnedItemError";
  }
}

function parsePinnedItem(item: FetchedItem): DatasetItem | string {
  const metadata = item.metadata && typeof item.metadata === "object" ? { ...(item.metadata as Record<string, unknown>) } : item.metadata;
  if (metadata && typeof metadata === "object") delete (metadata as Record<string, unknown>).content_hash;
  const parsed = DatasetItemSchema.safeParse({ id: item.id, input: item.input, expected_output: item.expectedOutput, metadata });
  if (parsed.success) return parsed.data;
  return `${item.id}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(item)"} ${i.message}`).join("; ")}`;
}

export function pinnedEvalItems(items: FetchedItem[]): Map<string, DatasetItem> {
  const parsed = new Map<string, DatasetItem>();
  const problems: string[] = [];
  for (const item of items) {
    const result = parsePinnedItem(item);
    if (typeof result === "string") problems.push(result);
    else parsed.set(item.id, result);
  }
  if (problems.length) throw new PinnedItemError(problems);
  return parsed;
}
