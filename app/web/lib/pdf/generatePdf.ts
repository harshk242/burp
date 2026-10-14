import { PAGE_MARGINS, pdfStyles, buildTitleBlock, buildFooter } from './styles';
import { mdastToPdfmakeContent } from './mdastToPdfmake';

function sanitizeFilename(title: string): string {
  const sanitized = title
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 100);
  return sanitized || 'chat-export';
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
  const pdfMake = (pdfMod as any).default ?? pdfMod;
  const remarkParse = (remarkParseMod as any).default ?? remarkParseMod;
  const { unified } = unifiedMod as any;
  const remarkGfm = (remarkGfmMod as any).default ?? remarkGfmMod;

  // vfs_fonts.js only self-registers when window.pdfMake exists (UMD side-effect).
  // In Next.js's webpack module system pdfmake is never on window, so we must
  // call addVirtualFileSystem() ourselves with the exported vfs object.
  const robotoVfs = (vfsFontsMod as any).default ?? vfsFontsMod;
  pdfMake.addVirtualFileSystem(robotoVfs);

  const courier = (courierMod as any).default ?? courierMod;
  pdfMake.addFontContainer(courier);

  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);

  const body = mdastToPdfmakeContent(tree as any);

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
