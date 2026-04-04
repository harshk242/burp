import {
  Info,
  Clock,
  RefreshCw,
  AlertTriangle,
  FileBox,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LIMITATIONS } from "./helpData";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Info,
  Clock,
  RefreshCw,
  AlertTriangle,
  FileBox,
};

export function LimitationsSection() {
  return (
    <section id="limitations" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">Limitations</h2>
      <p className="text-muted-foreground mb-6">
        Keep these constraints in mind when planning your research queries.
      </p>

      <div className="space-y-3">
        {LIMITATIONS.map((item) => {
          const Icon = ICON_MAP[item.icon] ?? Info;
          return (
            <Alert key={item.title} variant={item.variant}>
              <Icon className="h-4 w-4" />
              <AlertTitle>{item.title}</AlertTitle>
              <AlertDescription>{item.description}</AlertDescription>
            </Alert>
          );
        })}
      </div>
    </section>
  );
}
