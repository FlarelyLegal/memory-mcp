import { describe, it, expect } from "vitest";
import { track, untrack, resolveNamespace, resolveConversation } from "../../src/state.js";
import type { SessionState, StateHandle } from "../../src/types.js";

function makeHandle(initial?: Partial<SessionState>): StateHandle & { state: SessionState } {
  const handle = {
    state: {
      recentEntities: [],
      ...initial,
    } as SessionState,
    setState(s: SessionState) {
      handle.state = s;
    },
  };
  return handle;
}

describe("resolveNamespace", () => {
  it("returns explicit value when provided", () => {
    const h = makeHandle({ currentNamespace: "old" });
    expect(resolveNamespace("new", h)).toBe("new");
  });

  it("falls back to state when explicit is undefined", () => {
    const h = makeHandle({ currentNamespace: "saved" });
    expect(resolveNamespace(undefined, h)).toBe("saved");
  });

  it("returns undefined when neither is set", () => {
    const h = makeHandle();
    expect(resolveNamespace(undefined, h)).toBeUndefined();
  });
});

describe("resolveConversation", () => {
  it("returns explicit value when provided", () => {
    const h = makeHandle({ currentConversation: "old" });
    expect(resolveConversation("new", h)).toBe("new");
  });

  it("falls back to state when explicit is undefined", () => {
    const h = makeHandle({ currentConversation: "saved" });
    expect(resolveConversation(undefined, h)).toBe("saved");
  });

  it("returns undefined when neither is set", () => {
    const h = makeHandle();
    expect(resolveConversation(undefined, h)).toBeUndefined();
  });
});

describe("track", () => {
  it("sets current namespace", () => {
    const h = makeHandle();
    track(h, { namespace: "ns-1" });
    expect(h.state.currentNamespace).toBe("ns-1");
  });

  it("sets current conversation", () => {
    const h = makeHandle();
    track(h, { conversation: "conv-1" });
    expect(h.state.currentConversation).toBe("conv-1");
  });

  it("adds entity to recent list (MRU order)", () => {
    const h = makeHandle();
    track(h, { entity: "e1" });
    track(h, { entity: "e2" });
    expect(h.state.recentEntities).toEqual(["e2", "e1"]);
  });

  it("moves existing entity to front", () => {
    const h = makeHandle({ recentEntities: ["e1", "e2", "e3"] });
    track(h, { entity: "e3" });
    expect(h.state.recentEntities).toEqual(["e3", "e1", "e2"]);
  });

  it("accepts array of entities", () => {
    const h = makeHandle();
    track(h, { entity: ["e1", "e2", "e3"] });
    expect(h.state.recentEntities).toEqual(["e3", "e2", "e1"]);
  });

  it("evicts oldest when exceeding cap (10)", () => {
    const ids = Array.from({ length: 10 }, (_, i) => `e${i}`);
    const h = makeHandle({ recentEntities: ids });
    track(h, { entity: "new" });
    expect(h.state.recentEntities).toHaveLength(10);
    expect(h.state.recentEntities[0]).toBe("new");
    expect(h.state.recentEntities).not.toContain("e9");
  });

  it("does not call setState when nothing changes", () => {
    const h = makeHandle({ currentNamespace: "ns-1" });
    let setCalled = false;
    h.setState = (s: SessionState) => {
      setCalled = true;
      h.state = s;
    };
    track(h, { namespace: "ns-1" }); // same value
    expect(setCalled).toBe(false);
  });
});

describe("untrack", () => {
  it("removes entity from recent list", () => {
    const h = makeHandle({ recentEntities: ["e1", "e2", "e3"] });
    untrack(h, "e2");
    expect(h.state.recentEntities).toEqual(["e1", "e3"]);
  });

  it("no-ops if entity is not in list", () => {
    const h = makeHandle({ recentEntities: ["e1"] });
    let setCalled = false;
    h.setState = (s: SessionState) => {
      setCalled = true;
      h.state = s;
    };
    untrack(h, "missing");
    expect(setCalled).toBe(false);
  });
});
