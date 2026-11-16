/** These upstream fields return complete lists and accept no pagination argument. */
export function paginateTargetLists(
  data: unknown, paths: string[], index: number, size: number, root = 'target',
): unknown {
  const result = structuredClone(data);
  for (const path of paths) {
    const keys = [root, ...path.split('.')];
    let parent: unknown = result;
    for (const key of keys.slice(0, -1)) {
      parent = parent && typeof parent === 'object' ? (parent as Record<string, unknown>)[key] : undefined;
    }
    const key = keys[keys.length - 1];
    if (parent && typeof parent === 'object') {
      const record = parent as Record<string, unknown>;
      if (Array.isArray(record[key])) record[key] = record[key].slice(index * size, (index + 1) * size);
    }
  }
  return result;
}
