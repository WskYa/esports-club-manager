# 🎮 电竞社团管理系统

基于 **CloudBase 云开发（腾讯云）** 的电竞社团内部管理系统模板：战队、赛事、约战、活动、通知、管理后台一站齐活。

采用 **Vue 3 + 云函数 + NoSQL 文档数据库** 全栈架构，UI 为 Apple 风浅色设计。开箱即用的完整业务系统，修改配置即可部署到自己的云环境。

> 原项目为 HAU CS2 电竞社团实际使用版本，作为通用模板开源。

## 功能一览

- **认证**：学号注册（管理员激活）/ 登录（scrypt 密码哈希 + 自定义登录 ticket）/ 游客浏览 / 修改密码 / 登录失败锁定
- **战队**：创建审核、随机 6 位邀请码加入、招募开关、入队申请审核、踢人 / 转让队长（每队上限 12 人）
- **赛事**：赛事管理、报名审核、对阵录入比分、排行榜（胜场 / 胜率聚合）
- **约战**：发起 → 管理员审核 → 对方队长确认 → 上报比分 → **对方确认后生效**（24h 未确认自动生效），计入排名
- **活动**：发布 / 报名 / 名额限制 / 报名名单
- **通知中心**：入队结果、约战状态、比分确认等站内通知（未读红点）
- **管理后台**：用户管理（搜索 / 分页 / 激活 / 角色 / 毕业 / 删除）、四类审核、注册白名单、公告、操作日志
- **其他**：冠军墙（队徽 / 队员编辑）、首页统计

## 技术架构

```
Vue 3 + Vite 前端（CloudBase 静态托管）
    │ @cloudbase/js-sdk
    │ · 平台认证（自定义登录 ticket / 匿名游客 / 平台账号）
    │ · app.callFunction()
    ▼
cs2-api 云函数（单事件函数，action 分发，承载全部业务逻辑与权限）
    │ @cloudbase/node-sdk
    ▼
CloudBase NoSQL 文档数据库（14 集合，权限 ADMINONLY，客户端不直连）
```

安全设计：密码 scrypt 哈希存储、会话由平台管理、随机邀请码不暴露学号、后端全量输入校验、数据库集合权限收紧、函数允许匿名调用仅用于游客浏览。

## 快速部署（约 15 分钟）

### 前置

- 腾讯云 CloudBase 账号（[控制台](https://tcb.cloud.tencent.com)），创建环境（体验版 / 个人版均可，需包含云函数、数据库、静态托管）

### 1. 配置前端

```bash
cd web
cp .env.example .env
# 编辑 .env：
#   VITE_CB_ENV=你的环境ID（控制台概览页）
#   VITE_CB_PUBLISHABLE_KEY=你的 Publishable Key（身份认证 → 开发设置，无则创建）
```

### 2. 启用登录方式（控制台）

身份认证 → 登录管理：

- 开启 **用户名密码登录**（预置管理员账号用）
- 开启 **匿名登录**（游客浏览用）
- 身份认证 → 自定义登录 → 生成 **自定义登录私钥**（tcb_custom_login.json，注册用户登录用）

### 3. 创建数据库集合（14 个）

`users` `teams` `join_requests` `tournaments` `registrations` `matches` `challenges` `activities` `announcements` `champion` `whitelist_entries` `whitelist_config` `activity_log` `notifications`

每个集合权限设为 **仅管理员可读写（ADMINONLY）**。

### 4. 部署云函数

1. 修改 `cloudfunctions/cs2-api/index.js` 顶部 `ENV` 为你的环境 ID
2. 将自定义登录私钥 JSON 以 base64 编码后设置为函数环境变量 `CUSTOM_LOGIN_KEY`：
   ```bash
   base64 -i tcb_custom_login.json   # 或使用你平台的方式
   ```
   （JSON 格式：`{"private_key": "...", "private_key_id": "...", "env_id": "你的环境ID"}`，字段为下划线命名）
3. 创建云函数 `cs2-api`（Node 18，超时 30s），上传 `cloudfunctions/cs2-api/` 目录
4. 函数安全规则（允许游客访问）：
   ```json
   { "*": { "invoke": true } }
   ```

### 5. 预置管理员账号

- 控制台身份认证 → 用户管理 → 创建用户（用户名密码）：如 `1000000000 / Admin123456`
- 在 `users` 集合手动插入该用户记录（`_id` 为创建用户返回的 UID）：
  ```json
  { "_id": "<用户UID>", "sid": "1000000000", "real_name": "系统管理员", "college": "计算机与软件工程学院", "nickname": "Admin", "qq": "10000", "role": "admin", "status": "在校", "activated": 1 }
  ```
- 可选：在 `champion` 插入 `{ "_id": "1" }`、`whitelist_config` 插入 `{ "_id": "1", "enabled": 0 }` 占位文档

### 6. 部署前端

```bash
cd web
npm install
npm run build
```

将 `web/dist/` 上传到 CloudBase 静态托管，配置网站首页为 `index.html`，并添加 404 → `index.html` 回退规则（SPA 路由）。

### 完成

访问你的静态托管域名，用预置管理员账号登录即可。

## 本地开发

```bash
cd web
npm install
npm run dev   # http://localhost:5173
```

后端逻辑全部在云函数中，修改后重新部署云函数即可。

## 项目结构

```
├── cloudfunctions/cs2-api/   # 云函数（全部后端逻辑）
│   ├── index.js              # 单函数 action 分发：认证/战队/赛事/约战/活动/通知/管理
│   └── package.json
├── web/                      # Vue 3 前端
│   ├── src/
│   │   ├── views/            # 页面（登录/首页/战队/赛事/活动/通知/个人中心/管理后台）
│   │   ├── components/       # 布局与通用组件
│   │   ├── stores/           # Pinia 认证状态
│   │   ├── api.js            # 云函数调用封装（迁移后端时只需重写此文件）
│   │   └── cloudbase.js      # SDK 初始化（环境变量注入）
│   ├── scripts/smoke-test.js # 全链路冒烟测试（40 项断言，验证注册→激活→建队→约战→比分→排名）
│   └── .env.example
└── README.md
```

## 常见问题

- **匿名游客调用云函数报 EXCEED_AUTHORITY**：未配置函数安全规则，按第 4 步设置
- **注册报"该学号已被注册"但用户不存在**：users 集合存在残留占位文档，删除即可
- **自定义登录报"私钥未包含 env_id"**：credentials JSON 必须含 `env_id` 字段，且等于你的环境 ID
- **体验版用户配额**：部分套餐对平台授权用户数有限额，正式启用前评估套餐
- **修改密码**：注册用户走系统内修改；平台预置账号（管理员）走平台控制台

## License

MIT
