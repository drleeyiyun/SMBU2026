import { useCallback, useEffect, useState } from "react";
import { apiFetch, readErrorMessage, readJson } from "../lib/api";

type AbilityCategory = "technical" | "planning" | "management" | "sports";

type ArchiveMe = {
  profile: {
    profileDraftPhone: string | null;
    phone: string | null;
  };
  abilityTagsByCategory: Record<AbilityCategory, { id: string; label: string }[]>;
  awards: {
    id: string;
    title: string;
    status: string;
    reason: string | null;
    createdAt: string;
  }[];
  volunteerSummary: { totalHours: number };
};

export default function ArchivePage() {
  const [data, setData] = useState<ArchiveMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draftPhone, setDraftPhone] = useState("");
  const [patchMsg, setPatchMsg] = useState<string | null>(null);
  const [patching, setPatching] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await apiFetch("/archive/me");
    if (res.status === 401) {
      setError("Unauthorized");
      return;
    }
    if (!res.ok) {
      setError(await readErrorMessage(res));
      return;
    }
    const body = await readJson<ArchiveMe>(res);
    setData(body);
    setDraftPhone(body.profile.profileDraftPhone ?? body.profile.phone ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveDraftPhone() {
    setPatchMsg(null);
    setPatching(true);
    try {
      const res = await apiFetch("/archive/me", {
        method: "PATCH",
        body: JSON.stringify({ profileDraftPhone: draftPhone || null }),
      });
      if (!res.ok) {
        setPatchMsg(await readErrorMessage(res));
        return;
      }
      const body = await readJson<{ profile: ArchiveMe["profile"] }>(res);
      setPatchMsg("Saved draft phone.");
      setData((prev) =>
        prev ? { ...prev, profile: { ...prev.profile, ...body.profile } } : prev,
      );
    } finally {
      setPatching(false);
    }
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 text-red-700 dark:text-red-300">
        {error}
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground">Loading…</p>;
  }

  const categories: AbilityCategory[] = ["technical", "planning", "management", "sports"];

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-lg font-semibold">Volunteer</h2>
        <p className="text-2xl font-bold text-foreground">{data.volunteerSummary.totalHours}</p>
        <p className="text-sm text-muted-foreground">total hours</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Ability tags</h2>
        <div className="flex flex-col gap-4">
          {categories.map((cat) => {
            const tags = data.abilityTagsByCategory[cat] ?? [];
            if (tags.length === 0) return null;
            return (
              <div key={cat}>
                <h3 className="mb-2 text-sm font-medium capitalize text-muted-foreground">{cat}</h3>
                <ul className="flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <li
                      key={t.id}
                      className="rounded-full bg-muted px-3 py-1 text-sm text-foreground"
                    >
                      {t.label}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Awards</h2>
        {data.awards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No awards yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {data.awards.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <span className="font-medium">{a.title}</span>
                <span className="ml-2 rounded bg-muted px-2 py-0.5 text-xs">{a.status}</span>
                <p className="text-xs text-muted-foreground">{a.createdAt}</p>
                {a.reason ? <p className="text-xs text-red-600">{a.reason}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-lg font-semibold">Draft phone (demo)</h2>
        <p className="mb-2 text-sm text-muted-foreground">
          PATCH <code className="rounded bg-muted px-1">profileDraftPhone</code> for review flow demo.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            value={draftPhone}
            onChange={(e) => setDraftPhone(e.target.value)}
            className="min-w-[200px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Draft phone"
          />
          <button
            type="button"
            disabled={patching}
            onClick={() => void saveDraftPhone()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Save draft
          </button>
        </div>
        {patchMsg ? <p className="mt-2 text-sm text-muted-foreground">{patchMsg}</p> : null}
      </section>
    </div>
  );
}
