import { type DocBackend, DocStore } from "./docs";

class MemoryBackend implements DocBackend {
  private readonly cols = new Map<string, Map<string, string>>();
  private col(c: string) {
    let m = this.cols.get(c);
    if (!m) this.cols.set(c, (m = new Map()));
    return m;
  }
  get(c: string, id: string) {
    const v = this.col(c).get(id);
    return v === undefined ? undefined : JSON.parse(v);
  }
  put(c: string, id: string, doc: unknown) {
    this.col(c).set(id, JSON.stringify(doc));
  }
  insertIfAbsent(c: string, id: string, doc: unknown) {
    if (this.col(c).has(id)) return false;
    this.put(c, id, doc);
    return true;
  }
  list(c: string) {
    return [...this.col(c).values()].map((v) => JSON.parse(v));
  }
  del(c: string, id: string) {
    this.col(c).delete(id);
  }
  clear(c: string) {
    this.col(c).clear();
  }
}

export function memoryStore(): DocStore {
  return new DocStore(new MemoryBackend());
}
