import { STUDENT_GRADE_OPTIONS_ZH } from "academic-catalog";
import { useTranslation } from "react-i18next";

const selectClass =
  "min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-sm w-full";

type Props = {
  value: string;
  onChange: (grade: string) => void;
  /** 为 true 时增加「不限」选项（value 传空字符串） */
  allowAll?: boolean;
  invalid?: boolean;
  /** 是否显示表头必填星号 */
  required?: boolean;
  /** 标签文案场景 */
  labelMode?: "archive" | "programFilter" | "roster";
  className?: string;
};

export function StudentGradeSelect({
  value,
  onChange,
  allowAll = false,
  invalid,
  required = false,
  labelMode = "archive",
  className = "flex flex-col gap-1 text-sm",
}: Props) {
  const { t } = useTranslation("common");

  const labelText =
    labelMode === "programFilter"
      ? t("programSchedule.gradeFilter")
      : labelMode === "roster"
        ? t("rosterAdmin.grade")
        : t("archive.identityLabels.grade" as "archive.identityLabels.nationality");

  return (
    <label className={className}>
      <span>
        {labelText}
        {required ? (
          <span className="text-destructive" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </span>
      <select
        className={
          [
            labelMode === "roster" ? `${selectClass} mt-1 max-w-md` : selectClass,
            invalid ? "border-destructive ring-1 ring-destructive/30" : "",
          ]
            .filter(Boolean)
            .join(" ")
        }
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
      >
        {allowAll ? <option value="">{t("programSchedule.gradeAll")}</option> : null}
        {!allowAll ? (
          <option value="">{t("archive.academicPickGrade")}</option>
        ) : null}
        {STUDENT_GRADE_OPTIONS_ZH.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
    </label>
  );
}
