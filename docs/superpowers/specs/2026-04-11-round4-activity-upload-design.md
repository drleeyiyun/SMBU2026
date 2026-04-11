# Round 4: 社团活动 vs 组织任务、图片上传

## 1. 时间轴受众

- `org_tasks.timeline_audience`: `assignees_only` | `org_members` | `all_students`（默认 `assignees_only`）。
- **社团活动**（UI）：`all_students`，仅社团干部/团委可设；组织须 `active`；须有 `startsAt`/`endsAt`。
- **组织任务**（UI）：`org_members`，干部可设；社团成员均在时间轴看到（不限于被指派人）；须有 `startsAt`/`endsAt`。
- **兼容**：未迁移行为保持 `assignees_only`（仅被指派人）。

时间轴合并：`all_students` 与 legacy `org_timeline_events` 均展示为 `sourceType: org_activity`（原 `org_timeline` 重命名）。`org_members`/`assignees_only` 仍为 `org_task`。

## 2. 图片上传

- `POST /uploads/image`（multipart，`file`），登录用户；白名单 mime；磁盘目录 `UPLOAD_DIR`（默认 `./data/uploads`）；文件名 `UUID` + 扩展名。
- `GET /uploads/:filename` 提供只读下载；响应 JSON `{ url }` 为可展示的绝对 URL（基于请求 Origin 或 `PUBLIC_ASSET_BASE`）。
- 前端档案/徽标等：上传按钮 + `input type=file`，成功后把返回的 `url` 写入表单字段。

## 3. 实施备注

- Vite / nginx 增加 `/uploads` 代理。
-环境变量：`PUBLIC_ASSET_BASE`可选（Docker 无浏览器 Origin 时）。
