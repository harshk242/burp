import { WorkflowCard } from "./WorkflowCard";
import { WORKFLOWS } from "./helpData";

export function WorkflowSection() {
  return (
    <section id="workflows" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">Research Workflows</h2>
      <p className="text-muted-foreground mb-6">
        These 7 end-to-end workflows show how BURP chains databases together for real research
        tasks. Click any workflow to expand its database pipeline and a copy-ready example prompt.
      </p>

      <div className="space-y-3">
        {WORKFLOWS.map((workflow) => (
          <WorkflowCard key={workflow.id} workflow={workflow} />
        ))}
      </div>
    </section>
  );
}
