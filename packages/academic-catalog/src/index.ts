export type AcademicMajor = {
  id: string;
  nameZh: string;
  durationDisplayZh: string;
  degreeLevelZh: string;
};

export type AcademicFaculty = {
  id: string;
  nameZh: string;
  majors: AcademicMajor[];
};

/** 与招生目录截图一致：系别（页签）→ 专业，含学制与学位层次展示字段。 */
export const ACADEMIC_FACULTIES: AcademicFaculty[] = [
  {
    id: "science",
    nameZh: "理学",
    majors: [
      {
        id: "ics",
        nameZh: "信息与计算科学",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "geography",
        nameZh: "自然地理与资源环境",
        durationDisplayZh: "—",
        degreeLevelZh: "本科",
      },
      {
        id: "chemistry",
        nameZh: "化学",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "biosci",
        nameZh: "生物科学",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "mfps",
        nameZh: "数理基础科学",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "mam",
        nameZh: "数学与应用数学",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
    ],
  },
  {
    id: "engineering",
    nameZh: "工学",
    majors: [
      {
        id: "ise",
        nameZh: "智能感知工程",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "mse",
        nameZh: "材料科学与工程",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "ece",
        nameZh: "电子与计算机工程",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
    ],
  },
  {
    id: "economics",
    nameZh: "经济学",
    majors: [
      {
        id: "fintech",
        nameZh: "金融科技",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "economics",
        nameZh: "经济学",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
      {
        id: "iet",
        nameZh: "国际经济与贸易",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
    ],
  },
  {
    id: "literature",
    nameZh: "文学",
    majors: [
      {
        id: "russian",
        nameZh: "俄语",
        durationDisplayZh: "四年",
        degreeLevelZh: "本科",
      },
    ],
  },
  {
    id: "management",
    nameZh: "管理学",
    majors: [
      {
        id: "ms",
        nameZh: "管理科学",
        durationDisplayZh: "五年 / 四年",
        degreeLevelZh: "本科",
      },
    ],
  },
];

const facultyByNameZh = new Map(ACADEMIC_FACULTIES.map((f) => [f.nameZh, f]));

export function isValidFacultyMajorPair(departmentZh: string, majorZh: string): boolean {
  const f = facultyByNameZh.get(departmentZh.trim());
  if (!f) return false;
  return f.majors.some((m) => m.nameZh === majorZh.trim());
}

/** 将已保存的系别/专业规范到目录内；无法匹配时清空以便重新选择。 */
export function normalizeDepartmentMajorSelection(
  departmentZh: string,
  majorZh: string,
): { department: string; major: string } {
  const d = departmentZh.trim();
  const m = majorZh.trim();
  if (isValidFacultyMajorPair(d, m)) {
    return { department: d, major: m };
  }
  const f = facultyByNameZh.get(d);
  if (f && m && !f.majors.some((x) => x.nameZh === m)) {
    return { department: d, major: "" };
  }
  return { department: "", major: "" };
}

export function majorMeta(departmentZh: string, majorZh: string): AcademicMajor | null {
  const f = facultyByNameZh.get(departmentZh.trim());
  if (!f) return null;
  return f.majors.find((m) => m.nameZh === majorZh.trim()) ?? null;
}

/**
 * 档案年级、师生录入、课表按年级发放共用（须与 `student_profiles.grade` 一致）。
 * 本科学制常用「入学年份 + 级本科」表述。
 */
export const STUDENT_GRADE_OPTIONS_ZH: readonly string[] = [
  "2026级本科",
  "2025级本科",
  "2024级本科",
  "2023级本科",
  "2022级本科",
  "2021级本科",
  "2020级本科",
];

const studentGradeSet = new Set(STUDENT_GRADE_OPTIONS_ZH);

export function isValidStudentGrade(gradeZh: string): boolean {
  return studentGradeSet.has(gradeZh.trim());
}

/** 无法匹配目录时返回空串，便于表单重选。 */
export function normalizeStudentGradeSelection(gradeZh: string): string {
  const g = gradeZh.trim();
  return isValidStudentGrade(g) ? g : "";
}
