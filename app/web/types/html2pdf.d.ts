declare module "html2pdf.js" {
  interface Html2PdfOptions {
    margin?: number | [number, number, number, number];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: { scale?: number; useCORS?: boolean; [key: string]: unknown };
    jsPDF?: { unit?: string; format?: string; orientation?: string; [key: string]: unknown };
    pagebreak?: { mode?: string | string[] };
  }

  interface Html2PdfWorker {
    from(element: HTMLElement): Html2PdfWorker;
    set(options: Html2PdfOptions): Html2PdfWorker;
    save(): Promise<void>;
    outputPdf(type?: string): Promise<unknown>;
  }

  function html2pdf(): Html2PdfWorker;
  export = html2pdf;
}
