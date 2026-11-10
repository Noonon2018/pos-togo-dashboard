import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { Graph } from '../lib/aggregate';
import { moneyShort } from '../format';

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}

export interface GraphHandle {
  png: () => Blob | null;
  fit: () => void;
  relayout: () => void;
}

interface Props {
  graph: Graph;
  selected: Selection | null;
  onSelect: (s: Selection | null) => void;
}

const STYLE: cytoscape.StylesheetJson = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'font-size': 11,
      'font-family': 'system-ui, sans-serif',
      'text-valign': 'bottom',
      'text-margin-y': 4,
      'text-wrap': 'wrap',
      'text-max-width': '140px',
      color: '#1f2937',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.85,
      'text-background-padding': '2px',
      'background-color': '#9ca3af',
      width: 'data(size)',
      height: 'data(size)',
      'border-width': 1,
      'border-color': '#6b7280',
    },
  },
  {
    selector: 'node[kind="account"]',
    style: {
      shape: 'round-rectangle',
      'background-color': '#2563eb',
      'border-color': '#1e3a8a',
      'border-width': 2,
      'font-weight': 'bold',
      'font-size': 13,
      width: 'data(size)',
      height: 'data(hsize)',
    },
  },
  { selector: 'node[kind="other"]', style: { 'background-color': '#e5e7eb', 'border-style': 'dashed' } },
  { selector: 'node[flow="in"]', style: { 'background-color': '#16a34a', 'border-color': '#14532d' } },
  { selector: 'node[flow="out"]', style: { 'background-color': '#dc2626', 'border-color': '#7f1d1d' } },
  { selector: 'node[flow="both"]', style: { 'background-color': '#d97706', 'border-color': '#78350f' } },
  {
    selector: 'edge',
    style: {
      width: 'data(width)',
      'curve-style': 'bezier',
      'target-arrow-shape': 'triangle',
      'arrow-scale': 1.1,
      'line-color': 'data(color)',
      'target-arrow-color': 'data(color)',
      opacity: 0.8,
      label: 'data(label)',
      'font-size': 9,
      color: '#374151',
      'text-rotation': 'autorotate',
      'text-background-color': '#ffffff',
      'text-background-opacity': 0.9,
      'text-background-padding': '1px',
    },
  },
  { selector: ':selected', style: { 'overlay-color': '#f59e0b', 'overlay-opacity': 0.35, 'overlay-padding': 6 } },
  { selector: '.faded', style: { opacity: 0.12 } },
];

function toElements(graph: Graph): ElementDefinition[] {
  const maxEdge = Math.max(1, ...graph.edges.map((e) => e.total));
  const maxNode = Math.max(1, ...graph.nodes.map((n) => n.totalIn + n.totalOut));
  const nodes: ElementDefinition[] = graph.nodes.map((n) => {
    const vol = n.totalIn + n.totalOut;
    const size = n.kind === 'account' ? 70 : 18 + 42 * Math.sqrt(vol / maxNode);
    const flow = n.kind !== 'counterparty' ? undefined : n.totalIn > 0 && n.totalOut > 0 ? 'both' : n.totalOut > 0 ? 'in' : 'out';
    return {
      data: {
        id: n.id,
        label: n.kind === 'account' ? n.label : `${n.label}\n${moneyShort(vol)}`,
        kind: n.kind,
        flow,
        size,
        hsize: 40,
      },
    };
  });
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind]));
  const edges: ElementDefinition[] = graph.edges.map((e) => {
    const transfer = kindOf.get(e.source) === 'account' && kindOf.get(e.target) === 'account';
    const intoAccount = kindOf.get(e.target) === 'account';
    return {
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.count} / ${moneyShort(e.total)}`,
        width: 1 + 11 * Math.sqrt(e.total / maxEdge),
        color: transfer ? '#7c3aed' : intoAccount ? '#16a34a' : '#dc2626',
      },
    };
  });
  return [...nodes, ...edges];
}

const runLayout = (cy: Core) =>
  cy
    .layout({
      name: 'cose',
      animate: false,
      randomize: true,
      nodeRepulsion: () => 90_000,
      idealEdgeLength: () => 140,
      nodeOverlap: 20,
      padding: 40,
    } as cytoscape.LayoutOptions)
    .run();

/** Interactive link-analysis graph (Cytoscape). Click node/edge to inspect, background to clear. */
const GraphView = forwardRef<GraphHandle, Props>(function GraphView({ graph, selected, onSelect }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const cy = cytoscape({ container: container.current, style: STYLE, wheelSensitivity: 0.3, minZoom: 0.1, maxZoom: 4 });
    cy.on('tap', (e) => {
      if (e.target === cy) onSelectRef.current(null);
    });
    cy.on('tap', 'node', (e) => onSelectRef.current({ kind: 'node', id: e.target.id() }));
    cy.on('tap', 'edge', (e) => onSelectRef.current({ kind: 'edge', id: e.target.id() }));
    cyRef.current = cy;
    return () => cy.destroy();
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    // keep positions of nodes that survive (e.g. after a filter change); only lay out if new nodes appear
    const prev = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
    cy.elements().remove();
    cy.add(toElements(graph));
    const allKnown = cy.nodes().toArray().every((n) => prev.has(n.id()));
    if (allKnown && prev.size > 0) cy.nodes().forEach((n) => void n.position(prev.get(n.id())!));
    else runLayout(cy);
    if (!allKnown) cy.fit(undefined, 30);
  }, [graph]);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('faded').unselect();
    if (!selected) return;
    const el = cy.getElementById(selected.id);
    if (el.empty()) return;
    el.select();
    const keep = selected.kind === 'node' ? el.closedNeighborhood() : el.union(cy.getElementById(selected.id).connectedNodes());
    cy.elements().not(keep).addClass('faded');
  }, [selected, graph]);

  useImperativeHandle(ref, () => ({
    png: () => (cyRef.current ? (cyRef.current.png({ output: 'blob', full: true, scale: 2, bg: '#ffffff' }) as Blob) : null),
    fit: () => cyRef.current?.fit(undefined, 30),
    relayout: () => {
      if (cyRef.current) {
        runLayout(cyRef.current);
        cyRef.current.fit(undefined, 30);
      }
    },
  }));

  return <div className="graph" ref={container} />;
});

export default GraphView;
