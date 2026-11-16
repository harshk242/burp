import { afterEach, describe, expect, it } from 'vitest';
import { assertHandlerCoverage } from '../../__test-utils__/tool-requests.js';
import { initClient, resetClient } from '../client.js';
import { handlers } from '../handlers.js';
import { tools } from '../tools.js';
import { blenrep, fakeApis, isembyld, label, page, spinraza, tentative, type Seen } from './fixtures.js';

type Result = Record<string, any>;

function setup(route: Parameters<typeof fakeApis>[0]): Seen[] {
  const { adapter, seen } = fakeApis(route);
  initClient({}, { adapter, retryDeps: { sleep: async () => {} } });
  return seen;
}

afterEach(resetClient);

it('has a handler for every advertised tool', () => assertHandlerCoverage(tools, handlers));

describe('search_fda_approvals', () => {
  it('searches Drugs@FDA by name across brand and ingredient fields, excluding generics by default', async () => {
    const seen = setup((config) => (config.url === '/drug/drugsfda.json' ? page([blenrep]) : undefined));
    const result = await handlers.search_fda_approvals!({ drug: 'Blenrep' }) as Result;

    expect(seen).toHaveLength(1);
    expect(seen[0]!.search).toContain('products.active_ingredients.name:"Blenrep"');
    expect(seen[0]!.search).toContain('openfda.brand_name:"Blenrep"');
    expect(seen[0]!.search).toContain('NOT application_number:ANDA*');
    expect(result.applications[0]).toMatchObject({
      application_number: 'BLA761440',
      application_type: 'BLA',
      brand_names: ['BLENREP'],
      in_drugs_at_fda: true,
      original_approval: { date: '2025-10-23', submission_class: 'Type 2 - New Active Ingredient', orphan: true },
      latest_approved_submission: { type: 'SUPPL', date: '2026-03-01' },
      marketing_status: ['Prescription'],
      approval_letter_url: 'https://example.test/letter.pdf',
      latest_label_pdf_url: 'https://example.test/new-label.pdf',
    });
    expect(result.data_last_updated).toBe('2026-11-13');
    expect(result.coverage_note).toContain('CBER');
  });

  it('includes generics only when asked', async () => {
    const seen = setup((config) => (config.url === '/drug/drugsfda.json' ? page([blenrep]) : undefined));
    await handlers.search_fda_approvals!({ drug: 'imatinib', include_generics: true });
    expect(seen[0]!.search).not.toContain('ANDA');
  });

  it('falls back to labels for products without a Drugs@FDA record (CBER biologics)', async () => {
    const seen = setup((config) =>
      config.url === '/drug/label.json' ? page([label('BLA125856', 'ITVISMA', 'spinal muscular atrophy')]) : undefined);
    const result = await handlers.search_fda_approvals!({ drug: 'Itvisma' }) as Result;

    expect(seen.map((s) => s.url)).toEqual(['/drug/drugsfda.json', '/drug/label.json', '/drug/drugsfda.json']);
    expect(result.applications[0]).toMatchObject({
      application_number: 'BLA125856', in_drugs_at_fda: false, original_approval: null,
      label: { set_id: 'set-BLA125856', effective_date: '2026-06-16' },
    });
    expect(result.applications[0].note).toContain('CBER');
  });

  it('finds every labelled drug for an indication and joins Drugs@FDA approval dates', async () => {
    const seen = setup((config, search) => {
      if (config.url === '/drug/label.json') {
        return page([
          label('BLA761463', 'ISEMBYLD', 'spinal muscular atrophy'),
          label('BLA125856', 'ITVISMA', 'spinal muscular atrophy'),
          label('NDA209531', 'SPINRAZA', 'spinal muscular atrophy'),
          label('NDA209531', 'SPINRAZA', 'older label'),
          { ...label('X', 'UNAPPROVED', 'spinal muscular atrophy'), openfda: {} },
        ], 140);
      }
      if (search.startsWith('application_number:(')) return page([spinraza, isembyld]);
      return undefined;
    });
    const result = await handlers.search_fda_approvals!({ indication: 'spinal muscular atrophy' }) as Result;

    expect(seen[0]!.search).toBe('indications_and_usage:"spinal muscular atrophy" AND _exists_:openfda.application_number AND NOT openfda.application_number:ANDA*');
    expect(seen[0]!.params.sort).toBe('effective_time:desc');
    expect(seen[1]!.search).toBe('application_number:(BLA761463 OR BLA125856 OR NDA209531)');
    expect(result.applications.map((a: Result) => [a.application_number, a.original_approval?.date ?? null])).toEqual([
      ['BLA761463', '2026-09-11'], ['NDA209531', '2016-12-23'], ['BLA125856', null],
    ]);
    expect(result.applications[0].label.indication_excerpt).toContain('spinal muscular atrophy');
    expect(result.notes.join(' ')).toMatch(/140 labels matched/);
    expect(result.notes.join(' ')).toMatch(/1 matching labels carry no FDA application number/);
  });

  it('filters by original approval date and reports undated applications it had to drop', async () => {
    setup((config) => (config.url === '/drug/drugsfda.json' ? page([blenrep, isembyld, spinraza, tentative]) : undefined));
    const result = await handlers.search_fda_approvals!({ approved_from: '2025-01-01', approved_to: '2026-12-31' }) as Result;

    expect(result.searched_by).toBe('approval_date');
    expect(result.applications.map((a: Result) => a.application_number)).toEqual(['BLA761463', 'BLA761440']);
    expect(result.notes.join(' ')).toContain('NDA220446');
  });

  it('builds a date-window scan when no drug or indication is given', async () => {
    const seen = setup(() => page([]));
    await handlers.search_fda_approvals!({ approved_from: '2026-09-01' });
    expect(seen[0]!.search).toBe('submissions.submission_type:ORIG AND submissions.submission_status_date:[20260901 TO 29991231] AND NOT application_number:ANDA*');
    expect(seen[0]!.params.limit).toBe(1000);
  });

  it('accepts bare application numbers by trying every application type', async () => {
    const seen = setup((config) => (config.url === '/drug/drugsfda.json' ? page([spinraza]) : undefined));
    await handlers.search_fda_approvals!({ application_number: '209531' });
    expect(seen[0]!.search).toBe('application_number:(NDA209531 OR BLA209531 OR ANDA209531)');
    await handlers.search_fda_approvals!({ application_number: 'nda 21588' });
    expect(seen[1]!.search).toBe('application_number:(NDA021588)');
  });

  it('labels tentative approvals as not approved', async () => {
    setup((config) => (config.url === '/drug/drugsfda.json' ? page([tentative]) : undefined));
    const result = await handlers.search_fda_approvals!({ drug: 'apixaban' }) as Result;
    expect(result.applications[0]).toMatchObject({ original_approval: null });
    expect(result.applications[0].note).toMatch(/Tentative approval/);
  });

  it('treats openFDA NOT_FOUND as an empty result', async () => {
    setup(() => undefined);
    const result = await handlers.search_fda_approvals!({ drug: 'notarealdrug' }) as Result;
    expect(result).toMatchObject({ total_applications: 0, applications: [] });
  });

  it('applies the limit after sorting newest first', async () => {
    setup((config) => (config.url === '/drug/drugsfda.json' ? page([spinraza, blenrep, isembyld]) : undefined));
    const result = await handlers.search_fda_approvals!({ drug: 'x', limit: 2 }) as Result;
    expect(result).toMatchObject({ total_applications: 3, returned: 2 });
    expect(result.applications.map((a: Result) => a.application_number)).toEqual(['BLA761463', 'BLA761440']);
  });

  it.each([
    [{ drug: 'a', indication: 'b' }, /only one of/],
    [{}, /Give one of/],
    [{ drug: 'a', approved_from: '2026/01/01' }, /YYYY-MM-DD/],
    [{ drug: 'a', limit: 0 }, /limit/],
    [{ application_number: 'XYZ' }, /application_number/],
    [{ drug: '""' }, /empty/],
  ])('rejects invalid arguments %j', async (args, message) => {
    setup(() => page([]));
    await expect(handlers.search_fda_approvals!(args)).rejects.toThrow(message);
  });
});

describe('get_fda_label', () => {
  const xeljanz = label('NDA203214', 'XELJANZ', 'rheumatoid arthritis', {
    boxed_warning: ['WARNING: SERIOUS INFECTIONS, MORTALITY, MALIGNANCY, MAJOR ADVERSE CARDIOVASCULAR EVENTS, and THROMBOSIS'],
    contraindications: ['4 CONTRAINDICATIONS None.'],
  });

  it('returns the requested sections of the newest innovator label', async () => {
    const seen = setup((config) => (config.url === '/drug/label.json' ? page([xeljanz], 2) : undefined));
    const result = await handlers.get_fda_label!({ drug: 'Xeljanz' }) as Result;

    expect(seen[0]!.search).toContain('NOT openfda.application_number:ANDA*');
    expect(result.label).toMatchObject({ application_numbers: ['NDA203214'], effective_date: '2026-06-16', dailymed_url: expect.stringContaining('set-NDA203214') });
    expect(result.sections.boxed_warning.text).toContain('MAJOR ADVERSE CARDIOVASCULAR EVENTS');
    expect(result.sections.recent_major_changes).toBeNull();
    expect(result.absent_sections).toEqual(['recent_major_changes']);
    expect(result.other_matching_labels.total).toBe(1);
  });

  it('truncates long sections and reports their full length', async () => {
    setup((config) => (config.url === '/drug/label.json' ? page([xeljanz]) : undefined));
    const result = await handlers.get_fda_label!({ drug: 'Xeljanz', sections: ['boxed_warning'], max_chars_per_section: 200 }) as Result;
    expect(Object.keys(result.sections)).toEqual(['boxed_warning']);
    expect(result.sections.boxed_warning.truncated).toBe(false);

    const long = label('NDA1', 'LONG', 'x', { boxed_warning: ['W'.repeat(500)] });
    resetClient();
    setup(() => page([long]));
    const cut = await handlers.get_fda_label!({ set_id: 'set-NDA1', sections: ['boxed_warning'], max_chars_per_section: 200 }) as Result;
    expect(cut.sections.boxed_warning).toMatchObject({ truncated: true, full_length: 500 });
    expect(cut.sections.boxed_warning.text).toHaveLength(201);
  });

  it('falls back to any label when no innovator label exists', async () => {
    const seen = setup((_config, search) => (search.includes('ANDA') ? undefined : page([label('ANDA1', 'GENERIC', 'x')])));
    const result = await handlers.get_fda_label!({ drug: 'oldgeneric' }) as Result;
    expect(seen).toHaveLength(2);
    expect(result.found).toBe(true);
  });

  it('says plainly when nothing matched', async () => {
    setup(() => undefined);
    const result = await handlers.get_fda_label!({ application_number: 'BLA999999' }) as Result;
    expect(result).toMatchObject({ found: false });
    expect(result.message).toMatch(/does not prove/);
  });

  it.each([
    [{}, /One of/],
    [{ drug: 'a', set_id: 'b' }, /only one of/],
    [{ drug: 'a', sections: ['nonsense'] }, /Unknown label section/],
  ])('rejects invalid arguments %j', async (args, message) => {
    setup(() => page([]));
    await expect(handlers.get_fda_label!(args)).rejects.toThrow(message);
  });
});
