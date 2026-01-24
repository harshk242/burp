/**
 * Retrieve adverse event signals associated with a drug.
 */
export declare function getDrugAdverseEvents(chemblId: string, pageIndex?: number, pageSize?: number): Promise<unknown>;
/**
 * Summarise high-level pharmacovigilance data for a drug.
 */
export declare function getDrugPharmacovigilance(chemblId: string): Promise<unknown>;
/**
 * Fetch detailed regulatory warnings, including withdrawals and boxed labels.
 */
export declare function getDrugWarnings(chemblId: string): Promise<unknown>;
//# sourceMappingURL=safety.d.ts.map