# CashSim · 现金沙盘

按月估算个人现金流，回答两个问题：

- 每个月还剩多少现金？
- 什么时候会低于安全线、什么时候转负，最大缺口是多少？

## 环境

- Node.js 24+（`.nvmrc` 固定为 24.22.1）
- npm 11+
- Cloudflare 账号（部署时需要）

## 技术栈

- TypeScript 7 + Vite 8
- Vitest 5
- ECharts 6
- Cloudflare Workers + D1
- 原生 DOM，无 UI 框架

## 本地运行

```bash
nvm use
npm install

# 方式一：只跑前端，没有 API 时自动进入本地模式
npm run dev

# 方式二：前端 + Worker API + 本地 D1
cp .dev.vars.example .dev.vars   # 第一次执行
npm run db:migrate:local         # 第一次执行
npm run dev:full                 # http://127.0.0.1:5173
```

本地访问密码在 `.dev.vars` 里，默认是 `dev`。

## 部署到 Cloudflare

### 配置注入方式

- `APP_PASSCODE`：登录密码，Cloudflare Secret，Worker 通过 `env.APP_PASSCODE` 读取。
- `SESSION_SECRET`：会话 token 签名密钥，Cloudflare Secret，Worker 通过 `env.SESSION_SECRET` 读取。
- `COOKIE_NAME`、`SESSION_TTL_SECONDS`：非敏感运行参数，写在 `wrangler.template.jsonc` 的 `vars` 里，Worker 通过 `env.*` 读取。
- `DATABASE_ID`：默认由 `scripts/lib/d1.mjs` 自动查询/创建；也可以设置环境变量显式指定。部署时注入 `wrangler.generated.jsonc`；Worker 只通过 `env.DB` 绑定访问，不直接读取 ID。
- `wrangler.generated.jsonc` 由 `scripts/render-wrangler.mjs` 生成，已 gitignore。

### 1. 登录

```bash
npx wrangler login
```

### 2. 初始化远程表（可选）

```bash
npm run db:migrate:remote
```

这一步是可选的：Worker 首次读取沙盘数据时会自动建表，并把旧版的 `app_state` 数据迁移成“默认沙盘”。提前执行可以避免首次登录多一次建表写入。

脚本会先执行 `wrangler d1 list --json` 查找 `cashsim-db`，不存在就自动创建，然后把 ID 注入生成配置并执行 `migrations/` 下的 SQL。不需要手动复制 database_id。

### 3. 注入访问密码和 token 密钥

```bash
export APP_PASSCODE="<你的访问密码>"
export SESSION_SECRET="$(openssl rand -base64 32)"
npm run secrets:push
```

`secrets:push` 通过 stdin 把值传给 `wrangler secret put`，不会写进配置文件。

如果 Wrangler 提示 Worker 不存在，先执行第 4 步的 `npm run deploy`，再回来执行 `npm run secrets:push`。

### 4. 部署

```bash
npm run deploy
```

部署同样会自动确保 `cashsim-db` 存在，并把 ID 注入生成配置。部署后访问 `https://cashsim.<你的子域>.workers.dev`。

如果想单独查看或创建 D1：

```bash
npm run d1:ensure       # 不存在则创建，并打印 database_id
npx wrangler d1 list
```

### 常见问题：登录后沙盘列表返回 500

能弹出登录框并输入密码，说明 `APP_PASSCODE` 和 `SESSION_SECRET` 已生效；登录成功后 `/api/workspaces` 仍返回 500，通常是 Worker 读不到 D1 数据。按顺序检查：

1. 访问 `https://<你的 Worker 地址>/api/health`：
   - `{"ok":true,"db":"ok"}`：数据库正常。
   - `db: "missing_binding"`：Worker 没有名为 `DB` 的 D1 绑定。确认构建环境变量 `DATABASE_ID` 指向正确的 `cashsim-db`，然后重新部署。
   - `db: "missing_table"`：D1 里暂时没有 `workspaces` 表。首次打开应用会自动建表；如果登录后仍报错，按第 2 步手动建表。
2. 在远程 D1 建表（任选其一）：
   - CLI：`npx wrangler login && npm run db:migrate:remote`
   - Dashboard：D1 → `cashsim-db` → Console，依次执行 `migrations/0001_init.sql` 和 `migrations/0002_workspaces.sql`。
3. 确认 Worker 的 `DB` 绑定和建表用的是同一个 `cashsim-db`。

### GitHub 自动部署（Cloudflare Workers Builds）

1. 先按上面的步骤创建 D1 并拿到 `database_id`（建表可跳过，Worker 首次访问会自动建表）。
2. Cloudflare Dashboard → Workers & Pages → Create → Connect to Git，选择 `jcvv0n/cashsim`。
3. 构建配置：
   - Build command: `npm run build && node scripts/render-wrangler.mjs --require`
   - Deploy command: `npx wrangler deploy --config wrangler.generated.jsonc`
   - Node version: `24`（或设置环境变量 `NODE_VERSION=24`）
4. 构建环境变量：
   - `DATABASE_ID` = 你的 D1 database_id
5. Worker 运行时 Secret（Settings → Variables and Secrets）：
   - `APP_PASSCODE`
   - `SESSION_SECRET`
6. 之后每次 push 到 `main`，Cloudflare 会自动构建并部署。

说明：`DATABASE_ID` 是构建时变量，不是运行时 Secret；它只用于生成 `wrangler.generated.jsonc` 里的 D1 绑定。Worker 运行时仍然只读 `env.DB`。

### CI / 非交互部署

Wrangler 支持从环境变量读取 Cloudflare 凭据：

```bash
export CLOUDFLARE_API_TOKEN="<token>"
export CLOUDFLARE_ACCOUNT_ID="<account_id>"
export APP_PASSCODE="<passcode>"
export SESSION_SECRET="<session_secret>"

npm run deploy
npm run secrets:push
```

如果 CI 里已经预先创建了 D1，也可以额外设置 `DATABASE_ID`，脚本会直接使用它，不再查询/创建。

也可以复制 `.env.example` 为 `.env`，填好后执行 `set -a; source .env; set +a` 再运行上面的命令。

### 安全

- `/api/workspaces` 需要登录后的 HttpOnly 签名 Cookie。
- `APP_PASSCODE` 和 `SESSION_SECRET` 只通过 Cloudflare Secret 注入，不进入代码库。
- 如果需要更强保护，可以在 Cloudflare Zero Trust 里给 Worker 配 Access。

每个沙盘是 D1 `workspaces` 表里的一行，`data` 列是整份 AppState JSON。免费额度对个人使用足够（5GB 存储、每天 5M 行读 / 100k 行写，以 Cloudflare 当前政策为准）。

## 数据与同步

- **沙盘**：每个沙盘是一份独立的推演数据，可以新建、复制、切换、重命名和删除。界面右侧的“沙盘”按钮里能看到所有沙盘及应用内最后保存时间。
- **毫秒版本号**：每个沙盘记录带一个毫秒时间戳 `version`。保存时服务端只接受版本号更大的数据；版本号相同时视为同一次保存。冲突时客户端会加载服务端上版本号更大的数据，并在提示中说明。导出的 JSON 顶层 `version` 是沙盘版本号，`data.schemaVersion` 是数据结构版本（目前为 1），二者含义不同。
- **自动保存**：任何修改都会立即写入 localStorage，并在约 0.4 秒后同步到云端；右上角显示“保存于 …”。
- **多设备**：刷新页面、切回标签页或每 60 秒轮询时都会对比版本号，版本号更大的数据胜出。其他设备保存了更新版本时会自动加载并提示。
- **本地兜底**：API 不可用时自动进入“本地模式”，界面显示“本地保存于 …”，数据仍会保留在浏览器里。
- **旧数据兼容**：旧版的单行 `app_state` 会在首次读取时迁移成“默认沙盘”；旧版 localStorage（`cashsim:v1`）也会迁移成“默认沙盘”。下次自动保存时统一按新的沙盘结构写入。
- **导入/导出**：导出为带 `format`、`name`、`version` 和 `data` 的 JSON；导入时会新建一个沙盘，不会覆盖现有数据，同时兼容旧版直接导出的 AppState JSON。

## 交互

- **沙盘列表**：右上角“沙盘”按钮展示所有沙盘、每个沙盘的最后保存时间和当前标记；可直接切换、重命名或删除。
- **复制新增**：每月收入、固定还款、信用卡账单、一次性事件都支持“复制新增”——弹窗会填入原条目的数据，稍作修改即可保存成新条目。
- **低频操作**：导入、导出、重置当前沙盘、退出登录收在右上角“⋯”菜单里。
- 点击月度表格里的金额单元格，弹出该月的明细；汇总项会显示“N 笔”。
- 点击外部、按 Esc 或点关闭按钮收起明细。
- 单元格支持键盘操作：Tab 聚焦后按 Enter / 空格打开。

## 模型口径

- 所有金额按整数元录入和展示；历史数据中的小数会在读取时四舍五入到整数元。
- 所有金额按月计，不区分还款日、发薪日的先后。
- 期初现金 = 起始月的**月初余额**。如果手里只有今天的余额，把起始月设为下个月，并先扣掉本月剩余未付账单。
- 信用卡账单录的是**还款月份**（钱实际离开账户的月份），不是消费月份。这样不用关心每张卡不同的还款日。
- 固定还款支持两种结束方式：结束月，或剩余期数（优先）。
- 生活费估算只用于**没有实际账单**的月份。某个月录入账单后，该月估算自动停用，避免重复计算。
- 一次性事件正数 = 收入，负数 = 支出；带开关，可用于 what-if。
- 状态：正常 / 预警（低于安全线）/ 破线（余额 < 0）。

## 目录

```text
cashsim/
  worker/index.ts          Cloudflare Worker API + 静态资源
  migrations/0001_init.sql 旧版单行 app_state 表
  migrations/0002_workspaces.sql 沙盘表
  src/
    api.ts                 前端 API 客户端
    engine/                纯 TS 计算引擎，无 DOM 依赖
    main.ts                启动、登录、同步、沙盘切换、事件
    render.ts              KPI、月度表格、ECharts 曲线、侧栏列表
    dialog.ts              添加/编辑弹窗、沙盘命名弹窗
    detail.ts              金额明细弹层
    state.ts               示例数据与校验
    workspace.ts           沙盘本地缓存、版本号、保存时间格式化
    month-picker.ts        月份选择器 Web Component
    format.ts              金额与月份格式化
    style.css
  wrangler.template.jsonc  Worker + D1 配置模板
  wrangler.generated.jsonc 部署时生成，已 gitignore
  scripts/
    lib/d1.mjs             查询/自动创建 D1
    ensure-d1.mjs          打印 database_id
    with-d1.mjs            确保 D1 后执行命令
    render-wrangler.mjs    从 DATABASE_ID 生成配置
    push-secrets.mjs       从环境变量注入 Secret
  .env.example             部署环境变量示例
  vite.config.ts           Vite 开发代理
```
