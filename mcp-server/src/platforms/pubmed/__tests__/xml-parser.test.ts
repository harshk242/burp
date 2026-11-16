import { describe, expect, it } from 'vitest';
import { parseEFetchResult, parseELinkResult, parseESearchResult } from '../xml-parser.js';

function article(authors: string) {
  return `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>123</PMID><Article>
    <ArticleTitle>Example</ArticleTitle>${authors}
    <PublicationTypeList><PublicationType>Journal Article</PublicationType></PublicationTypeList>
    <GrantList><Grant><GrantID>G1</GrantID></Grant></GrantList></Article>
    <MeshHeadingList><MeshHeading><DescriptorName MajorTopicYN="Y">Cancer</DescriptorName></MeshHeading></MeshHeadingList>
    <KeywordList><Keyword>biology</Keyword></KeywordList></MedlineCitation>
    <PubmedData><ArticleIdList><ArticleId IdType="doi">10.1/example</ArticleId></ArticleIdList></PubmedData>
    </PubmedArticle></PubmedArticleSet>`;
}

describe('PubMed XML cardinality', () => {
  it('decodes two authors and preserves the other array fields', () => {
    const [result] = parseEFetchResult(article(`<AuthorList>
      <Author><LastName>Smith</LastName><ForeName>Alice</ForeName>
      <AffiliationInfo><Affiliation>Lab A</Affiliation></AffiliationInfo>
      <AffiliationInfo><Affiliation>Lab B</Affiliation></AffiliationInfo>
      <Identifier Source="Other">other</Identifier><Identifier Source="ORCID">0000-0001</Identifier></Author>
      <Author><LastName>Jones</LastName><ForeName>Bob</ForeName></Author></AuthorList>`));
    expect(result!.authors).toHaveLength(2);
    expect(result!.authors[0]).toMatchObject({ lastName: 'Smith', foreName: 'Alice', affiliation: 'Lab A; Lab B', orcid: '0000-0001' });
    expect(result!.authors[1]!.lastName).toBe('Jones');
    expect(result).toMatchObject({ doi: '10.1/example', keywords: ['biology'], publicationTypes: ['Journal Article'], grantList: [{ grantId: 'G1' }], meshTerms: [{ descriptorName: 'Cancer', majorTopic: true }] });
  });

  it('supports a single collective author and an absent list', () => {
    expect(parseEFetchResult(article('<AuthorList><Author><CollectiveName>Consortium</CollectiveName></Author></AuthorList>'))[0]!.authors[0]!.collectiveName).toBe('Consortium');
    expect(parseEFetchResult(article(''))[0]!.authors).toEqual([]);
  });

  it('normalizes LinkSet while retaining Id and Link arrays', () => {
    expect(parseELinkResult('<eLinkResult><LinkSet><DbFrom>pubmed</DbFrom><IdList><Id>123</Id></IdList><LinkSetDb><DbTo>pubmed</DbTo><LinkName>related</LinkName><Link><Id>456</Id></Link><Link><Id>789</Id></Link></LinkSetDb></LinkSet></eLinkResult>')).toMatchObject({ dbFrom: 'pubmed', idList: ['123'], linkSetDb: [{ link: [{ id: '456' }, { id: '789' }] }] });
    expect(parseESearchResult('<eSearchResult><IdList><Id>123</Id></IdList><TranslationSet><Translation><From>a</From><To>b</To></Translation></TranslationSet></eSearchResult>')).toMatchObject({ idList: ['123'], translationSet: [{ from: 'a', to: 'b' }] });
  });
});

it('decodes ESummary Id and nested Item lists', async () => {
  const { parseESummaryResult } = await import('../xml-parser.js');
  expect(parseESummaryResult('<eSummaryResult><DocSum><Id>123</Id><Item Name="Title" Type="String">Example</Item><Item Name="AuthorList" Type="List"><Item Name="Author" Type="String">Smith A</Item><Item Name="Author" Type="String">Jones B</Item></Item></DocSum></eSummaryResult>')[0]).toMatchObject({ uid: '123', title: 'Example', authors: ['Smith A', 'Jones B'] });
});

it('decodes numeric character references in abstracts and author names', () => {
  const [result] = parseEFetchResult(`<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>1</PMID><Article>
    <ArticleTitle>A&#x3b2; study</ArticleTitle><Abstract><AbstractText>Difference &#x2212;0.45 (P&lt;0.001).</AbstractText></Abstract>
    <AuthorList><Author><LastName>Lesn&#xe9;</LastName><ForeName>S</ForeName></Author></AuthorList></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`);
  expect(result).toMatchObject({ title: 'Aβ study', abstract: 'Difference −0.45 (P<0.001).', authors: [{ lastName: 'Lesné' }] });
});

it('decodes more character references than the parser entity-expansion limit allows', () => {
  const abstract = 'A&#x3b2; &#x2212;1 '.repeat(1000);
  const [result] = parseEFetchResult(`<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>2</PMID><Article>
    <ArticleTitle>Batch</ArticleTitle><Abstract><AbstractText>${abstract}</AbstractText></Abstract></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>`);
  expect(result!.abstract).toBe('Aβ −1 '.repeat(1000).trim());
});

it('keeps referenced markup characters as text', async () => {
  const { decodeCharacterReferences } = await import('../xml-parser.js');
  expect(decodeCharacterReferences('a &#60;b&#62; &#38; &#x22;c&#39; &#xe9; &#1114112;')).toBe('a &lt;b&gt; &amp; &quot;c&apos; é &#1114112;');
  const [result] = parseEFetchResult('<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>3</PMID><Article><ArticleTitle>P&#60;0.05 &#38; more</ArticleTitle></Article></MedlineCitation></PubmedArticle></PubmedArticleSet>');
  expect(result!.title).toBe('P<0.05 & more');
});
