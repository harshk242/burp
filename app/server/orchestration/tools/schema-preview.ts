import { appConfig } from "../../config";

interface PreviewOpts {
  maxSampleItems?: number;
  maxCharsPerValue?: number;
}

export function generatePreview(
  artifactId: string,
  toolName: string,
  data: unknown,
  rawSizeKb: number,
  storedSizeKb: number,
  opts?: PreviewOpts,
): object {
  const cfg = appConfig.artifact;
  const maxSampleItems = opts?.maxSampleItems ?? cfg.preview_sample_items;
  const maxCharsPerValue = opts?.maxCharsPerValue ?? cfg.preview_max_chars_per_value;

  const preview = introspect(data, 0, maxSampleItems, maxCharsPerValue);

  return {
    _meta: {
      artifact_id: artifactId,
      raw_size_kb: Math.round(rawSizeKb),
      stored_size_kb: Math.round(storedSizeKb),
      tool: toolName,
      hint: "Use system__inspect_artifact with a jq filter to extract specific fields from this data.",
    },
    ...((typeof preview === "object" && preview !== null && !Array.isArray(preview))
      ? preview
      : { data: preview }),
  };
}

const MAX_DEPTH = 3;

function introspect(
  value: unknown,
  depth: number,
  maxSampleItems: number,
  maxCharsPerValue: number,
): unknown {
  if (value === null || value === undefined) return null;

  if (typeof value === "string") {
    return truncateString(value, maxCharsPerValue);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return introspectArray(value, depth, maxSampleItems, maxCharsPerValue);
  }

  if (typeof value === "object") {
    return introspectObject(
      value as Record<string, unknown>,
      depth,
      maxSampleItems,
      maxCharsPerValue,
    );
  }

  return String(value);
}

function introspectArray(
  arr: unknown[],
  depth: number,
  maxSampleItems: number,
  maxCharsPerValue: number,
): unknown {
  if (arr.length === 0) return { _type: "array", _length: 0 };

  if (depth >= MAX_DEPTH) {
    return summarizeArray(arr);
  }

  const result: Record<string, unknown> = {
    _type: "array",
    _length: arr.length,
  };

  const itemKeys = collectUniqueKeys(arr);
  if (itemKeys.length > 0) {
    result._item_keys = itemKeys;
  }

  if (itemKeys.length === 0) {
    const types = new Set<string>();
    for (const item of arr.slice(0, 10)) {
      types.add(typeof item);
    }
    result._item_types = [...types];
  }

  const samples = arr.slice(0, maxSampleItems).map((item) =>
    introspect(item, depth + 1, maxSampleItems, maxCharsPerValue),
  );
  if (samples.length > 0) {
    result._sample_items = samples;
  }

  return result;
}

function introspectObject(
  obj: Record<string, unknown>,
  depth: number,
  maxSampleItems: number,
  maxCharsPerValue: number,
): unknown {
  if (depth >= MAX_DEPTH) {
    return summarizeObject(obj);
  }

  const result: Record<string, unknown> = {};
  const keys = Object.keys(obj);

  for (const key of keys) {
    const val = obj[key];

    if (val === null || val === undefined) continue;

    if (Array.isArray(val)) {
      if (val.length === 0) {
        result[key] = { _type: "array", _length: 0 };
      } else if (depth + 1 >= MAX_DEPTH) {
        result[key] = summarizeArray(val);
      } else {
        result[key] = introspectArray(
          val,
          depth + 1,
          maxSampleItems,
          maxCharsPerValue,
        );
      }
    } else if (typeof val === "object") {
      if (depth + 1 >= MAX_DEPTH) {
        result[key] = summarizeObject(val as Record<string, unknown>);
      } else {
        result[key] = introspectObject(
          val as Record<string, unknown>,
          depth + 1,
          maxSampleItems,
          maxCharsPerValue,
        );
      }
    } else if (typeof val === "string") {
      result[key] = truncateString(val, maxCharsPerValue);
    } else {
      result[key] = val;
    }
  }

  return result;
}

function collectUniqueKeys(arr: unknown[]): string[] {
  const keySet = new Set<string>();

  for (const item of arr.slice(0, 20)) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      for (const key of Object.keys(item)) {
        keySet.add(key);
      }
    }
  }

  return [...keySet];
}

function summarizeArray(arr: unknown[]): string {
  if (arr.length === 0) return "_array(0)";

  const sampleTypes = new Set<string>();
  for (const item of arr.slice(0, 5)) {
    if (typeof item === "object" && item !== null && !Array.isArray(item)) {
      const keys = Object.keys(item);
      const typeHints = keys.slice(0, 3).join(", ");
      sampleTypes.add(`object{${typeHints}}`);
    } else if (Array.isArray(item)) {
      sampleTypes.add(`array(${item.length})`);
    } else {
      sampleTypes.add(typeof item);
    }
  }

  const typeStr = [...sampleTypes].join(", ");
  return `_array(${arr.length}) ${typeStr}`;
}

function summarizeObject(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj);
  const preview = keys.slice(0, 5).join(", ");
  const suffix = keys.length > 5 ? `, +${keys.length - 5} more` : "";
  return `_object(${keys.length} keys: ${preview}${suffix})`;
}

function truncateString(str: string, maxChars: number): string {
  if (str.length <= maxChars) return str;
  return `${str.slice(0, maxChars)}...(${str.length} chars)`;
}
