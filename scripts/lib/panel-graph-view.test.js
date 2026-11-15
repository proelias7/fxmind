const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { graphMemoryView, MAX_NODES } = require("./panel-graph-view");

const graph = {
  nodes: [
    { id: "garage", name: "Garages", group: "learned", resources: "garage", file: ".fxmind/memory/garage.md" },
    { id: "vehicle", name: "Vehicle", group: "learned", file: ".fxmind/memory/vehicle.md" },
    { id: "memory:1", name: "Events", group: "memory-atom", slug: "garage", topic: "garage",
      content: "Remove o veículo da garagem ao solicitar spawn", file: ".fxmind/memory/garage.md", line: 17 },
    { id: "resource:1", name: "garage", group: "resource" },
    { id: "code:1", name: "getGarages", group: "code-symbol", content: "secret ignored" },
  ],
  links: [
    { source: "garage", target: "vehicle", type: "event-flow", confidence: "extracted" },
    { source: "memory:1", target: "resource:1", type: "belongs-to", confidence: "extracted" },
    { source: "code:1", target: "resource:1", type: "belongs-to", confidence: "extracted" },
  ],
  meta: { generatedAt: "2026-11-15T00:00:00.000Z" },
};

describe("memory graph Canvas view", () => {
  it("shows only learned memories and confirmed edges by default", () => {
    const v=graphMemoryView(graph);
    assert.equal(v.mode,"memories");
    assert.deepEqual(v.nodes.map(n=>n.id),["garage","vehicle"]);
    assert.deepEqual(v.links,[{source:"garage",target:"vehicle",type:"event-flow"}]);
    assert.equal(v.meta.totalMemories,2);
    assert.equal(v.meta.totalFragments,1);
  });
  it("shows atomic memory facts and exact provenance edges on demand", () => {
    const v=graphMemoryView(graph,{mode:"fragments"});
    assert.equal(v.nodes.length,4);
    assert.ok(v.links.some(e=>e.source==="garage"&&e.target==="memory:1"&&e.type==="fragment-of"));
    assert.ok(v.links.some(e=>e.source==="memory:1"&&e.target==="resource:1"&&e.type==="belongs-to"));
    assert.ok(!v.links.some(e=>e.source==="code:1"||e.target==="code:1"));
    assert.ok(v.nodes.find(n=>n.id==="memory:1").name.includes("Remove o veículo"));
  });
  it("scopes search, includes direct neighbours, and preserves origin", () => {
    const v=graphMemoryView(graph,{mode:"memories",query:"garages"});
    assert.deepEqual(v.nodes.map(n=>n.id),["garage","vehicle"]);
    assert.equal(v.nodes[0].file,".fxmind/memory/garage.md");
    const miss=graphMemoryView(graph,{query:"undefined-memory"});
    assert.equal(miss.nodes.length,0);
    assert.equal(miss.links.length,0);
  });
  it("balances fragments across different memory topics", () => {
    const x = {
      nodes: [
        {id:"alpha",name:"Alpha",group:"learned"},
        {id:"beta",name:"Beta",group:"learned"},
        ...Array.from({length:25},(_,i)=>({id:"a"+i,group:"memory-atom",slug:"alpha",content:"Alpha fact "+i})),
        ...Array.from({length:25},(_,i)=>({id:"b"+i,group:"memory-atom",slug:"beta",content:"Beta fact "+i})),
      ],
      links: [],
    };
    const v=graphMemoryView(x,{mode:"fragments",limit:12});
    assert.ok(v.nodes.some(n=>n.id.startsWith("a")));
    assert.ok(v.nodes.some(n=>n.id.startsWith("b")));
    assert.ok(v.links.some(e=>e.type==="fragment-of"));
  });
  it("caps node count and strips large source arrays from the UI payload", () => {
    const huge={nodes:Array.from({length:600},(_,i)=>({
      id:"n"+i,group:"memory-atom",name:"Fact",sourcePaths:Array.from({length:1000},()=>"huge"),
    })),links:[]};
    const v=graphMemoryView(huge,{mode:"fragments",limit:99999});
    assert.ok(v.nodes.length<=MAX_NODES);
    assert.equal(v.meta.truncated,true);
    assert.ok(!Object.hasOwn(v.nodes[0],"sourcePaths"));
  });
  it("dashboard links a real interactive module and offers Canvas / Projects tabs", () => {
    const base=path.resolve(__dirname,"../../web/dashboard");
    const dashboard=fs.readFileSync(path.join(base,"dashboard.js"),"utf8");
    const canvas=fs.readFileSync(path.join(base,"memory-graph.js"),"utf8");
    assert.match(dashboard,/memoryTab: 'canvas'/);
    assert.match(dashboard,/graph\/view\?mode=/);
    assert.match(dashboard,/view-canvas/);
    assert.match(dashboard,/view-list/);
    assert.match(canvas,/pointerdown/);
    assert.match(canvas,/ResizeObserver/);
    assert.match(canvas,/graph-detail-source/);
  });
});
