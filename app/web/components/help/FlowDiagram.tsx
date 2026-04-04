import { ChevronRight, ChevronDown } from "lucide-react";
import type { WorkflowStep } from "./helpData";

interface FlowDiagramProps {
  steps: WorkflowStep[];
  orientation?: "horizontal" | "vertical";
}

export function FlowDiagram({ steps, orientation = "horizontal" }: FlowDiagramProps) {
  if (orientation === "vertical") {
    return (
      <div className="flex flex-col items-start gap-1">
        {steps.map((step, i) => (
          <div key={step.database} className="flex flex-col items-start">
            <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs font-medium ${step.color}`}>
              <span className="font-semibold whitespace-nowrap">{step.database}</span>
              <span className="text-xs opacity-75 leading-relaxed">{step.action}</span>
            </div>
            {i < steps.length - 1 && (
              <div className="flex items-center ml-4 my-0.5">
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Horizontal layout — wraps onto multiple rows on narrow screens
  return (
    <div className="flex flex-wrap items-center gap-1">
      {steps.map((step, i) => (
        <div key={step.database} className="flex items-center gap-1">
          <div
            className={`flex flex-col items-center px-3 py-2 rounded-lg border text-xs font-medium ${step.color} min-w-[90px] text-center`}
            title={step.action}
          >
            <span className="font-semibold">{step.database}</span>
            <span className="text-[10px] opacity-70 mt-0.5 leading-tight">{step.action}</span>
          </div>
          {i < steps.length - 1 && (
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          )}
        </div>
      ))}
    </div>
  );
}
