/** These upstream fields return complete lists and accept no pagination argument. */
export function paginateTargetLists(
  data: unknown, paths: string[], index: number, size: number, root = 'target',
): unknown {
  const result = structuredClone(data) as Record<string, any>;
  for (const path of paths) {
    const keys = path.split('.');
    let parent = result?.[root];
    for (const key of keys.slice(0, -1)) parent = parent?.[key];
    const key = keys[keys.length - 1];
    if (Array.isArray(parent?.[key])) parent[key] = parent[key].slice(index * size, (index + 1) * size);
  }
  return result;
}
