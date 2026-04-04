/**
 * PDF export utility using html2pdf.js (client-side, html2canvas + jsPDF).
 *
 * Captures a rendered DOM element as a print-friendly PDF.
 * Reasoning blocks and action bars are excluded via the onclone callback.
 */

function sanitizeFilename(title: string): string {
  const sanitized = title
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 100);
  return sanitized || "chat-export";
}

export interface ExportResult {
  success: boolean;
  error?: string;
}

export async function exportMessageAsPdf(
  element: HTMLElement,
  title: string
): Promise<ExportResult> {
  try {
    // Dynamic import — html2pdf.js uses browser APIs (canvas, DOM)
    // and must never be loaded on the server.
    const html2pdf = (await import("html2pdf.js")).default;

    const filename = `${sanitizeFilename(title)}.pdf`;

    await html2pdf()
      .from(element)
      .set({
        margin: 10,
        filename,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          onclone: (clonedDoc: Document) => {
            // Exclude reasoning blocks from PDF
            clonedDoc.querySelectorAll(".reasoning-block").forEach((el) => {
              (el as HTMLElement).style.display = "none";
            });
            // Exclude action bars (copy/download buttons)
            clonedDoc.querySelectorAll(".action-bar").forEach((el) => {
              (el as HTMLElement).style.display = "none";
            });
            // Exclude expanded tool call detail cards (keep summary header)
            clonedDoc.querySelectorAll(".tool-call-details").forEach((el) => {
              (el as HTMLElement).style.display = "none";
            });
            // Force light background for print-friendly output
            clonedDoc.body.style.background = "#ffffff";
            clonedDoc.body.style.color = "#000000";
          },
        },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      })
      .save();

    return { success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[exportPdf] PDF export failed:", error);
    return { success: false, error };
  }
}
