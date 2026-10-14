import { NCBIAPIError } from './exceptions.js';
import type { PopulationFrequency, VariantFrequencyResult } from './types.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NCBIAPIError('Invalid ClinVar frequency summary');
  }
  return value as Record<string, unknown>;
}

export function decodeFrequencySummary(value: unknown, variationId: string): VariantFrequencyResult {
  const response = record(value);
  if (response.error) throw new NCBIAPIError(String(response.error));
  const result = record(response.result);
  const summary = record(result[variationId]);
  if (summary.error) throw new NCBIAPIError(String(summary.error));
  if (!Array.isArray(summary.variation_set)) {
    throw new NCBIAPIError('Missing ClinVar variation_set');
  }
  const frequencies = summary.variation_set.flatMap((value): PopulationFrequency[] => {
    const variation = record(value);
    if (variation.allele_freq_set === undefined) return [];
    if (!Array.isArray(variation.allele_freq_set)) {
      throw new NCBIAPIError('Invalid ClinVar allele_freq_set');
    }
    return variation.allele_freq_set.map((value): PopulationFrequency => {
      const frequency = record(value);
      const alleleFrequency = typeof frequency.value === 'number'
        ? frequency.value
        : typeof frequency.value === 'string' && frequency.value.trim()
          ? Number(frequency.value) : NaN;
      if (typeof frequency.source !== 'string' || !frequency.source ||
          !Number.isFinite(alleleFrequency) || alleleFrequency < 0 || alleleFrequency > 1) {
        throw new NCBIAPIError('Invalid ClinVar allele frequency');
      }
      return {
        source: frequency.source,
        alleleFrequency,
        ...(typeof frequency.minor_allele === 'string' && frequency.minor_allele
          ? { minorAllele: frequency.minor_allele } : {}),
        ...(typeof variation.measure_id === 'string' ? { measureId: variation.measure_id } : {}),
      };
    });
  });
  return { variationId, hasFrequencyData: frequencies.length > 0, frequencies };
}
