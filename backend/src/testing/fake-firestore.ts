/**
 * Minimal in-memory Firestore for unit specs: collections, sub-collections, doc get/set/
 * update (dotted paths), delete, add, getAll, batch, runTransaction, and where() with ==, in and
 * array-contains on (possibly nested) fields. FieldValue arrayUnion / arrayRemove / increment are
 * applied on update and merge-set, and FieldValue.delete() removes a field. select()/limit() are
 * accepted and ignored.
 */
import { Timestamp } from 'firebase-admin/firestore';

type Data = Record<string, any>;
type Op = '==' | 'in' | 'array-contains';

const getPath = (d: Data, path: string) => path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), d);

/**
 * Applies a FieldValue.arrayUnion / arrayRemove / increment to the field's current value, as
 * Firestore does; any other value is written as it is.
 */
function resolveTransform(current: unknown, value: any): unknown {
  const kind = value?.constructor?.name;
  const elements: unknown[] = value?.elements ?? [];
  if (kind === 'ArrayUnionTransform') {
    const arr = Array.isArray(current) ? [...current] : [];
    for (const e of elements) if (!arr.includes(e)) arr.push(e);
    return arr;
  }
  if (kind === 'ArrayRemoveTransform') return Array.isArray(current) ? current.filter(e => !elements.includes(e)) : [];
  if (kind === 'NumericIncrementTransform') return (typeof current === 'number' ? current : 0) + value.operand;
  return value;
}

function setPath(d: Data, path: string, value: unknown): Data {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) {
    // FieldValue.delete() removes the field, as Firestore does.
    if ((value as any)?.constructor?.name === 'DeleteTransform') { const { [head]: _gone, ...kept } = d; return kept; }
    return { ...d, [head]: resolveTransform(d[head], value) };
  }
  return { ...d, [head]: setPath(d[head] ?? {}, rest.join('.'), value) };
}

export class FakeFirestore {
  private readonly stores = new Map<string, Map<string, Data>>();
  private autoId = 0;

  store(name: string): Map<string, Data> {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return this.stores.get(name)!;
  }
  collection(name: string) {
    return new FakeCollection(this, name);
  }
  nextId() {
    return `auto${++this.autoId}`;
  }
  /** Ids of a collection's documents, including ones that only have subcollections (as Firestore's listDocuments). */
  docIdsUnder(col: string): string[] {
    const ids = new Set(this.store(col).keys());
    for (const name of this.stores.keys()) {
      if (name.startsWith(`${col}/`)) ids.add(name.slice(col.length + 1).split('/')[0]);
    }
    return [...ids];
  }
  async getAll(...refs: FakeDocRef[]) {
    return Promise.all(refs.map(r => r.get()));
  }
  /** Runs `fn` with a transaction whose writes are applied after it resolves (no contention). */
  async runTransaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const ops: (() => Promise<void>)[] = [];
    const result = await fn({
      get: (ref: FakeDocRef) => ref.get(),
      set: (ref: FakeDocRef, data: Data, opts?: { merge?: boolean }) => { ops.push(() => ref.set(data, opts)); },
      update: (ref: FakeDocRef, data: Data) => { ops.push(() => ref.update(data)); },
      delete: (ref: FakeDocRef) => { ops.push(() => ref.delete()); },
    });
    for (const op of ops) await op();
    return result;
  }
  batch() {
    const ops: (() => Promise<void>)[] = [];
    return {
      set: (ref: FakeDocRef, data: Data, opts?: { merge?: boolean }) => { ops.push(() => ref.set(data, opts)); },
      update: (ref: FakeDocRef, data: Data) => { ops.push(() => ref.update(data)); },
      delete: (ref: FakeDocRef) => { ops.push(() => ref.delete()); },
      commit: async () => { for (const op of ops) await op(); },
    };
  }
}

/** structuredClone, but Firestore Timestamps stay Timestamps (as a real read returns them). */
function clone<T>(v: T): T {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone) as T;
  if (v && typeof v === 'object' && (v as object).constructor === Object) {
    return Object.fromEntries(Object.entries(v as Data).map(([k, x]) => [k, clone(x)])) as T;
  }
  return structuredClone(v);
}

class FakeDocRef {
  constructor(private readonly db: FakeFirestore, private readonly col: string, readonly id: string) {}
  private get map() { return this.db.store(this.col); }
  async get(): Promise<any> {
    const d = this.map.get(this.id);
    return { id: this.id, exists: !!d, data: () => (d ? clone(d) : undefined), ref: this };
  }
  async set(data: Data, opts?: { merge?: boolean }) {
    const cur = this.map.get(this.id);
    this.map.set(this.id, opts?.merge && cur ? deepMerge(cur, data) : clone(data));
  }
  async update(data: Data) {
    let cur = this.map.get(this.id);
    if (!cur) throw new Error(`update of missing doc ${this.col}/${this.id}`);
    for (const [k, v] of Object.entries(data)) cur = setPath(cur, k, v);
    this.map.set(this.id, cur);
  }
  async delete() { this.map.delete(this.id); }
  collection(name: string) { return new FakeCollection(this.db, `${this.col}/${this.id}/${name}`); }
}

function deepMerge(a: Data, b: Data): Data {
  const out: Data = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const isPlainMap = v && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object;
    out[k] = isPlainMap && a[k] && typeof a[k] === 'object' ? deepMerge(a[k], v) : resolveTransform(a[k], v);
  }
  return out;
}

class FakeQuery {
  constructor(protected readonly db: FakeFirestore, protected readonly col: string, private readonly filters: [string, Op, any][] = []) {}
  where(field: string, op: Op, value: any) { return new FakeQuery(this.db, this.col, [...this.filters, [field, op, value]]); }
  select(..._f: string[]) { return this; }
  limit(_n: number) { return this; }
  async get(): Promise<any> {
    // '__name__' filters on the document id, as in Firestore.
    const match = (id: string, d: Data) => this.filters.every(([f, op, v]) => {
      const x = f === '__name__' ? id : getPath(d, f);
      return op === '==' ? x === v : op === 'in' ? (v as any[]).includes(x) : Array.isArray(x) && x.includes(v);
    });
    const docs = [...this.db.store(this.col).entries()]
      .filter(([id, d]) => match(id, d))
      .map(([id, d]) => ({ id, exists: true, data: () => clone(d), ref: new FakeDocRef(this.db, this.col, id) }));
    return { empty: docs.length === 0, size: docs.length, docs, forEach: (fn: (d: any) => void) => docs.forEach(fn) };
  }
}

class FakeCollection extends FakeQuery {
  doc(id?: string) { return new FakeDocRef(this.db, this.col, id ?? this.db.nextId()); }
  async add(data: Data) { const ref = this.doc(); await ref.set(data); return ref; }
  async listDocuments() { return this.db.docIdsUnder(this.col).map(id => this.doc(id)); }
}
