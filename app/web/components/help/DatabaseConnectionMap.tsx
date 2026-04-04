"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// Node positions (percentage-based within the container)
interface DbNode {
  key: string;
  label: string;
  abbr: string;
  x: number; // percent from left
  y: number; // percent from top
  isHub: boolean;
  color: string;
  connections: string[]; // keys this node connects to
}

const NODES: DbNode[] = [
  { key: "pubmed", label: "PubMed", abbr: "PubMed", x: 50, y: 5, isHub: false, color: "#6366f1", connections: [] },
  { key: "pubchem", label: "PubChem", abbr: "PubChem", x: 10, y: 30, isHub: false, color: "#06b6d4", connections: ["chembl", "pubmed"] },
  { key: "chembl", label: "ChEMBL", abbr: "ChEMBL", x: 38, y: 30, isHub: true, color: "#10b981", connections: ["uniprot", "pubchem", "open-targets", "reactome", "clinpgx", "pubmed"] },
  { key: "clinpgx", label: "ClinPGx", abbr: "ClinPGx", x: 72, y: 30, isHub: false, color: "#f59e0b", connections: ["chembl", "uniprot"] },
  { key: "clinvar", label: "ClinVar", abbr: "ClinVar", x: 10, y: 58, isHub: false, color: "#ef4444", connections: ["ensembl", "open-targets"] },
  { key: "open-targets", label: "Open Targets", abbr: "Open Targets", x: 50, y: 55, isHub: true, color: "#f97316", connections: ["chembl", "uniprot", "ensembl", "clinvar", "clinicaltrials", "pubmed"] },
  { key: "clinicaltrials", label: "ClinicalTrials", abbr: "Trials", x: 85, y: 55, isHub: false, color: "#14b8a6", connections: ["pubmed"] },
  { key: "ensembl", label: "Ensembl", abbr: "Ensembl", x: 10, y: 83, isHub: true, color: "#8b5cf6", connections: ["uniprot", "clinvar", "reactome", "open-targets"] },
  { key: "uniprot", label: "UniProt", abbr: "UniProt", x: 50, y: 83, isHub: true, color: "#3b82f6", connections: ["reactome", "ensembl", "open-targets", "chembl", "pubmed"] },
  { key: "reactome", label: "Reactome", abbr: "Reactome", x: 50, y: 97, isHub: false, color: "#ec4899", connections: [] },
];

// Build a full edge list (deduplicated)
function buildEdges(nodes: DbNode[]) {
  const seen = new Set<string>();
  const edges: { a: string; b: string }[] = [];
  for (const node of nodes) {
    for (const target of node.connections) {
      const key = [node.key, target].sort().join("|");
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ a: node.key, b: target });
      }
    }
  }
  return edges;
}

const EDGES = buildEdges(NODES);
const NODE_MAP = Object.fromEntries(NODES.map((n) => [n.key, n]));

// Mobile fallback: card per database listing connections
function MobileConnectionList({ selected, onSelect }: { selected: string | null; onSelect: (k: string) => void }) {
  return (
    <div className="grid gap-2">
      {NODES.map((node) => {
        const connectedKeys = [
          ...node.connections,
          ...NODES.filter((n) => n.connections.includes(node.key)).map((n) => n.key),
        ];
        const unique = [...new Set(connectedKeys)];
        return (
          <button
            key={node.key}
            onClick={() => onSelect(selected === node.key ? "" : node.key)}
            className={`w-full text-left rounded-lg border p-3 transition-colors ${
              selected === node.key ? "border-primary bg-primary/5" : "hover:border-muted-foreground/30"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-sm">{node.label}</span>
              {node.isHub && (
                <Badge variant="outline" className="text-xs">Hub</Badge>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {unique.map((k) => (
                <span
                  key={k}
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-muted"
                >
                  {NODE_MAP[k]?.label}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export function DatabaseConnectionMap() {
  const [selected, setSelected] = useState<string | null>(null);

  const handleNode = (key: string) => {
    setSelected((prev) => (prev === key ? null : key));
  };

  const isConnected = (nodeKey: string) => {
    if (!selected) return true;
    if (nodeKey === selected) return true;
    const selectedNode = NODE_MAP[selected];
    if (selectedNode?.connections.includes(nodeKey)) return true;
    if (NODE_MAP[nodeKey]?.connections.includes(selected)) return true;
    return false;
  };

  const isEdgeHighlighted = (a: string, b: string) => {
    if (!selected) return false;
    return (a === selected || b === selected);
  };

  const tooltipNode = selected ? NODE_MAP[selected] : null;
  const tooltipConnections = tooltipNode
    ? [
        ...tooltipNode.connections,
        ...NODES.filter((n) => n.connections.includes(tooltipNode.key)).map((n) => n.key),
      ].filter((v, i, arr) => arr.indexOf(v) === i)
    : [];

  return (
    <section id="connections" className="scroll-mt-20">
      <h2 className="text-2xl font-bold mb-2">Database Connection Map</h2>
      <p className="text-muted-foreground mb-6">
        BURP can chain 40+ connection paths across 10 databases. Click a database to highlight its
        connections. Hub nodes (Open Targets, UniProt, Ensembl, ChEMBL) have the most links.
      </p>

      {/* Desktop SVG diagram */}
      <div className="hidden sm:block">
        <div className="relative border rounded-xl bg-muted/20 overflow-hidden" style={{ paddingBottom: "52%" }}>
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 52"
            preserveAspectRatio="xMidYMid meet"
          >
            {/* Edges */}
            {EDGES.map(({ a, b }) => {
              const na = NODE_MAP[a];
              const nb = NODE_MAP[b];
              if (!na || !nb) return null;
              const highlighted = isEdgeHighlighted(a, b);
              const dimmed = selected && !highlighted;
              return (
                <line
                  key={`${a}-${b}`}
                  x1={na.x}
                  y1={na.y * 0.52}
                  x2={nb.x}
                  y2={nb.y * 0.52}
                  stroke={highlighted ? na.color : "#94a3b8"}
                  strokeWidth={highlighted ? "0.6" : "0.25"}
                  strokeOpacity={dimmed ? 0.15 : highlighted ? 0.9 : 0.4}
                  strokeDasharray={highlighted ? undefined : "0.8 0.4"}
                />
              );
            })}

            {/* Nodes */}
            {NODES.map((node) => {
              const connected = isConnected(node.key);
              const isSelected = selected === node.key;
              const r = node.isHub ? 3.2 : 2.2;
              const cy = node.y * 0.52;
              return (
                <g
                  key={node.key}
                  onClick={() => handleNode(node.key)}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    cx={node.x}
                    cy={cy}
                    r={r + 1}
                    fill="transparent"
                  />
                  <circle
                    cx={node.x}
                    cy={cy}
                    r={r}
                    fill={node.color}
                    fillOpacity={connected ? (isSelected ? 1 : 0.85) : 0.2}
                    stroke={isSelected ? "#fff" : node.color}
                    strokeWidth={isSelected ? "0.5" : "0"}
                  />
                  <text
                    x={node.x}
                    y={cy + r + 2.2}
                    textAnchor="middle"
                    fontSize="2.2"
                    fill={connected ? "#374151" : "#d1d5db"}
                    fontWeight={node.isHub ? "700" : "400"}
                  >
                    {node.abbr}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Tooltip / info panel */}
        {tooltipNode && (
          <Card className="mt-3">
            <CardContent className="p-4 flex flex-wrap items-center gap-3">
              <div
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: tooltipNode.color }}
              />
              <span className="font-semibold">{tooltipNode.label}</span>
              {tooltipNode.isHub && (
                <Badge variant="outline" className="text-xs">Hub</Badge>
              )}
              <span className="text-sm text-muted-foreground">
                Connected to:
              </span>
              <div className="flex flex-wrap gap-1">
                {tooltipConnections.map((k) => (
                  <Badge key={k} variant="secondary" className="text-xs">
                    {NODE_MAP[k]?.label}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Mobile list */}
      <div className="sm:hidden">
        <MobileConnectionList
          selected={selected}
          onSelect={(k) => setSelected((prev) => (prev === k ? null : k))}
        />
      </div>

      {/* Stats */}
      <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span><strong className="text-foreground">16</strong> bidirectional connections</span>
        <span><strong className="text-foreground">8</strong> unidirectional connections</span>
        <span><strong className="text-foreground">40+</strong> total connection paths</span>
        <span>
          <strong className="text-foreground">4</strong> hub databases (Open Targets, UniProt, Ensembl, ChEMBL)
        </span>
      </div>
    </section>
  );
}
