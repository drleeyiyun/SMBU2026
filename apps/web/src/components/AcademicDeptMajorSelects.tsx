import { ACADEMIC_FACULTIES } from "academic-catalog";
import { useTranslation } from "react-i18next";

const selectClass =
  "min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm w-full";

type Props = {
  department: string;
  major: string;
  onDepartmentChange: (department: string) => void;
  onMajorChange: (major: string) => void;
  departmentInvalid?: boolean;
  majorInvalid?: boolean;
};

export function AcademicDeptMajorSelects({
  department,
  major,
  onDepartmentChange,
  onMajorChange,
  departmentInvalid,
  majorInvalid,
}: Props) {
  const { t } = useTranslation("common");
  const faculty = ACADEMIC_FACULTIES.find((f) => f.nameZh === department);

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        <span>
          {t("archive.identityLabels.department" as "archive.identityLabels.nationality")}
          <span className="text-destructive" aria-hidden>
            {" "}
            *
          </span>
        </span>
        <select
          className={
            departmentInvalid
              ? `${selectClass} border-destructive ring-1 ring-destructive/30`
              : selectClass
          }
          value={department}
          onChange={(e) => {
            const d = e.target.value;
            onDepartmentChange(d);
            const fac = ACADEMIC_FACULTIES.find((f) => f.nameZh === d);
            const keep = fac?.majors.some((m) => m.nameZh === major) ?? false;
            if (!keep) onMajorChange("");
          }}
          aria-invalid={departmentInvalid}
        >
          <option value="">{t("archive.academicPickFaculty")}</option>
          {ACADEMIC_FACULTIES.map((f) => (
            <option key={f.id} value={f.nameZh}>
              {f.nameZh}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span>
          {t("archive.identityLabels.major" as "archive.identityLabels.nationality")}
          <span className="text-destructive" aria-hidden>
            {" "}
            *
          </span>
        </span>
        <select
          className={
            majorInvalid ? `${selectClass} border-destructive ring-1 ring-destructive/30` : selectClass
          }
          value={major}
          onChange={(e) => onMajorChange(e.target.value)}
          disabled={!faculty}
          aria-invalid={majorInvalid}
        >
          <option value="">
            {faculty ? t("archive.academicPickMajor") : t("archive.academicPickMajorNeedFaculty")}
          </option>
          {(faculty?.majors ?? []).map((m) => (
            <option key={m.id} value={m.nameZh}>
              {m.nameZh}（{m.durationDisplayZh} · {m.degreeLevelZh}）
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
