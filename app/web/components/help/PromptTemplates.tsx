import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "./CopyButton";
import { PROMPT_TEMPLATES } from "./helpData";

// Map database names to color classes
const DB_COLORS: Record<string, string> = {
  Ensembl: "bg-violet-100 text-violet-800",
  UniProt: "bg-blue-100 text-blue-800",
  ChEMBL: "bg-emerald-100 text-emerald-800",
  PubChem: "bg-cyan-100 text-cyan-800",
  ClinVar: "bg-red-100 text-red-800",
  "Open Targets": "bg-orange-100 text-orange-800",
  Reactome: "bg-pink-100 text-pink-800",
  ClinicalTrials: "bg-teal-100 text-teal-800",
  PubMed: "bg-indigo-100 text-indigo-800",
  ClinPGx: "bg-amber-100 text-amber-800",
};

export function PromptTemplates() {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {PROMPT_TEMPLATES.map((tpl) => (
        <Card key={tpl.title} className="flex flex-col">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="text-base">{tpl.title}</CardTitle>
              <CopyButton text={tpl.template} />
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              {tpl.databases.map((db) => (
                <span
                  key={db}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    DB_COLORS[db] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {db}
                </span>
              ))}
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed bg-muted/50 rounded-md p-3 overflow-auto max-h-56">
              {tpl.template}
            </pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
