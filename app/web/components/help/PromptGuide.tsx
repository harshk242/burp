import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PromptComparison } from "./PromptComparison";
import { PromptTemplates } from "./PromptTemplates";
import { STEERING_TIPS } from "./helpData";

// Prompt anatomy segments with colors
const ANATOMY_SEGMENTS = [
  {
    label: "Context",
    text: "For the TP53 gene,",
    bg: "bg-blue-50 border-blue-400",
    labelColor: "text-blue-700",
    description: "Name the gene, protein, variant, or drug you're asking about.",
  },
  {
    label: "Specificity",
    text: "look up ClinVar pathogenic variants and\nEnsembl variant consequences,",
    bg: "bg-green-50 border-green-400",
    labelColor: "text-green-700",
    description: "Name the databases and specify what data you need from each.",
  },
  {
    label: "Cross-reference",
    text: "then find Open Targets disease associations\nfor the same gene.",
    bg: "bg-purple-50 border-purple-400",
    labelColor: "text-purple-700",
    description: 'Ask to link data across databases with "then", "also", "and map to".',
  },
  {
    label: "Output format",
    text: 'Present results as a summary table with identifiers."',
    bg: "bg-amber-50 border-amber-400",
    labelColor: "text-amber-700",
    description: "Specify how you want results: table, ranked list, summary, etc.",
  },
];

export function PromptGuide() {
  return (
    <section id="prompts" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">Writing Effective Prompts</h2>
      <p className="text-muted-foreground mb-6">
        The quality of your query directly determines the quality of the response. BURP performs
        best when you name databases, provide identifiers, and specify output formats.
      </p>

      <Tabs defaultValue="anatomy">
        <TabsList className="mb-6 flex-wrap h-auto gap-1">
          <TabsTrigger value="anatomy">Prompt Anatomy</TabsTrigger>
          <TabsTrigger value="comparison">Good vs Bad</TabsTrigger>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="tips">Steering Tips</TabsTrigger>
        </TabsList>

        {/* Tab 1: Prompt Anatomy */}
        <TabsContent value="anatomy">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              A well-constructed BURP prompt has four elements. Each element is highlighted below:
            </p>
            <div className="rounded-lg overflow-hidden border">
              {ANATOMY_SEGMENTS.map((seg) => (
                <div
                  key={seg.label}
                  className={`border-l-4 px-4 py-3 ${seg.bg} border-b last:border-b-0`}
                >
                  <div className={`text-xs font-semibold uppercase tracking-wide mb-1 ${seg.labelColor}`}>
                    {seg.label}
                  </div>
                  <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">
                    {seg.text}
                  </pre>
                  <p className="text-xs text-muted-foreground mt-1">{seg.description}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              You don&apos;t need all four in every prompt, but specificity and database naming
              always help.
            </p>
          </div>
        </TabsContent>

        {/* Tab 2: Good vs Bad */}
        <TabsContent value="comparison">
          <PromptComparison />
        </TabsContent>

        {/* Tab 3: Templates */}
        <TabsContent value="templates">
          <div className="mb-4">
            <p className="text-sm text-muted-foreground">
              Copy any template below and fill in the bracketed placeholders. These cover the most
              common research workflows.
            </p>
          </div>
          <PromptTemplates />
        </TabsContent>

        {/* Tab 4: Steering Tips */}
        <TabsContent value="tips">
          <div className="space-y-4">
            {STEERING_TIPS.map((tip) => (
              <div key={tip.number} className="flex gap-4">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                  {tip.number}
                </div>
                <div>
                  <h3 className="font-semibold mb-1">{tip.title}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{tip.description}</p>
                  {tip.example && (
                    <pre className="text-xs bg-muted/60 rounded-md px-3 py-2 font-mono whitespace-pre-wrap text-muted-foreground">
                      {tip.example}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
