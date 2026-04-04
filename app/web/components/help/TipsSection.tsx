import {
  Target,
  Key,
  GitBranch,
  LayoutList,
  MessageSquarePlus,
  Layers,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { TIPS } from "./helpData";
import type { LucideIcon } from "lucide-react";

const ICON_MAP: Record<string, LucideIcon> = {
  Target,
  Key,
  GitBranch,
  LayoutList,
  MessageSquarePlus,
  Layers,
};

export function TipsSection() {
  return (
    <section id="tips" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">Tips & Best Practices</h2>
      <p className="text-muted-foreground mb-6">
        Apply these strategies to get the most precise, comprehensive results from BURP.
      </p>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TIPS.map((tip) => {
          const Icon = ICON_MAP[tip.icon] ?? Target;
          return (
            <Card key={tip.title}>
              <CardContent className="pt-6">
                <Icon className="h-8 w-8 text-primary mb-3" />
                <h3 className="font-semibold mb-2">{tip.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{tip.description}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
