import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import type { Graph } from '../lib/aggregate';
import { amountShort } from '../format';
import { shortAddress } from '../lib/csv';
import { bookKey, KIND_ICON, type AddressBook } from '../lib/addressBook';
import { ROLE_ICON, type Role } from '../lib/roles';

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
  /** names for addresses / parties */
  book?: AddressBook;
  /** behaviour hints per party (⚡, 🆕, 🏦, 🌀) */
  roles?: Map<string, Role[]>;
  /** edge ids of a traced money trail to highlight */
  trail?: string[] | null;
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
  // address-book types: shape tells what it is at a glance
  { selector: 'node[lkind="exchange"]', style: { shape: 'hexagon', 'background-color': '#0369a1', 'border-color': '#0c4a6e' } },
  { selector: 'node[lkind="mixer"]', style: { shape: 'octagon', 'background-color': '#111827', 'border-color': '#000000', 'border-width': 3 } },
  { selector: 'node[lkind="bridge"]', style: { shape: 'diamond', 'background-color': '#0d9488', 'border-color': '#134e4a' } },
  { selector: 'node[lkind="contract"]', style: { shape: 'round-triangle', 'background-color': '#64748b' } },
  { selector: 'edge[broken]', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4] } },
  { selector: '.faded', style: { opacity: 0.12 } },
  { selector: 'edge.trail', style: { 'line-color': '#f59e0b', 'target-arrow-color': '#f59e0b', opacity: 1, 'z-index': 10, width: 'mapData(width, 0, 12, 4, 14)' } },
  { selector: 'node.trail', style: { 'border-color': '#f59e0b', 'border-width': 4, opacity: 1 } },
];

function toElements(graph: Graph, book: AddressBook = {}, roles?: Map<string, Role[]>): ElementDefinition[] {
  const partyOf = (id: string) => id.replace(/^(cp|acct):/, '');
  const lkindOf = (id: string) => {
    const p = partyOf(id);
    return book[bookKey(p)]?.kind ?? (roles?.get(p)?.some((r) => r.id === 'mixer') ? 'mixer' : undefined);
  };
  // sizes are scaled per unit: dollars and coins can't be compared
  const maxEdge = new Map<string, number>();
  for (const e of graph.edges) maxEdge.set(e.unit ?? '', Math.max(maxEdge.get(e.unit ?? '') ?? 1e-12, e.total));
  const maxNode = new Map<string, number>();
  for (const n of graph.nodes) maxNode.set(n.unit ?? '', Math.max(maxNode.get(n.unit ?? '') ?? 1e-12, n.totalIn + n.totalOut));
  const nodes: ElementDefinition[] = graph.nodes.map((n) => {
    const vol = n.totalIn + n.totalOut;
    const size = n.kind === 'account' ? 70 : 18 + 42 * Math.sqrt(n.unit === 'MIXED' ? 0.3 : vol / (maxNode.get(n.unit ?? '') ?? 1));
    const flow = n.kind !== 'counterparty' ? undefined : n.totalIn > 0 && n.totalOut > 0 ? 'both' : n.totalOut > 0 ? 'in' : 'out';
    const party = partyOf(n.id);
    const label = n.kind === 'other' ? undefined : book[bookKey(party)] ?? (n.label !== party ? book[bookKey(n.label)] : undefined);
    const icons = (roles?.get(party) ?? []).filter((r) => r.id !== 'mixer' || label?.kind !== 'mixer').map((r) => ROLE_ICON[r.id]).join('');
    const base = label ? `${KIND_ICON[label.kind]} ${label.name}` : shortAddress(n.label);
    const name = icons ? `${base} ${icons}` : base;
    const amount = amountShort(vol, n.unit);
    return {
      data: {
        id: n.id,
        label: n.kind === 'account' ? name : amount ? `${name}\n${amount}` : name,
        kind: n.kind,
        lkind: lkindOf(n.id),
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
    const fromAccount = kindOf.get(e.source) === 'account';
    return {
      data: {
        id: e.id,
        source: e.source,
        target: e.target,
        label: `${e.count} / ${amountShort(e.total, e.unit)}`,
        width: 1 + 11 * Math.sqrt(e.total / (maxEdge.get(e.unit ?? '') ?? 1)),
        // between two outside parties: grey-blue (not your money in or out)
        color: transfer ? '#7c3aed' : intoAccount ? '#16a34a' : fromAccount ? '#dc2626' : '#64748b',
        ...(lkindOf(e.target) === 'mixer' ? { broken: 1 } : {}),
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
const GraphView = forwardRef<GraphHandle, Props>(function GraphView({ graph, selected, onSelect, book, roles, trail }, ref) {
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
    cy.add(toElements(graph, book, roles));
    const allKnown = cy.nodes().toArray().every((n) => prev.has(n.id()));
    if (allKnown && prev.size > 0) cy.nodes().forEach((n) => void n.position(prev.get(n.id())!));
    else runLayout(cy);
    if (!allKnown) cy.fit(undefined, 30);
  }, [graph, book, roles]);

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
  }, [selected, graph, book, roles]);

  // a traced money trail: highlight its edges and parties, fade the rest
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.elements().removeClass('trail');
    if (!trail?.length) return;
    let path = cy.collection();
    for (const id of trail) {
      const e = cy.getElementById(id);
      if (!e.empty()) path = path.union(e).union(e.connectedNodes());
    }
    path.addClass('trail');
    cy.elements().not(path).addClass('faded');
    path.removeClass('faded');
  }, [trail, selected, graph, book, roles]);

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
