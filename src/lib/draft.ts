// مسودّة استلام القطعة — تُحفظ أثناء الكتابة وتُستعاد إن أُغلق التطبيق في المنتصف.
//
// النصوص في localStorage، والصور (ملفات كبيرة) في IndexedDB. تُمسح بعد الحفظ الناجح أو
// عند «بدء من جديد». وإن انقطع الحفظ نفسه بين قطعة وأخرى، نحفظ معرّفات ما حُفظ فعلاً
// حتى يُكمل الموظف الباقي ويطبع إيصالاً واحداً يجمعها كلها.

const KEY = "repair.intakeDraft";
const DB = "repair-drafts";
const STORE = "files";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type DraftItem = {
  key: string;
  name: string;
  type: string;
  karat: string;
  weight: string;
  problem: string;
  cost: string;
};

export type IntakeDraft = {
  at: number;
  step: number;
  phone: string;
  customerName: string;
  customerId: string;
  branchId: string;
  promisedAt: string;
  items: DraftItem[];
  /** تذاكر حُفظت قبل أن ينقطع الحفظ — تُضمّ لإيصال الباقي. */
  savedIds: string[];
};

export function loadDraft(): IntakeDraft | null {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? "null") as IntakeDraft | null;
    if (!d || Date.now() - d.at > MAX_AGE_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export function saveDraft(d: Omit<IntakeDraft, "at">) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...d, at: Date.now() }));
  } catch {
    /* تخزين ممتلئ أو غير متاح — المسودّة اختيارية */
  }
}

export async function clearDraft() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* لا شيء */
  }
  await withStore("readwrite", (s) => s.clear()).catch(() => {});
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/** صور قطعة واحدة (مفتاحها key القطعة). */
export async function saveItemFiles(key: string, files: File[]) {
  await withStore<unknown>("readwrite", (s) =>
    (files.length
      ? s.put(files.map((f) => ({ name: f.name, type: f.type, blob: f as Blob })), key)
      : s.delete(key)) as IDBRequest<unknown>,
  ).catch(() => {});
}

export async function loadItemFiles(key: string): Promise<File[]> {
  try {
    const rows = (await withStore("readonly", (s) => s.get(key))) as { name: string; type: string; blob: Blob }[] | undefined;
    return (rows ?? []).map((r) => new File([r.blob], r.name, { type: r.type }));
  } catch {
    return [];
  }
}
