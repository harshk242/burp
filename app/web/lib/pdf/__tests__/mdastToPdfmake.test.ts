import { describe, it, expect } from 'bun:test';
import { mdastToPdfmakeContent } from '../mdastToPdfmake';

interface Root {
  type: 'root';
  children: any[];
}

function makeRoot(...children: any[]): Root {
  return { type: 'root', children } as Root;
}

function text(value: string) {
  return { type: 'text', value };
}

describe('headings', () => {
  it('converts h1', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({ type: 'heading', depth: 1, children: [text('Title')] })
    );
    expect(result).toHaveLength(1);
    expect((result[0] as any).style).toBe('h1');
    expect((result[0] as any).text).toBe('Title');
  });

  it('converts h2', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({ type: 'heading', depth: 2, children: [text('Section')] })
    );
    expect((result[0] as any).style).toBe('h2');
  });

  it('converts h3', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({ type: 'heading', depth: 3, children: [text('Sub')] })
    );
    expect((result[0] as any).style).toBe('h3');
  });

  it('converts h4 and clamps deeper headings to h4', () => {
    const h4 = mdastToPdfmakeContent(
      makeRoot({ type: 'heading', depth: 4, children: [text('Deep')] })
    );
    const h5 = mdastToPdfmakeContent(
      makeRoot({ type: 'heading', depth: 5, children: [text('Deeper')] })
    );
    expect((h4[0] as any).style).toBe('h4');
    expect((h5[0] as any).style).toBe('h4');
  });
});

describe('paragraph with mixed inline', () => {
  it('produces { text: [...], style: body }', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'paragraph',
        children: [
          text('Hello '),
          { type: 'strong', children: [text('bold')] },
          text(' and '),
          { type: 'emphasis', children: [text('italic')] },
          text(' and '),
          { type: 'inlineCode', value: 'code()' },
          text(' and '),
          {
            type: 'link',
            url: 'https://example.com',
            children: [text('link')],
          },
        ],
      })
    );
    expect(result).toHaveLength(1);
    const p = result[0] as any;
    expect(p.style).toBe('body');
    expect(Array.isArray(p.text)).toBe(true);
    const inline = p.text as any[];
    expect(inline[0]).toBe('Hello ');
    expect(inline[1]).toMatchObject({ bold: true, text: 'bold' });
    expect(inline[3]).toMatchObject({ italics: true, text: 'italic' });
    expect(inline[5]).toMatchObject({ font: 'Courier', text: 'code()' });
    expect(inline[7]).toMatchObject({
      link: 'https://example.com',
      decoration: 'underline',
    });
  });
});

describe('lists', () => {
  it('converts unordered list to { ul }', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'list',
        ordered: false,
        children: [
          { type: 'listItem', children: [{ type: 'paragraph', children: [text('A')] }] },
          { type: 'listItem', children: [{ type: 'paragraph', children: [text('B')] }] },
        ],
      })
    );
    const list = result[0] as any;
    expect(list.ul).toBeDefined();
    expect(list.ul).toHaveLength(2);
    expect(list.ul[0]).toBe('A');
    expect(list.ul[1]).toBe('B');
  });

  it('converts ordered list to { ol }', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'list',
        ordered: true,
        children: [
          { type: 'listItem', children: [{ type: 'paragraph', children: [text('First')] }] },
        ],
      })
    );
    expect((result[0] as any).ol).toBeDefined();
  });

  it('handles nested list (2 levels)', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'list',
        ordered: false,
        children: [
          {
            type: 'listItem',
            children: [
              { type: 'paragraph', children: [text('Parent')] },
              {
                type: 'list',
                ordered: false,
                children: [
                  {
                    type: 'listItem',
                    children: [{ type: 'paragraph', children: [text('Child')] }],
                  },
                ],
              },
            ],
          },
        ],
      })
    );
    const outer = result[0] as any;
    expect(outer.ul).toBeDefined();
    const item = outer.ul[0] as any;
    expect(item.stack).toBeDefined();
    const nestedList = item.stack[1] as any;
    expect(nestedList.ul).toBeDefined();
    expect(nestedList.ul[0]).toBe('Child');
  });

  it('keeps mixed bold+plain inline on one line (wraps in { text })', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'list',
        ordered: false,
        children: [
          {
            type: 'listItem',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'strong', children: [text('ERLOTINIB')] },
                  text(' (CHEMBL553) - Approved 2004; oral TKI'),
                ],
              },
            ],
          },
        ],
      })
    );
    const list = result[0] as any;
    const item = list.ul[0];
    expect(typeof item).toBe('object');
    expect(item).not.toBeNull();
    expect(item.text).toBeDefined();
    expect(Array.isArray(item.text)).toBe(true);
    expect(item.text[0]).toMatchObject({ bold: true, text: 'ERLOTINIB' });
    expect(item.text[1]).toBe(' (CHEMBL553) - Approved 2004; oral TKI');
  });
});

describe('table', () => {
  it('converts GFM table with headerRows: 1', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'table',
        children: [
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [text('Name')] },
              { type: 'tableCell', children: [text('Value')] },
            ],
          },
          {
            type: 'tableRow',
            children: [
              { type: 'tableCell', children: [text('Alpha')] },
              { type: 'tableCell', children: [text('1')] },
            ],
          },
        ],
      })
    );
    const tbl = result[0] as any;
    expect(tbl.table).toBeDefined();
    expect(tbl.table.headerRows).toBe(1);
    expect(tbl.table.body).toHaveLength(2);
    expect(tbl.table.body[0][0]).toMatchObject({ style: 'tableHeader' });
    expect(tbl.table.body[0][0].text).toBe('Name');
    expect(tbl.table.body[1][0].text).toBe('Alpha');
  });
});

describe('code block', () => {
  it('wraps in single-cell table with monospace font and grey bg', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({ type: 'code', lang: 'typescript', value: 'const x = 1;' })
    );
    const block = result[0] as any;
    expect(block.table).toBeDefined();
    const cell = block.table.body[0][0];
    expect(cell.font).toBe('Courier');
    expect(cell.fillColor).toBe('#f5f5f5');
    expect(cell.text).toBe('const x = 1;');
  });
});

describe('blockquote', () => {
  it('wraps content in left-border table cell', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'blockquote',
        children: [
          { type: 'paragraph', children: [text('Quote text')] },
        ],
      })
    );
    const bq = result[0] as any;
    expect(bq.table).toBeDefined();
    const cell = bq.table.body[0][0];
    expect(cell.border).toEqual([true, false, false, false]);
    expect(cell.stack).toBeDefined();
  });
});

describe('thematicBreak', () => {
  it('renders a canvas line', () => {
    const result = mdastToPdfmakeContent(makeRoot({ type: 'thematicBreak' }));
    const hr = result[0] as any;
    expect(hr.canvas).toBeDefined();
    expect(hr.canvas[0].type).toBe('line');
  });
});

describe('strikethrough', () => {
  it('converts delete node to lineThrough decoration', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'paragraph',
        children: [{ type: 'delete', children: [text('struck')] }],
      })
    );
    const p = result[0] as any;
    expect(p.text).toMatchObject({ decoration: 'lineThrough', text: 'struck' });
  });
});

describe('unknown node', () => {
  it('falls back to value extraction, no crash', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({ type: 'unknownBlock', value: 'raw content' } as any)
    );
    expect(result).toHaveLength(1);
    expect((result[0] as any).text).toBe('raw content');
  });

  it('falls back to child recursion, no crash', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'unknownContainer',
        children: [
          { type: 'paragraph', children: [text('inside')] },
        ],
      } as any)
    );
    expect(result).toHaveLength(1);
    expect((result[0] as any).stack).toBeDefined();
  });
});

describe('empty input', () => {
  it('returns an empty array for a root with no children', () => {
    const result = mdastToPdfmakeContent(makeRoot());
    expect(result).toHaveLength(0);
  });
});

describe('inline edge cases', () => {
  it('handles bold inside link', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'paragraph',
        children: [
          {
            type: 'link',
            url: 'https://a.com',
            children: [{ type: 'strong', children: [text('Bold Link')] }],
          },
        ],
      })
    );
    const p = result[0] as any;
    const link = Array.isArray(p.text) ? p.text[0] : p.text;
    expect(link.link).toBe('https://a.com');
    const innerText = Array.isArray(link.text) ? link.text[0] : link.text;
    expect(innerText).toMatchObject({ bold: true });
  });

  it('handles code inside paragraph (inlineCode)', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'paragraph',
        children: [{ type: 'inlineCode', value: 'fn()' }],
      })
    );
    const p = result[0] as any;
    expect(p.text).toMatchObject({ font: 'Courier', text: 'fn()' });
  });

  it('handles line break', () => {
    const result = mdastToPdfmakeContent(
      makeRoot({
        type: 'paragraph',
        children: [text('line1'), { type: 'break' }, text('line2')],
      })
    );
    const p = result[0] as any;
    expect(p.text[1]).toBe('\n');
  });
});
