import { LINK_BLUE, CODE_BG, BLOCKQUOTE_BORDER } from './styles';

interface Root {
  type: 'root';
  children: any[];
}

type PdfContent = Record<string, any> | string;

export function mdastToPdfmakeContent(tree: Root): PdfContent[] {
  return tree.children.map(convertNode).filter(Boolean) as PdfContent[];
}

function convertNode(node: any): PdfContent | null {
  switch (node.type) {
    case 'heading': {
      const level = Math.min(node.depth as number, 4);
      return {
        text: convertInline(node.children),
        style: `h${level}`,
      };
    }

    case 'paragraph': {
      return {
        text: convertInline(node.children),
        style: 'body',
        margin: [0, 4, 0, 4],
      };
    }

    case 'list': {
      const items = node.children.map(convertListItem);
      return node.ordered
        ? { ol: items, margin: [0, 4, 0, 4] }
        : { ul: items, margin: [0, 4, 0, 4] };
    }

    case 'blockquote': {
      const children = node.children.map(convertNode).filter(Boolean);
      return {
        table: {
          widths: ['*'],
          body: [
            [
              {
                stack: children,
                margin: [16, 4, 0, 4],
                border: [true, false, false, false],
                borderColor: [
                  BLOCKQUOTE_BORDER,
                  BLOCKQUOTE_BORDER,
                  BLOCKQUOTE_BORDER,
                  BLOCKQUOTE_BORDER,
                ],
                fillColor: '#f9fafb',
              },
            ],
          ],
        },
        layout: { defaultBorder: false },
        margin: [0, 4, 0, 8],
      };
    }

    case 'code': {
      return {
        table: {
          widths: ['*'],
          body: [
            [
              {
                text: node.value as string,
                font: 'Courier',
                fontSize: 9,
                fillColor: CODE_BG,
                margin: [8, 6, 8, 6],
                border: [false, false, false, false],
              },
            ],
          ],
        },
        layout: 'noBorders',
        margin: [0, 4, 0, 8],
      };
    }

    case 'table': {
      const [headerRow, ...dataRows] = node.children as any[];
      const header = (headerRow.children as any[]).map((cell: any) => ({
        text: convertInline(cell.children),
        style: 'tableHeader',
        margin: [4, 4, 4, 4],
      }));
      const rows = dataRows.map((row: any) =>
        (row.children as any[]).map((cell: any) => ({
          text: convertInline(cell.children),
          fontSize: 10,
          margin: [4, 3, 4, 3],
        }))
      );
      return {
        table: {
          headerRows: 1,
          widths: Array((headerRow.children as any[]).length).fill('*'),
          body: [header, ...rows],
        },
        layout: 'lightHorizontalLines',
        margin: [0, 6, 0, 6],
      };
    }

    case 'thematicBreak': {
      return {
        canvas: [
          {
            type: 'line',
            x1: 0,
            y1: 0,
            x2: 515,
            y2: 0,
            lineWidth: 1,
            lineColor: '#e5e7eb',
          },
        ],
        margin: [0, 6, 0, 6],
      };
    }

    case 'html':
      return null;

    default: {
      console.warn(`[mdastToPdfmake] unhandled node: ${node.type}`);
      if (typeof node.value === 'string') {
        return { text: node.value, style: 'body' };
      }
      if (Array.isArray(node.children)) {
        const stack = node.children.map(convertNode).filter(Boolean);
        return stack.length > 0 ? { stack } : null;
      }
      return null;
    }
  }
}

function convertListItem(node: any): PdfContent {
  const children = node.children.map(convertNode).filter(Boolean) as PdfContent[];

  if (children.length === 1) {
    const first = children[0];
    if (
      typeof first === 'object' &&
      first !== null &&
      (first as any).style === 'body'
    ) {
      const inline = (first as any).text;
      // Always wrap in { text } so pdfmake keeps mixed inline parts
      // (e.g. bold + plain) on the same line instead of stacking them.
      if (typeof inline === 'string') return inline;
      return { text: inline };
    }
  }

  return { stack: children };
}

function convertInline(nodes: any[]): PdfContent | PdfContent[] {
  if (!nodes || nodes.length === 0) return '';
  const result = nodes.map(convertInlineNode).filter(Boolean) as PdfContent[];
  if (result.length === 1) return result[0];
  return result;
}

function convertInlineNode(node: any): PdfContent | null {
  switch (node.type) {
    case 'text':
      return node.value as string;

    case 'strong':
      return { text: convertInline(node.children), bold: true };

    case 'emphasis':
      return { text: convertInline(node.children), italics: true };

    case 'delete':
      return { text: convertInline(node.children), decoration: 'lineThrough' };

    case 'inlineCode':
      return {
        text: node.value as string,
        font: 'Courier',
        background: CODE_BG,
        fontSize: 9,
      };

    case 'link':
      return {
        text: convertInline(node.children),
        link: node.url as string,
        color: LINK_BLUE,
        decoration: 'underline',
      };

    case 'break':
      return '\n';

    case 'image':
      return node.alt ? `[Image: ${node.alt as string}]` : '[Image]';

    default: {
      console.warn(`[mdastToPdfmake] unhandled inline node: ${node.type}`);
      if (typeof node.value === 'string') return node.value;
      if (Array.isArray(node.children)) {
        return { text: convertInline(node.children) };
      }
      return null;
    }
  }
}
