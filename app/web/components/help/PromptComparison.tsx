import { XCircle, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PROMPT_PAIRS } from "./helpData";

export function PromptComparison() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 mb-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-red-600">
          <XCircle className="h-4 w-4" />
          Vague (avoid)
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold text-green-600">
          <CheckCircle2 className="h-4 w-4" />
          Specific (preferred)
        </div>
      </div>

      {PROMPT_PAIRS.map((pair, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Vague */}
          <Card className="border-red-200 bg-red-50/50">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-900">&ldquo;{pair.vague}&rdquo;</p>
              </div>
            </CardContent>
          </Card>

          {/* Specific */}
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                <p className="text-sm text-green-900">&ldquo;{pair.specific}&rdquo;</p>
              </div>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
