declare module 'pdfmake/build/pdfmake' {
  interface PdfMakeInstance {
    createPdf(docDefinition: Record<string, any>): {
      download(filename?: string): void;
      getBlob(cb: (blob: Blob) => void): void;
      getBuffer(cb: (buffer: Uint8Array) => void): void;
    };
    virtualfs: {
      storage: Record<string, any>;
      writeFileSync(filename: string, data: any, encoding?: string): void;
      readFileSync(filename: string): any;
    };
    fonts: Record<string, Record<string, string>>;
    /** Register font file data into the virtual filesystem. */
    addVirtualFileSystem(vfs: Record<string, any>): void;
    /** Register both vfs entries and font descriptors from a font container. */
    addFontContainer(container: { vfs: Record<string, any>; fonts: Record<string, any> }): void;
    addFonts(fonts: Record<string, any>): void;
  }
  const pdfMake: PdfMakeInstance;
  export default pdfMake;
  export = pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  // Side-effect import — populates pdfmake's virtualfs.storage with Roboto fonts
}

declare module 'pdfmake/build/standard-fonts/Courier' {
  export const vfs: Record<string, { data: string; encoding: string } | string>;
  export const fonts: Record<string, Record<string, string>>;
}
