# 系别专业目录与团委课表发放（设计摘要）

## 背景

招生简章截图给出了五个系别（理学、工学、经济学、文学、管理学）及下属专业，含学制与学位层次。需要：

1. 将所有「系别 / 专业」自由文本改为与目录一致的级联选择，并在服务端校验。
2. 为 `league_admin` 提供按系别 + 专业向学生批量写入课表的能力，且与教务同步课表、时间线展示协调一致。

## 数据与模块

- **`packages/academic-catalog`**：唯一目录源（中文系别名、专业名、展示用学制/层次）。Web 与 API 均依赖此 workspace包。
- **学籍字段**：仍写入 `student_profiles.department` / `major`，值为目录中的中文名称，避免额外迁移。

## 课表存储与同步

- **`schedule_items_cache.schedule_source`**：`school_gateway`（教务同步）与 `league_program`（团委发放）分流。
- **`POST /schedule/sync`**：仅删除并替换当前用户的 `school_gateway` 行，保留 `league_program`。
- **`POST /league/program-schedule/publish`**（`league_admin`）：按 `department` + `major` 查询学生，向每人插入 `league_program` 行；`replace_cohort` 模式先删除这些学生所有 `league_program` 再写入。
- **时间线**：发布后向受影响学生广播 `timeline_refresh`（与既有团委统筹一致），学生打开时间线即可看到课表合并结果。

## 前端

- **`AcademicDeptMajorSelects`**：档案身份区块、师生录入、课表录入页共用。
- **路由**：`/app/league/program-schedule`（导航「课表录入」，仅团委管理员可见）。
- **周课表**：在浏览器本地时区将「起始周参考日 → 对齐周一 ×重复周数 × 每周模板」展开为绝对时间后，调用同一 `POST /league/program-schedule/publish`；**单日调课**仍为逐条 `datetime-local`。

## 验收要点

- 档案提交身份、团委审核通过、师生录入创建学生时，系别 + 专业必须在目录内。
- 教务同步不会清空团委下发的课表。
- 匹配到0 名学生时接口返回成功与 `warning`，不写入行。
