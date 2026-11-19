import type PdfMake from 'pdfmake/build/pdfmake';
import { PAGE_MARGINS, pdfStyles, buildTitleBlock, buildFooter } from './styles';
import { mdastToPdfmakeContent, type Root } from './mdastToPdfmake';

function sanitizeFilename(title: string): string {
  const sanitized = title
    .trim()
    // oxlint-disable-next-line no-control-regex -- strips control characters, which are invalid in filenames
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return sanitized || 'chat-export';
}

/** Next.js may hand back a CJS/UMD module either as its exports or wrapped as { default: exports }. (remark-* are ESM, so their `default` is always set.) */
function interopDefault<T extends object>(mod: T & { default?: T }): T {
  return mod.default ?? mod;
}

export async function generatePdfFromMarkdown(
  markdown: string,
  title: string
): Promise<void> {
  const [pdfMod, vfsFontsMod, remarkParseMod, unifiedMod, remarkGfmMod, courierMod] =
    await Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
      import('remark-parse'),
      import('unified'),
      import('remark-gfm'),
      import('pdfmake/build/standard-fonts/Courier'),
    ]);

  // pdfmake is CJS — Next.js dynamic import wraps it as { default: cjsExports }.
  const pdfMake = interopDefault<typeof PdfMake>(pdfMod);
  const remarkParse = remarkParseMod.default;
  const { unified } = unifiedMod;
  const remarkGfm = remarkGfmMod.default;

  // vfs_fonts.js only self-registers when window.pdfMake exists (UMD side-effect).
  const robotoVfs = interopDefault<Record<string, unknown>>(vfsFontsMod);
  pdfMake.addVirtualFileSystem(robotoVfs);

  const courier = interopDefault<{ vfs: Record<string, unknown>; fonts: Record<string, unknown> }>(courierMod);
  pdfMake.addFontContainer(courier);

  // The converter reads a small subset of mdast fields (see MdNode).
  const tree: Root = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  const body = mdastToPdfmakeContent(tree);

  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const docDefinition = {
    pageMargins: PAGE_MARGINS,
    styles: pdfStyles,
    defaultStyle: {
      font: 'Roboto',
      fontSize: 11,
      lineHeight: 1.4,
    },
    footer: (currentPage: number, pageCount: number) =>
      buildFooter(currentPage, pageCount),
    info: {
      title,
      creator: 'BURP',
      producer: 'BURP / pdfmake',
    },
    content: [...buildTitleBlock(title, date), ...body],
  };

  pdfMake.createPdf(docDefinition).download(`${sanitizeFilename(title)}.pdf`);
}
