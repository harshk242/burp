import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";
import { ID_MAPPINGS } from "./helpData";

export function IdMappingReference() {
  return (
    <section id="id-mapping" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">ID Mapping Reference</h2>
      <p className="text-muted-foreground mb-4">
        Each database uses its own identifier system. This cheat-sheet shows how to convert between
        them using BURP tools.
      </p>

      {/* Pro tip callout */}
      <Card className="mb-5 border-blue-200 bg-blue-50/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-sm text-blue-900">
            <strong>Pro tip:</strong> Always resolve identifiers first before cross-referencing
            databases. Start with a gene symbol search in Ensembl or UniProt to get the canonical
            ID, then use that ID for all subsequent queries.
          </p>
        </CardContent>
      </Card>

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[180px]">Mapping</TableHead>
              <TableHead>Starting With</TableHead>
              <TableHead>Tool to Use</TableHead>
              <TableHead>Example Output</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ID_MAPPINGS.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="font-semibold text-sm">{row.mapping}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.startingWith}</TableCell>
                <TableCell>
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono break-all">
                    {row.tool}
                  </code>
                  {row.note && (
                    <p className="text-xs text-amber-600 mt-1">⚠ {row.note}</p>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{row.example}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {ID_MAPPINGS.map((row, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <p className="font-semibold text-sm mb-1">{row.mapping}</p>
              <p className="text-xs text-muted-foreground mb-2">
                Starting with: {row.startingWith}
              </p>
              <code className="text-xs bg-muted px-2 py-1 rounded font-mono block mb-2 break-all">
                {row.tool}
              </code>
              {row.note && (
                <p className="text-xs text-amber-600 mb-1">⚠ {row.note}</p>
              )}
              <p className="text-xs text-muted-foreground">{row.example}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
