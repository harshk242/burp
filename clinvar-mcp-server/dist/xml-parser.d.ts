import type { VariantInfo, VCVRecord, SubmissionRecord } from './types.js';
/**
 * Parse ESearch response for ClinVar
 */
export declare function parseESearchResult(xml: string): {
    count: number;
    idList: string[];
};
/**
 * Parse ClinVar VCV (Variation) record from EFetch
 */
export declare function parseVCVRecord(xml: string): VCVRecord[];
/**
 * Parse ESummary response for ClinVar
 */
export declare function parseESummaryResult(xml: string): VariantInfo[];
/**
 * Parse submission records from VCV
 */
export declare function parseSubmissions(vcvRecord: VCVRecord): SubmissionRecord[];
//# sourceMappingURL=xml-parser.d.ts.map