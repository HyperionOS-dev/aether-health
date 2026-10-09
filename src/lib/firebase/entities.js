import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, writeBatch } from "firebase/firestore";
import { fb } from "@/lib/firebase/config";

// Firestore layout: users/{uid} holds the profile, users/{uid}/{Entity} holds records.
// Ownership is the path itself, so the created_by_id filter callers pass is implied.

const uid = () => {
  const u = fb().auth.currentUser;
  if (!u) throw new Error("Not signed in");
  return u.uid;
};
const col = (name) => collection(fb().db, "users", uid(), name);
const now = () => new Date().toISOString();

async function commit(ops) {
  for (let i = 0; i < ops.length; i += 500) {
    const batch = writeBatch(fb().db);
    for (const [ref, data] of ops.slice(i, i + 500)) batch.set(ref, data, { merge: true });
    await batch.commit();
  }
}

function entity(name) {
  return {
    // Same positional shape the app already uses: filter(query, sort, limit).
    async filter(_q, sort = "-created_date", n = 1000) {
      const field = sort.replace(/^-/, "");
      const snap = await getDocs(query(col(name), orderBy(field, sort.startsWith("-") ? "desc" : "asc"), limit(n)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    async create(data) {
      const rec = { ...data, created_date: now(), updated_date: now(), created_by_id: uid() };
      const ref = await addDoc(col(name), rec);
      return { id: ref.id, ...rec };
    },
    async bulkCreate(list) {
      const stamp = { created_date: now(), updated_date: now(), created_by_id: uid() };
      await commit(list.map((d) => [doc(col(name)), { ...d, ...stamp }]));
    },
    async bulkUpdate(list) {
      await commit(list.map(({ id, ...d }) => [doc(col(name), id), { ...d, updated_date: now() }]));
    },
  };
}

export const entities = {
  DailyMetric: entity("DailyMetric"),
  Workout: entity("Workout"),
  ImportLog: entity("ImportLog"),
};

export async function me() {
  const u = fb().auth.currentUser;
  if (!u) throw new Error("Not signed in");
  const snap = await getDoc(doc(fb().db, "users", u.uid));
  return { ...(snap.data() || {}), id: u.uid, email: u.email, full_name: u.displayName || "", role: "user" };
}

export async function updateMe(data) {
  await setDoc(doc(fb().db, "users", uid()), { ...data, updated_date: now() }, { merge: true });
}