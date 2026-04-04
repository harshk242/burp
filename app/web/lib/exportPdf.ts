/**
 * exportPdf.ts
 *
 * Thin public adapter. Converts a raw markdown string to a downloadable PDF
 * via pdfmake (no print dialog, text-selectable output).
 *
 * Heavy dependencies (pdfmake, fonts) are loaded lazily inside generatePdf so
 * they never appear in the main bundle.
 */

export interface ExportResult {
  success: boolean;
  error?: string;
}

export async function exportMessageAsPdf(
  content: string,
  title: string
): Promise<ExportResult> {
  try {
    const { generatePdfFromMarkdown } = await import('./pdf/generatePdf');
    await generatePdfFromMarkdown(content, title);
    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[exportPdf] PDF export failed:', error);
    return { success: false, error };
  }
}
