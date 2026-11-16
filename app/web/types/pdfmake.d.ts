declare module 'pdfmake/build/pdfmake' {
  interface PdfMakeInstance {
    createPdf(docDefinition: Record<string, unknown>): {
      download(filename?: string): void;
      getBlob(cb: (blob: Blob) => void): void;
      getBuffer(cb: (buffer: Uint8Array) => void): void;
    };
    virtualfs: {
      storage: Record<string, unknown>;
      writeFileSync(filename: string, data: unknown, encoding?: string): void;
      readFileSync(filename: string): unknown;
    };
    fonts: Record<string, Record<string, string>>;
    addVirtualFileSystem(vfs: Record<string, unknown>): void;
    addFontContainer(container: { vfs: Record<string, unknown>; fonts: Record<string, unknown> }): void;
    addFonts(fonts: Record<string, unknown>): void;
  }
  const pdfMake: PdfMakeInstance;
  export = pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
}

declare module 'pdfmake/build/standard-fonts/Courier' {
  export const vfs: Record<string, { data: string; encoding: string } | string>;
  export const fonts: Record<string, Record<string, string>>;
}
