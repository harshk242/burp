/**
 * ClinicalTrials.gov API v2 has no per-field `filter.*` params (`filter.phase`,
 * `filter.sex`, `filter.stdAge`, ... are all rejected with HTTP 400). Field
 * filters must go through `filter.advanced` as Essie `AREA[Field]value`
 * expressions, AND-joined.
 */

type Clause = string | undefined;

/** Characters that would break out of an Essie expression. */
function sanitize(value: unknown): string {
  return String(value).replace(/[[\]()"]/g, ' ').replace(/\s+/g, ' ').trim();
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

export function area(field: string, value: unknown): Clause {
  return present(value) ? `AREA[${field}]${sanitize(value)}` : undefined;
}

/** Free-text match inside one field, e.g. eligibility criteria keywords. */
export function areaText(field: string, text: unknown): Clause {
  const clean = present(text) ? sanitize(text) : '';
  return clean ? `AREA[${field}](${clean})` : undefined;
}

export function range(field: string, from?: unknown, to?: unknown): Clause {
  if (!present(from) && !present(to)) return undefined;
  const lo = present(from) ? sanitize(from) : 'MIN';
  const hi = present(to) ? sanitize(to) : 'MAX';
  return `AREA[${field}]RANGE[${lo},${hi}]`;
}

/**
 * Studies that accept the given sex. A FEMALE/MALE request also matches
 * studies open to ALL; ALL (or unset) adds no restriction.
 */
export function sexEligible(sex: unknown): Clause {
  if (sex !== 'FEMALE' && sex !== 'MALE') return undefined;
  return `AREA[Sex](${sex} OR ALL)`;
}

/**
 * Studies whose age eligibility window overlaps [from, to] (e.g. "2 Years").
 * A missing MinimumAge/MaximumAge on the study means no limit on that side.
 */
export function ageOverlap(from?: unknown, to?: unknown): Clause[] {
  const clauses: Clause[] = [];
  if (present(to)) {
    clauses.push(`(${range('MinimumAge', undefined, to)} OR AREA[MinimumAge]MISSING)`);
  }
  if (present(from)) {
    clauses.push(`(${range('MaximumAge', from, undefined)} OR AREA[MaximumAge]MISSING)`);
  }
  return clauses;
}

/** Sets `filter.advanced` on params from the non-empty clauses (AND-joined). */
export function applyAdvancedFilter(
  params: Record<string, unknown>,
  clauses: Array<Clause | Clause[]>,
): Record<string, unknown> {
  const parts = clauses.flat().filter((c): c is string => !!c);
  if (parts.length) params['filter.advanced'] = parts.join(' AND ');
  return params;
}
