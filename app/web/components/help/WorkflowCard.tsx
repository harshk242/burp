import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { CopyButton } from "./CopyButton";
import { CollapsibleSection } from "./CollapsibleSection";
import { FlowDiagram } from "./FlowDiagram";
import type { Workflow } from "./helpData";

interface WorkflowCardProps {
  workflow: Workflow;
}

export function WorkflowCard({ workflow }: WorkflowCardProps) {
  const summary = (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <span className="text-sm font-semibold text-foreground">
        {workflow.id}. {workflow.title}
      </span>
      <Badge className={`text-xs ${workflow.personaColor} border-0`}>
        {workflow.persona}
      </Badge>
      <span className="text-xs text-muted-foreground ml-auto">
        {workflow.databases.length} databases
      </span>
    </div>
  );

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <CollapsibleSection summary={summary}>
          <div className="space-y-4 pt-1">
            {/* Flow diagram — horizontal on desktop, vertical on mobile */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Database Pipeline
              </p>
              <div className="hidden sm:block overflow-x-auto pb-1">
                <FlowDiagram steps={workflow.steps} orientation="horizontal" />
              </div>
              <div className="sm:hidden">
                <FlowDiagram steps={workflow.steps} orientation="vertical" />
              </div>
            </div>

            {/* Example prompt */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Example Prompt
                </p>
                <CopyButton text={workflow.examplePrompt} />
              </div>
              <blockquote className="border-l-4 border-primary/30 pl-3 bg-muted/40 rounded-r-md py-2 pr-3">
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                  {workflow.examplePrompt}
                </p>
              </blockquote>
            </div>

            {/* Why valuable */}
            <div className="text-sm text-muted-foreground bg-primary/5 rounded-md px-3 py-2">
              <span className="font-semibold text-foreground">Why this matters: </span>
              {workflow.whyValuable}
            </div>
          </div>
        </CollapsibleSection>
      </CardContent>
    </Card>
  );
}
