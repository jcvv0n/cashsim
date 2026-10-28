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

### 2. 初始化远程表（首次会自动创建 D1）

```bash
npm run db:migrate:remote
```

脚本会先执行 `wrangler d1 list --json` 查找 `cashsim-db`，不存在就自动创建，然后把 ID 注入生成配置并执行建表。不需要手动复制 database_id。

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

### GitHub 自动部署（Cloudflare Workers Builds）

1. 先按上面的步骤创建 D1、执行远程建表，并拿到 `database_id`。
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

- `/api/state` 需要登录后的 HttpOnly 签名 Cookie。
- `APP_PASSCODE` 和 `SESSION_SECRET` 只通过 Cloudflare Secret 注入，不进入代码库。
- 如果需要更强保护，可以在 Cloudflare Zero Trust 里给 Worker 配 Access。

数据保存在 D1 的 `app_state` 表里，内容是整份 AppState JSON。免费额度对个人使用足够（5GB 存储、每天 5M 行读 / 100k 行写，以 Cloudflare 当前政策为准）。

## 数据与同步

- 云端：D1 单行 JSON，带 `rev` 乐观锁；多标签页同时修改会提示并加载最新版本。
- 本地：localStorage 作为缓存和离线兜底；API 不可用时自动进入“本地模式”。
- 首次部署时，如果 D1 为空，会把浏览器里的本地数据（或示例数据）迁移上去。
- 支持 JSON 导入/导出。

## 交互

- 点击月度表格里的金额单元格，弹出该月的明细；汇总项会显示“N 笔”。
- 点击外部、按 Esc 或点关闭按钮收起明细。
- 单元格支持键盘操作：Tab 聚焦后按 Enter / 空格打开。

## 模型口径

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
  migrations/0001_init.sql D1 初始化表
  src/
    api.ts                 前端 API 客户端
    engine/                纯 TS 计算引擎，无 DOM 依赖
    main.ts                启动、登录、同步、事件
    render.ts              KPI、月度表格、ECharts 曲线、侧栏列表
    dialog.ts              添加/编辑弹窗
    detail.ts              金额明细弹层
    state.ts               示例数据、校验、localStorage
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
