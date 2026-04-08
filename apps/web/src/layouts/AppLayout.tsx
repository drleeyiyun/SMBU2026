import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";
import { apiFetch, readJson } from "../lib/api";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-primary text-primary-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground",
  ].join(" ");

export default function AppLayout() {
  const { t, i18n } = useTranslation("common");
  const [showLeagueCoordination, setShowLeagueCoordination] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiFetch("/me");
      if (cancelled || !res.ok) return;
      const me = await readJson<{ roles: string[] }>(res);
      if (!cancelled) {
        setShowLeagueCoordination(me.roles.includes("league_admin"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/app/archive" className={linkClass}>
              {t("nav.archive")}
            </NavLink>
            <NavLink to="/app/timeline" className={linkClass}>
              {t("nav.timeline")}
            </NavLink>
            <NavLink to="/app/plans" className={linkClass}>
              {t("nav.plans")}
            </NavLink>
            {showLeagueCoordination ? (
              <NavLink to="/app/league/coordination" className={linkClass}>
                {t("nav.leagueCoordination")}
              </NavLink>
            ) : null}
            <NavLink to="/app/oa" className={linkClass}>
              {t("nav.oa")}
            </NavLink>
            <NavLink to="/app/notifications" className={linkClass}>
              {t("nav.notifications")}
            </NavLink>
          </nav>
          <div className="ml-auto flex gap-1">
            {(["zh", "en", "ru"] as const).map((lng) => (
              <button
                key={lng}
                type="button"
                onClick={() => {
                  void i18n.changeLanguage(lng);
                  localStorage.setItem("lang", lng);
                }}
                className={
                  i18n.language === lng
                    ? "rounded-md bg-muted px-2 py-1 text-xs font-medium"
                    : "rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                }
              >
                {t(`lang.${lng}`)}
              </button>
            ))}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
