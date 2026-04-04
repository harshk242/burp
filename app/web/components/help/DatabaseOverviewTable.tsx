import { Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DATABASES } from "./helpData";

export function DatabaseOverviewTable() {
  return (
    <section id="databases" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">Database Overview</h2>
      <p className="text-muted-foreground mb-6">
        BURP connects 10 biomedical databases covering 210+ tools. Each database has a distinct
        focus and identifier system — knowing these helps you write targeted prompts.
      </p>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[140px]">Database</TableHead>
              <TableHead>Focus Area</TableHead>
              <TableHead className="w-[110px]">Scale</TableHead>
              <TableHead className="w-[60px] text-center">Tools</TableHead>
              <TableHead className="w-[160px]">Key Identifier</TableHead>
              <TableHead>Example Query</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DATABASES.map((db) => (
              <TableRow key={db.key} className="group">
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className={`w-1 h-8 rounded-full ${db.color} shrink-0`} />
                    <div className="flex items-center gap-1.5">
                      <Database className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="font-semibold text-sm">{db.name}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{db.focus}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{db.records}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary" className="text-xs font-mono">
                    {db.toolCount}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="text-xs">
                    <span className="font-medium text-foreground">{db.keyIdentifier}</span>
                    <br />
                    <code className="text-muted-foreground text-[11px]">{db.identifierExample}</code>
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground italic">
                  &ldquo;{db.exampleQuery}&rdquo;
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden grid gap-3">
        {DATABASES.map((db) => (
          <Card key={db.key} className="overflow-hidden">
            <div className={`h-1 w-full ${db.color}`} />
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{db.name}</span>
                </div>
                <Badge variant="secondary" className="text-xs">
                  {db.toolCount} tools
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mb-2">{db.focus}</p>
              <div className="text-xs text-muted-foreground mb-2">
                Scale: <span className="font-medium text-foreground">{db.records}</span>
              </div>
              <div className="text-xs mb-2">
                Key ID:{" "}
                <span className="font-medium">{db.keyIdentifier}</span>{" "}
                <code className="bg-muted px-1 py-0.5 rounded text-[11px]">
                  {db.identifierExample}
                </code>
              </div>
              <p className="text-xs text-muted-foreground italic">
                &ldquo;{db.exampleQuery}&rdquo;
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary stats */}
      <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span>
          <strong className="text-foreground">10</strong> databases
        </span>
        <span>
          <strong className="text-foreground">214</strong> total tools
        </span>
        <span>
          <strong className="text-foreground">40+</strong> connection paths
        </span>
      </div>
    </section>
  );
}
