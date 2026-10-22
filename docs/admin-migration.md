# Admin 与 Image Factory 跨项目迁移文档

交接日期：2026 年 10 月 22 日。接收项目需要连接当前应用使用的**同一个 Supabase 项目，包括 PostgreSQL、Auth 和 Storage**，完整迁移后台与图片工作流。现有用户、图片、投票和管理员权限继续使用原记录，无需导出再导入业务数据。

交付物：本文件与同目录的 `admin-migration-source.zip`。ZIP 保存当前工作区的实际源码、字体、相关测试、SQL 历史和配置参考；`SOURCE_MANIFEST.json` 列出每个文件的 SHA-256。它是用于合并的源码交接包，不是可以覆盖任意目标仓库的完整应用模板。

当前 Git HEAD 为 `30c9dd60664a1244902b4359359403cc3c0637d9`，但交接包包含当前尚未提交的后台界面修改；**只 checkout 这个 commit 无法得到同一版本**。以 ZIP 内的源码与校验清单为准。本次交付只生成迁移材料，没有删除当前 app 的 admin，也没有修改线上数据库。

## 1 先确定迁移范围

当前有两套不同的图片工作流，都包含在交接范围内：

| 范围 | 入口 | 当前实现 |
| --- | --- | --- |
| Admin 控制台 | `/admin` → `/admin/users`；另有 `/admin/media`、`/admin/votes` | Google 登录和实时超级管理员校验；用户与投票只读；媒体上传、AI 生成、编辑标题与描述、发布、删除 |
| Admin 图片生成 | Media → Create media → Generate with AI | 文本 prompt → Ark Seedream → 下载 → WebP 标准化 → 私有保存 → 单独发布 |
| Checked Factory | `/disguise`、`/disguise/preview` | 上传原图 → Gemini 生成五条文案 → 服务端在同一原图上叠字 → 缓存五张预览 → 选一张发布 |

Checked Factory 当前是**完成 onboarding 的登录用户功能**，并非 admin 页面内的另一个 tab。复刻当前行为时保留这一权限范围。如果新项目是纯管理员应用，可以额外对 factory 的页面、GET、POST、DELETE 全部加 `requireAdmin`，但这是权限范围变更，应独立验收。

后台没有用户编辑、封号、重置密码、网页授予管理员、修改投票、星级评分、撤回发布、替换原图、修改已保存图片 owner、批量生成等功能。`Save captions` 只改数据库的 `title` 与 `description`，不会重绘图片上的文字。

“100% 一致”指使用相同源码、UI、模型配置、提示词、渲染参数、存储结构和状态处理。Gemini/Seedream 的新生成结果不保证每次相同；现有 factory 预览和已发布图片可以继续读取同一 Storage 字节。像素渲染验收应使用固定输入及文案，而非要求两次模型调用生成同一笑话。

## 2 接收项目的执行顺序

1. 把 ZIP 解压到临时目录，先读本文件及 `SOURCE_MANIFEST.json`，再选择性合并。不要直接在已有目标项目根目录解压覆盖 `package.json`、layout、proxy 或 Next 配置。
2. 保留 App Router、Node 服务端运行环境和 `@/*` 路径别名，合并依赖、登录、共享工具及字体。
3. 配置同一个 Supabase 项目的 URL、publishable key 和 server secret，再配置 Ark/Gemini。
4. 在 Supabase 做第 5 节的只读结构检查；只有缺失的新结构才通过可信维护流程安装。不要重跑所有历史 migration。
5. 配置新站点 OAuth 回调，验证现有 Google 用户在新域名仍得到相同 `auth.users.id`。
6. 迁移所有 admin 页面/API，完成第 6 至 8 节行为。
7. 迁移 factory 的持久 layout、页面/API、原样渲染器、模型提示词和过期清理。
8. 明确两个项目之间的缓存刷新与 cron 归属，部署接收项目，完成第 13 节验收。
9. 新项目通过后，才按第 14 节从原 app 移除 admin。保留原 app 正在使用的图片和登录公共模块。

## 3 源码合并清单

下列路径均相对于源仓库根目录。压缩包保留原目录结构；额外的传递依赖以 manifest 为准。

| 文件或目录 | 用途及合并要求 |
| --- | --- |
| `app/admin/**` | 所有后台页面、layout、error boundary、查询参数转换、`console.tsx` 和 `admin.module.css`；整组迁移 |
| `app/api/admin/**` | users、media、votes、generate、preview、publish、PATCH、DELETE 全部路由 |
| `lib/admin/**` | 权限、页面守卫、HTTP/Origin 检查、服务端业务逻辑、DTO；整组迁移 |
| `app/disguise/**` | factory 上传和预览两页、持久 layout、客户端状态、样式和 loading；不要拆掉共享 layout |
| `app/api/factory/**`、`lib/factory/**` | 批次 API、生成编排、固定字体渲染、完整提示词、批次 DTO |
| `lib/seedream.ts`、`lib/seedream-generation.ts`、`lib/seedream-reference.ts` | Seedream 模型配置、生成、图片输入验证；admin 依赖它们，factory 也复用验证与错误类型 |
| `lib/gallery-media.ts`、`lib/gallery-types.ts`、`lib/gallery-http.ts` | Storage、图片校验/发布、UUID、factory 登录及 Origin 检查；factory 发布的原字节分支必须保留 |
| `lib/supabase.ts`、`lib/auth/**`、`lib/roast/read-body.ts` | elevated Supabase client、cookie session、profile/onboarding、返回路径、受限 body 读取 |
| `app/auth/**`、`app/login/**`、`app/profile/**`、`app/onboarding.tsx` | Google OAuth、登出、profile 完成流程；已有完整流程可合并，不能漏掉 admin 返回路径逻辑 |
| `proxy.ts` | 刷新 session、覆盖 `x-checked-admin-return`、私有缓存头；与目标项目已有 proxy 合并 |
| `app/layout.tsx`、`app/globals.css`、`app/ego.css` | 根字体、主题、共享 shell、onboarding、factory 全屏规则；属于参考合并文件，避免覆盖目标 app |
| `app/account-menu.tsx`、`app/sidebar*`、`app/app-header.tsx`、`app/ui.tsx` | 原外壳与 Admin 菜单入口；依赖组件也包含在包内 |
| `app/fonts/anton.ttf`、`app/fonts/inter.ttf` 及对应 OFL 文本 | 保留原字体文件及许可证；Anton 同时用于服务端图片描字 |
| `app/loading-indicator*`、`lib/disguise-draft.ts` | 加载界面；Get Checked → Factory 的 5 分钟内存图片交接 |
| `app/api/cron/ego/route.ts`、`vercel.json` | 目前负责 battle 媒体和 factory 过期清理；按第 11 节确定部署归属 |
| `scripts/admin-setup.mjs`、`scripts/factory-migrate.mjs` | 仅可信本地维护工具，不可导入网页/API |
| `scripts/leaderboard-admin.mjs` | 现有额外管理 CLI：价格、销售、退款；不属于 admin 页，迁移运维职责时一并保留 |
| `scripts/admin*.test.mjs`、`scripts/factory*.test.mjs`、`scripts/disguise-ui.test.mjs`、两个 loader | 原样迁移回归测试；依赖历史 SQL，不能只带最新两条 migration |
| `supabase/migrations/*.sql` | 当前本地完整 SQL 文件集，含部分普通文件搜索会忽略的历史文件；用于查结构和本地测试，不是线上一键重放清单 |
| `package.json`、`package-lock.json`、`tsconfig.json`、`next.config.ts`、PostCSS/ESLint 配置 | 对照合并，已有项目保留自己的入口与无关配置 |

包中带有 `.env.example`，不包含 `.env.local`、凭证、数据库导出、真实用户图片、`node_modules`、`.next` 或 `.git`。新项目中的 `/gallery`、`/my-works`、`/profile` 等链接需要接入已有页面，或改为原用户站点的绝对 URL；这些完整用户业务页面不在本次后台源码包范围内。

## 4 运行环境与环境变量

### 4.1 依赖和 Next.js 约定

当前 `package.json`：Next `16.3.5`、React/React DOM `19.2.8`、`@supabase/ssr ^0.12.7`、`@supabase/supabase-js ^2.117.0`、`sharp ^0.35.5`、`opentype.js ^2.0.0`、`server-only ^0.0.1`。样式使用 Tailwind 4 与 CSS Modules。按包内 lockfile 安装可以保留确切依赖解析；已有目标项目合并依赖后应生成自己的 lockfile。

源环境验证使用 Node `v24.14.0`。测试 loader 使用 `node:module.registerHooks`；不要仅按 Next 的最低 Node 版本来判断这套测试能否运行。部署必须支持 `sharp`、文件读取、Buffer、Node crypto 和 OpenType，不能把这些 route 改成 Edge runtime 或静态导出。

写接收项目代码前先读其 `node_modules/next/dist/docs/`。当前版本使用 `proxy.ts`；`cookies()`、`headers()`、route `params`、page `searchParams` 按现有代码 `await`；`after()` 用于 factory 发布后的清理。不要套用旧版同步参数或另建第二个 middleware。

配置合并后在目标项目运行：

```bash
npm ci
npm run dev
```

`next.config.ts` 必须保留 `outputFileTracingIncludes: { "/api/factory": ["./app/fonts/anton.ttf"] }`。改 API 路径时同步改 tracing key。函数产物中缺字体会导致本地成功、部署后渲染失败。保留 `experimental.serverActions.bodySizeLimit: "3mb"` 以支持 profile 表单；它不控制 route handler 的 body 大小。公开图片优化白名单只允许同一 Supabase 的 `gallery-photos`，私有 admin preview 不经过公开 image optimizer。

源 `proxy.ts` matcher 已包含 `/admin/:path*`、`/api/admin/:path*`，但没有 `/disguise/:path*` 与 `/api/factory/:path*`。目标项目如果也需要在 factory 入口主动刷新 session，可加入后两项；页面/API 自身的身份与 owner 校验仍必须保留，不能由 proxy 替代。

### 4.2 环境变量

| 名称 | 配置 | 位置与用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 使用原应用的同一 Supabase URL | 可公开的项目 URL；不能换成另一个 Auth/Storage 项目 |
| `SUPABASE_PUBLISHABLE_KEY` | 原 Supabase 项目 publishable/anon key | 用户 cookie session 和 RLS 权限查询；当前代码没有使用 `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SUPABASE_SECRET_KEY` | 原项目授权的 server secret | 服务端 elevated client，绕过 RLS；不可使用 `NEXT_PUBLIC_` 前缀 |
| `ARK_API_KEY` | 通过可信凭证渠道配置 | Admin Seedream 生成必需；五文案 factory 不调用 Ark |
| `GEMINI_API_KEY` | 通过可信凭证渠道配置 | Factory 文案生成必需 |
| `GEMINI_MODEL` | `gemini-3.8-flash` | 源工作区当前值，同时也是 `.env.example` 值；代码没有模型 fallback |
| `CRON_SECRET` | 在承担 cron 的部署环境设置 | `/api/cron/ego` Bearer 认证；源本地 `.env.local` 尚未配置，不能假定新部署已有 |
| `SUPABASE_ACCESS_TOKEN` | 仅可信本地维护环境 | Supabase Management API，供两个 migration/bootstrap 脚本使用；不需要部署到应用服务器 |

将真实值放入被 Git 忽略的本地 env 或托管平台 secret 设置，不写入本文/源码包。改变本地 env 后重启 dev；改变部署 env 后重新部署。源本地是否配置密钥不代表线上部署配置状态。

`ROAST_PROVIDER` 与 roast 流程不决定 factory 文案；即使 `ROAST_PROVIDER=mock`，factory 仍直接调用 Gemini。不要把 roast mock 当成 factory 的免费测试开关，使用附带的 mocked tests。

## 5 同一数据库的结构与权限

### 5.1 先做只读检查

在该 Supabase 项目 SQL Editor/可信数据库会话执行：

```sql
select to_regclass('public.profiles') as profiles,
       to_regclass('public.images') as images,
       to_regclass('public.photo_votes') as photo_votes,
       to_regclass('public.ego_votes') as ego_votes,
       to_regclass('public.image_sales') as image_sales,
       to_regclass('public.gallery_uploads') as gallery_uploads,
       to_regclass('public.factory_batches') as factory_batches;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('profiles', 'images', 'factory_batches')
order by table_name, ordinal_position;

select p.oid::regprocedure::text as signature,
       p.prosecdef as security_definer, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_users_page', 'admin_media_page',
                   'admin_votes_page', 'ego_maintenance');

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('generated-images', 'gallery-photos', 'gallery-staging',
             'profile-photos', 'challenge-entries');
```

同时检查 `pg_policies`、table/column privileges、`factory_one_generation_per_user` 唯一索引、`photo_votes` 的 `ON DELETE CASCADE`、`image_sales.image_id` 的 `ON DELETE RESTRICT`，以及第 5.3 节三个 RPC 的精确签名和角色授权。只确认表存在不足以验收权限。

这是共享数据库迁移，通常无需修改 schema。`admin-setup.mjs migrate` 的已安装判断仅覆盖管理员列与三个 RPC 数量；factory 脚本只判断批次表是否存在。脚本成功不能替代权限、函数内容和索引审计。历史 migration 包含表合并/删除操作，不能整体重放。

确实缺失 admin/factory 结构时，先无写入检查，再由可信维护人员安装：

```bash
node --env-file=.env.local scripts/admin-setup.mjs migrate
node --env-file=.env.local scripts/factory-migrate.mjs
# 确认是目标共享数据库且相应结构缺失后，分别安装：
node --env-file=.env.local scripts/admin-setup.mjs migrate --apply
node --env-file=.env.local scripts/factory-migrate.mjs --apply
```

Admin migration：`20261020000001_admin_area.sql`；factory：`20261019000000_factory_batches.sql`。前者 SQL 本身不是幂等脚本；用脚本检查，不要直接重复执行。若结构部分安装，先修复具体缺项，不能通过删表重建处理。

### 5.2 业务表与 Storage

| 对象 | 必须保留的契约 |
| --- | --- |
| `auth.users`、`auth.identities` | Supabase 用户 ID、已确认邮箱、Google provider identity；后台用户列表来自 Auth 左连接 profile，包含未建 profile 的账号 |
| `profiles` | `id`、`first_name`、`last_name`、`state_code`、`created_at`、`onboarding_completed_at`、`is_superadmin boolean not null default false`；普通客户端不能写管理员标志 |
| `images` | `id`、`contributor_id`、`source`、private/public storage path、title≤100、description≤1000、created/published 时间；保留 owner 路径约束与发布状态约束 |
| `photo_votes` | `photo_id` 指向 `images.id`，`voter_id`、`value` 为 ±1；删除图片级联删除这些票；仅允许已发布目标 |
| `ego_votes` | `challenge_id`、`voter_id`、`target_id`；后台 Battle 分页只读，不可为新后台重建或清空 |
| `image_sales` | 引用图片并阻止删除；保留价格/销售/退款现有约束与服务端 RPC |
| `gallery_uploads` | 旧上传来源的发布 ticket；`publishGalleryImage(..., "upload")` 分支仍依赖，不要改旧记录的 source |
| `factory_batches` | 服务端私有批次；结构及状态见第 10 节 |
| `generated-images` bucket | private；WebP；10 MiB；admin 保存 `${owner}/${imageId}.webp`，factory 保存 `${user}/factory/${batch}/${index}.webp` |
| `gallery-photos` bucket | public；WebP；10 MiB；发布时创建 `${owner}/${randomUUID()}.webp`，路径 UUID 不等于 image ID |
| `gallery-staging` bucket | private；JPG/PNG/WebP；10 MiB；兼容原上传发布流程 |
| `profile-photos`、`challenge-entries` bucket | 登录外壳头像与 battle 维护依赖；复用现有，不改为公开 |

`images.source` 只有 `upload` / `generated`。**后台手动上传的成品图当前也保存为 `source="generated"`**，因为它需要先保存为私有记录；这不是漏改。`source="upload"` 的历史记录只能是已发布、没有 private path。不要为了 UI 文案把后台上传改成 upload，否则会破坏现有约束和发布分支。

不要恢复 `generated_images`、`gallery_photos`、`work_captions` 或 `my_works` view；它们是历史结构，当前保存记录使用统一 `images`。SQL 历史保留这些名称是为了迁移回放测试。

### 5.3 后台分页 RPC

三个函数都是 `SECURITY DEFINER`、`search_path=''`，只授予 `service_role` execute，撤销 `public`、`anon`、`authenticated`。浏览器不能直接调用。应用在权限校验后调用 elevated client。

| 签名 | 行为 |
| --- | --- |
| `admin_users_page(text, integer, integer, boolean)` | 参数 `p_search,p_offset,p_limit,p_completed`；账户创建时间、ID 倒序；大小写无关的字面子串搜索账号 ID/email/姓名；completed 过滤用于 owner 搜索 |
| `admin_media_page(text, uuid, text, text, integer, integer)` | `p_search,p_owner,p_source,p_status,p_offset,p_limit`；按图片创建时间、ID 倒序，附带实时 up/down 总数 |
| `admin_votes_page(text, uuid, uuid, smallint, integer, integer)` | `p_kind,p_target,p_voter,p_value,p_offset,p_limit`；gallery 按 photo_id/voter_id 升序，battle 按 challenge_id/voter_id 升序 |

返回 `{items: [...], total: "123"}`；`total`、media 的 `upvotes` 和 `downvotes` 是十进制字符串，UI 使用 `BigInt`，不要转为可能丢精度的 Number。精确字段以包内 `lib/admin/types.ts` 和 SQL 为准。

## 6 登录与超级管理员权限

新 app 复用当前 Supabase Auth Google provider。一个独立域名需要单独建立 cookie session；共享数据库不会自动共享原站浏览器登录态。在 Supabase Auth 的 URL/redirect 配置中保留原站，并加入新站精确的 `/auth/callback`；本地使用实际端口的 callback。Google provider 使用同一 Supabase 回调，不要随意重建 OAuth 项目；若改变了 provider 回调配置，再同步相应 Google 配置。

完整流程：`/login?next=/admin/...` → `loginWithGoogle` 设置 `ego_return` cookie（HttpOnly、SameSite=Lax、生产 Secure、path=/、1 小时）→ Google → `/auth/callback` → `exchangeCodeForSession` → 读取 profile → 完成 onboarding 后回 admin。保留 `returnPath` 对 `//`、反斜线、换行、长度的限制，防止开放重定向。只有 admin 目的地覆盖原有 welcome 流程。

每次 admin 页、API、preview、底层业务函数调用都要：

1. 用用户 cookie 客户端 `auth.getUser()` 验证用户；未登录 401。
2. 要求 `email_confirmed_at` 且 identities 中存在 `provider="google"`；否则 403。
3. **先用用户 RLS 客户端**读 `profiles.is_superadmin`，必须严格等于 true；不是按 email 硬编码，不是 JWT metadata，不是前端布尔值。
4. 查询失败返回 503，拒绝继续；不能把数据库错误当成允许访问。
5. 然后才使用 `lib/supabase.ts` 的服务端 elevated client。

权限不跨操作缓存。撤权后的下一次请求应失败，长时间 Seedream 调用结束后还要再次校验管理员与 owner。页面未登录跳转到带 next 的登录页，403 显示 notFound；后台动态渲染并设置 robots noindex/nofollow。API 的权限错误保持 JSON。

已有超级管理员无需重授予。确需新增，先让该 Google 用户建立 profile，再由可信本地终端执行（替换邮箱）：

```bash
node --env-file=.env.local scripts/admin-setup.mjs inspect admin@example.com
node --env-file=.env.local scripts/admin-setup.mjs grant admin@example.com
node --env-file=.env.local scripts/admin-setup.mjs grant admin@example.com --apply
node --env-file=.env.local scripts/admin-setup.mjs inspect admin@example.com
```

grant 要求恰好一个现有账号、confirmed email、Google identity、已有 profile；使用事务和行锁。后台创建媒体另要求 owner 已完成 onboarding。撤权通过可信 SQL 把该 profile 的 `is_superadmin` 设为 false；没有网页 revoke/grant API。

原根 layout 根据同样的 Google/confirmed/admin 条件显示 account menu 的 Admin 链接。菜单只是导航，不能替代服务端校验。独立 admin app 的 `/` 可导向 `/admin`；需要同步处理原 shell 的 public links、登录 fallback 和 `/profile/complete` 返回目的地，避免跳到不存在的页面。

## 7 所有后台页面的行为

### 7.1 公共布局与分页

标题 `Control room.`、SUPERADMIN badge，三个 tab：Users & profiles、Media、Votes & ratings。`/admin` 默认跳 Users。时间使用 `en-US`、`America/New_York`、medium date/short time。主题及字体见第 12 节。

默认 `page=1`、`limit=25`；API 允许 page 1–10000、limit 1–100，只接受十进制数字；offset 为 `(page-1)*limit`。UI 提供 Previous/Next、页码、总数、Apply filters、Clear；没有 page-size 下拉。搜索 trim 后最多 200 字符。空结果显示 `No matching records.`。

请求期间禁用变更按钮，显示 Working；成功显示 notice 并 `router.refresh()`。401 回到对应 section 登录入口。过滤值错误应显示错误/重试，不能无提示地返回错误范围的数据。

### 7.2 Users and profiles

只读展示：email、account UUID、姓名（无 profile 显示 Awaiting profile）、state、Admin badge、onboarding complete/pending、Auth 账号创建时间与 profile 创建时间。Search 支持 email/姓名/账号 ID。不要把列表改成仅查 profiles，否则漏掉待注册完成的 Auth 用户。

### 7.3 Saved media

筛选：search（title/description/media UUID）、owner UUID、source（all/generated/upload）、status（all/private/published）。

每行包含：112×90 受保护预览、media UUID、可编辑 title/description、Save captions、owner 姓名/UUID、source、私有/已发布状态、创建/发布时间、up/down 总数、Publish（仅私有显示）和 Delete。

Create media 是可展开面板，支持 Upload finished image / Generate with AI；默认 owner 为当前 admin。Find another owner 调 `/api/admin/users?completed=true&limit=100&search=...`，只显示完成 onboarding 的 owner，最多 100 条，超过需缩小搜索。搜索完成后 owner 选项重置到当前 admin。owner 必须在创建前确定，之后不提供修改。

标题与描述允许空字符串，保存前 trim，分别最多 100/1000 字符。创建成功重置表单、保留模式/owner 状态，并提示图片已私有保存。上传文件按钮和文件名状态按现有 `console.tsx` 实现，不能丢失当前未提交的文件选择 UI。

Delete 打开确认弹窗，列明永久删除及票据影响；Cancel/Escape 关闭，Tab 保持焦点在对话框按钮中，默认焦点 Cancel。确认后才发删除请求。409 销售引用错误时保留弹窗并展示原因。

### 7.4 Votes and ratings

全只读。Gallery：media title/UUID、voter 姓名/UUID、Upvote/Downvote；筛选 target media UUID、voter UUID、value 1/-1。Battle：challenge UUID、voter、投给的 participant 姓名/UUID；target 参数在这里指 challenge，不是 participant。

切换 kind 后立即提交筛选并清空 gallery value；battle 请求带 value 会被拒绝。没有独立星级系统，也不展示不存在的评分时间列。

## 8 后台 HTTP 契约

成功与业务错误响应统一设置 `Cache-Control: private, no-store`、`X-Content-Type-Options: nosniff`。非 GET/HEAD 请求的 `Origin` 必须严格等于 `new URL(request.url).origin`；缺失/异域均 403。新后台页面应调用自身域名的 `/api/admin`，不能在浏览器跨域调用旧站 API。代理部署要确保应用感知的请求 origin 正确。

| 方法和路径 | 输入 | 成功响应 |
| --- | --- | --- |
| `GET /api/admin/users` | page/limit/search；`completed=true` 可选 | `{items: AdminAccount[], total: string}`，200 |
| `GET /api/admin/media` | page/limit/search/owner/source/status | `{items: AdminMedia[], total: string}`，200 |
| `GET /api/admin/votes` | page/limit/kind/target/voter/value；kind 默认 gallery | `{items: AdminVote[], total: string}`，200 |
| `POST /api/admin/media` | multipart：`file,owner,title,description`；owner 缺省/空字符串回当前 admin | `{id}`，201 |
| `POST /api/admin/media/generate` | JSON：`{owner,title,description,prompt}`；prompt 非空且原始长度≤4000 | `{id}`，201；`maxDuration=180` |
| `GET /api/admin/media/:id/preview` | UUID | WebP bytes，200，inline；private path 优先，否则 public path |
| `PATCH /api/admin/media/:id` | JSON：`{title,description}` | `{id,title,description}`，200；忽略 owner/path/source 等额外字段 |
| `POST /api/admin/media/:id/publish` | 无 body | `{id}`，200；重复调用已发布项不产生第二记录 |
| `DELETE /api/admin/media/:id` | JSON：`{confirmed:true}` | `{deleted:true}`，200；不存在项也可安全重试 |

JSON body 上限 32768 bytes；multipart 读取上限 `2*1024*1024+65536`，文件本身上限 2 MiB。JSON 无效/过大当前返回 400，multipart 超限 413。未知服务端失败统一 503，不向客户端泄漏原始 provider/数据库错误。401 未登录、403 权限/Origin、404 媒体或预览不存在、409 引用冲突、502 provider 失败、504 超时。

Admin preview 由认证端点下载并流式返回，不返回可复用的 Storage signed URL；每次读取重新检查权限，路径必须以前缀 `${contributor_id}/` 开始。不要通过 `next/image` 公共优化服务代理这些私有内容。

## 9 Admin 图片上传生成发布删除

### 9.1 上传与持久化

成品图仅 JPG/PNG/WebP、非空≤2 MiB、静态图、≤2400 万像素；服务端用 sharp 校验真实格式、拒绝动画，应用 EXIF orientation。缩放至 2048×2048 边界内、不放大、保持比例，转 WebP quality 85，最终≤10 MiB。

先检查 owner 是 UUID 且 profile 已完成 onboarding，再上传 `generated-images/${owner}/${newImageUUID}.webp`、`upsert:false`，之后插入 `images` 私有记录。owner 不提供时默认当前 admin。Storage 成功而 DB insert 失败时删除刚上传对象，不能留下半成品记录。

### 9.2 Seedream 配置与调用

精确复制 `lib/seedream.ts` 的模型 `doubao-seedream-5-0-flash-260915`。Admin 的生成入口不带 reference image，不走 legacy disguise 改脸 prompt。请求为：

```text
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
Authorization: Bearer <ARK_API_KEY>
Content-Type: application/json

model: doubao-seedream-5-0-flash-260915
prompt: 管理员输入 trim 后的原始 prompt
size: 2K
response_format: url
watermark: true
```

provider 超时 150 秒，结合 request abort；使用 `data[0].url`，必须为 HTTPS。后续下载只允许 `volces.com`、`volccdn.com`、`byteimg.com`、`volcengine.com`、`ibytedtos.com` 及其子域，拒绝端口、credentials、HTTP；所有重定向同样检查，最多执行四轮下载/跳转请求。每轮 30 秒超时，下载≤20 MiB，不能改成任意 URL 代理。

下载后走与 admin 上传相同的标准化（输入限制放宽至 20 MiB），重新核验管理员及 owner，再私有保存。Ark 401/403、429、`SetLimitExceeded` 分别展示源码中相应的权限、额度/繁忙、账户使用上限提示；服务端不打印密钥。

### 9.3 发布

`publishAdminMedia` 要求 owner 仍为完成 profile，调用 `publishGalleryImage(owner,id,source)`。生成来源从 `generated-images` 下载，历史 upload 来源从 `gallery-staging` ticket 下载（ticket 发布有效期 2 小时）。

一般图片再次标准化后上传 `gallery-photos` 的新随机路径，再条件更新同一 `images` 行的 `public_storage_path` 与 `published_at`。并发失败请求只清理自己新上传的对象，读取获胜记录作为幂等成功。保留已有 image ID、owner 和私有原图；不要用发布动作创建新的 image UUID。

Factory 路径 `${user}/factory/` 是特殊分支：校验 WebP/尺寸/≤10 MiB 后**复制原始 bytes**，不 resize、不重编码。后台发布一张 factory 私有图时也必须走这一分支。

### 9.4 删除与清理

先删除 `images` 行并取回 owner/private/public paths，DB 成功后再删除相应两个 bucket 的对象，且只允许删除 owner 前缀下的路径。`photo_votes` 级联删除；被 sales 或其他 restrict 外键引用时，Postgres `23503` → HTTP 409，文件不得先删。

Storage 删除失败时当前接口仍成功，日志为 `Admin media Storage cleanup requires retry`，仅记录 bucket/path，可信维护人员按路径重试。现有后台没有自动重试队列；不要把 `cleanupFactoryBatches` 当成普通 admin 孤儿对象清理器。

## 10 五文案 Checked Factory 的完整复刻

### 10.1 UI 与输入

`/disguise/layout.tsx` 在已完成 onboarding 的用户下创建一个持续存在的 `DisguiseStudio`；两个 page 仅提供 metadata 并返回 null，studio 根据 pathname 切换画面。上传状态/未完成生成请求必须能跨这两页导航保留。

上传支持文件选择或拖放 JPG/PNG≤2 MiB，浏览器先预览，不发模型请求；Keyword 可空、最多 500 字符。点击 Create meme 才 push 到 preview 并发生成，没有额外 provider-consent checkbox；请求中的 `approved:true` 由动作发送。

服务端额外要求 JPEG/PNG data URL≤2800000 字符、Base64 合法、实际 bytes≤2097152、真实格式与 MIME 一致、静态图、15≤宽高≤6000、总像素≤2400 万。不要混同 admin 上传允许的 WebP。

预览桌面左图右五选项，手机上图下文案；点击不同选项只换已缓存图片，不调用模型。生成时有 modal/loader/Cancel；发布时锁定选择，失败显示 Retry publishing，不能换另一个 caption 重试。成功显示 CHECKED 动画、Create Another Meme 和 View in gallery；关闭成功窗回已发布预览。

返回 New meme 只回上传页，不立即删除批次；再次 Create meme 时才 discard 上一个批次。取消会 abort 请求、使迟到响应失效，并请求删除 batch。Create Another Meme 清空当前选择、源图和记忆，不把已发布 keeper 删掉。

只在 account scoped `sessionStorage` 保存 `checked:factory-batch:${userId}` 的 batch UUID；不存源图/Base64/signed URL。preview remount 时 GET 恢复批次，缺少可恢复 ID 回上传页；载入失败支持 Try loading again。原站 camera 传入使用 `lib/disguise-draft.ts` 的 5 分钟内存 draft，跨域不会自动转移这块内存。

### 10.2 Gemini 文案

请求 endpoint：`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`，使用 `x-goog-api-key`，每次 25 秒超时，no-store。用户内容为方向 JSON 与原图 inlineData。

**逐字保留 `lib/factory/captions.ts` 中完整的 `systemInstruction`、revision 文案和 generationConfig**，不要按本节摘要重写 prompt。ZIP 提供原文件，这样不会遗漏禁用套话、五种不同笑点、图片具体反应、末尾 punchline、Latin 字符/无 emoji、内容边界等要求。

精确配置：`responseMimeType="application/json"`；JSON schema 只允许必需的 captions 字符串数组、min/maxItems=5、additionalProperties=false；`maxOutputTokens=2048`；`thinkingConfig.thinkingLevel="low"`。仅拼接非 thought parts，再 JSON.parse。

Prompt 要求通常 6–12 words、硬提示≤14 words/100 chars；实际 parser 检查恰好五个非空字符串、trim 后≤180 字符、大小写不敏感去重。不要误称 API 严格验证了单词数或 100 字符。真正能否放下由 renderer 决定。

第一次渲染触发 `CaptionLayoutError`，重新调用一次 Gemini，`shorter=true`，revision 要求 4–8 个英文词/普通标点；最多两次文案调用。第二次仍不适配就失败，不缩字、不裁图、不偷偷换字体。Factory 不调用 Doubao/Seedream 图像生成。

### 10.3 原样叠字参数

以当前 `lib/factory/render.ts` 为唯一准则；旧 README 写的 48px/6px/58px/三行已经落后于当前代码。

| 参数 | 当前值，基于原图短边 1000px |
| --- | --- |
| 字体 | 包内 Anton，使用 OpenType glyph path，不使用 SVG `<text>` 或系统字体 |
| `fontSize` | 96 |
| `lineHeight` | 116 |
| `strokeWidth` | 12 |
| `sideInset` | 48 |
| `bottomInset` | 40 |
| `maxLines` | 2 |
| 颜色与描边 | 白 fill、黑 stroke、round join、paint-order="stroke fill" |
| 输出 | WebP `lossless:true, effort:4`，每张≤10 MiB |

比例 `scale=min(width,height)/1000`；使用真实原图的 EXIF 显示方向，不 resize/crop/retouch/recolor。文案先合并空白、trim、`toLocaleUpperCase("en-US")`，按词宽换行；单个单词过宽、超过两行、字体不支持的字符全部拒绝。

最后 baseline 的逻辑坐标是 `logicalHeight - 40 - abs(font.descender/font.unitsPerEm*96) - 12/2`，上一行上移 116，最后再乘 scale；每行按 glyph 实际 bounding box 居中。保留源码的 path 坐标三位小数序列化，避免 OpenType 自带小数处理出现 NaN 导致字形缺失。

原图解码一次成为带 alpha 的 raw pixels，逐张仅 composite 文字 overlay。文字区域以外的解码像素必须完全相同，输出原生显示宽高不变。保留同一 sharp/libvips 依赖与字体文件；跨平台验证使用附带像素测试，不仅对比截图。

### 10.4 Batch 数据及并发状态

`factory_batches`：`id uuid PK`、`user_id → auth.users ON DELETE CASCADE`、`state`、`variants jsonb default []`、`selected` nullable 0–4、`lease_until`、`cleaned_at`、`created_at default now()`、`expires_at default now()+24 hours`。开启 RLS，撤销 anon/authenticated 全部权限，只授予 service_role；expiry 索引及每用户 `state='generating'` partial unique index 必须存在。

状态流程：`generating → ready → publishing → published`；失败/取消/过期可进入 discarded。开始时将该用户超过 10 分钟的 generating 作废，再插入客户端生成的 batch UUID。同用户同 UUID 重试尝试返回旧 preview；另一个活跃生成返回 409。

一次 batch 生成五张，私有路径 `${user}/factory/${batch}/${0..4}.webp`。五个 upload 使用 `Promise.allSettled`；任何一个失败必须等兄弟任务完成后再全清理，避免清理后迟到上传产生残留。generation 总 signal 为 155 秒，浏览器 request 为 190 秒，route maxDuration=180 秒。

Preview signed URL 有效 3600 秒，批次缓存 24 小时；两者不是同一过期时间。过期/丢弃返回 410，generating 返回 409，跨账号查不到返回 404。发布后只为选中 keeper 签 URL，其他四张返回空 URL。

发布用条件 update 认领状态与 120 秒 lease，锁定 selected。冲突选择/未到期 lease 返回 409；恢复过期 lease 仍必须使用同一 selected。创建 `images` 时 **image ID=batch ID**，source=generated、private path=已选路径、title=caption.slice(0,100)、description=caption。已有同 ID 行必须验证 owner/path 对应。

发布成功写 state=published、清 lease，删除另外四张，再写 cleaned_at。只有 published 且 cleaned_at 已确认，GET preview 才返回 photoId；cleanup 失败不能提前宣称流程完全完成。重复发布同选项只补清理、返回同一 photoId，不重复生成图片/记录；选不同选项拒绝。

### 10.5 Factory API

| 路径 | 行为 |
| --- | --- |
| `POST /api/factory` | 同源且完成 profile；bounded JSON≤3000000 bytes；`{id:UUID,image:dataURL,direction:string,approved:true}` → `FactoryPreview`；maxDuration 180 |
| `GET /api/factory/:id` | 完成 profile，按 user_id 读取 → `{id,variants:[{caption,url}],expiresAt,selected,photoId?}`；maxDuration 60 |
| `POST /api/factory/:id` | 同源、完成 profile；`{selected:0..4,approved:true}` → `{photoId}`，刷新 gallery/my-works 并 after 清理 |
| `DELETE /api/factory/:id` | 同源、完成 profile；discard 并删除未用预览 → `{ok:true}`；publishing 时拒绝；published 只清非 keeper |

所有成功状态为 200；主要 JSON 响应 no-store；当前 DELETE 成功响应及少数前置校验错误没有显式 no-store，不要让 CDN 据此缓存用户响应。Factory API 不调用 `requireAdmin`，权限来自 `getViewer` 和 `galleryWriter`。错误 JSON `{error}`，400 输入、401 登录、403 Origin、404 batch、409 状态冲突、410 过期、502 模型/排版、503 存储/配置、504 超时。

## 11 清理任务与跨项目缓存

当前 `vercel.json` 每天 `0 3 * * *`（UTC 03:00）调用 `/api/cron/ego`。认证 `Authorization: Bearer ${CRON_SECRET}`；它先执行 `ego_maintenance`，按每批 100 个清 `challenge-entries` 和 `ego_media_gc`，最后执行 factory 清理。Battle 维护失败会提前返回，factory 当次也不会执行。

Factory 每次选 `expires_at < now()` 的前 50 条。跳过仍有效的 publishing lease，通过条件 update 锁批次，再查同 ID 的 images。已发布的保留 selected 私有原图，即使上次最终确认中断；未发布草稿删除；清缓存后删 batch 行。失败返回可重试错误，后续任务再处理。**每日一次且最多 50 条表示 24 小时是失效时间，不保证文件在第 24 小时准点清除**；监测积压，必要时增加维护频次，属于运维配置调整。

迁移时选择一个部署负责共享维护：

- 为保持现状，可继续让原 app 承担 `/api/cron/ego`，新后台不再配置重复定时任务；确认原站真实部署已设置 CRON_SECRET。
- 若接管完整 cron，保留所有 battle 维护依赖与凭证，并移除旧部署的重复 cron。
- 若只拆出 factory 独立 cron，需要新建同样 Bearer 保护的专用端点，只调 `cleanupFactoryBatches`，旧站仍保留 battle 维护。它是部署结构调整，需要独立测试。

`refreshAdminMedia` 目前在**调用它的 Next 部署内** revalidate `/admin`、`/admin/media`、`/gallery`、`/my-works`、`/leaderboard`、`/` 和 `/my-works/:id`。同一个数据库不会把这些 invalidation 传到另一项目。

接收项目必须选定跨项目刷新方案：原用户站关键读取禁缓存/短 TTL，或新后台调用原站**专门鉴权的 server-to-server revalidation endpoint**，验证后在原部署 revalidate 同样路径。后者当前仓库没有实现，需要作为迁移集成任务开发，不能直接开放匿名刷新 API。原站已有部分 focus/定时刷新并不等于所有 server cache 已失效。

Factory 成功写的 sessionStorage `checked:gallery-votes-changed` 也只在同一 origin 生效。新后台跳回原站 gallery 时，需要原站实际读取到新 publication；验收必须覆盖跨部署可见性。

## 12 界面与资源复刻

原样保留 CSS Modules，并把 `globals.css` 的 reset、主题变量、font 设置和 shell 相关规则合并进目标样式。关键主题：background `#0c0d0e`、foreground `#f4f2e9`、surface `#141816`、surface-raised `#1c221b`、accent `#e8f044`、muted `#b2b7a7`、line `#394035`、danger `#ffb4a5`。根布局 `next/font/local` 暴露 `--font-inter` 与 `--font-anton`。

Admin 容器 max-width 1600、桌面 padding 32；700px 以下 padding 22px 16px、创建表单单列，表格横向滚动，不能压坏 UUID 与输入框。

Factory 不是仅复制 `studio.module.css` 就能一致。必须保留全局 `.site-content:has(> main[data-factory-screen])` 的 `height:100dvh`、flex、`min-height:0`，隐藏 app topbar/footer，以及其直属 main 的 flex 规则；否则会产生双重导航、滚动或预览被挤出屏幕。保留 850/600px、650px 高度、窄且矮屏幕及 reduced-motion 的所有规则，包含文件末尾覆盖项。

服务端渲染 Anton 字体和 UI 使用的 local font 是两条依赖，都不能遗漏。Admin preview 必须保持认证原生 img；Factory 本身使用缓存预览原生 img。原外壳需要的 `public/brand` 图片在交接包内；不需要为 admin 重生成图片资产。

## 13 验证与验收

### 13.1 本地自动检查

把测试脚本、loader 与历史 migrations 一起合并，保留 package.json 对应 npm scripts。对齐目标配置后运行：

```bash
npm run test:admin
npm run test:factory
npm run test:images-reference
npm run test:images-media
npm run lint
npm run build
```

源工作区此次已运行 `test:admin`（6 DB + 14 API + 6 UI）与 `test:factory`（10 UI + 15 server/render + 1 DB），共 **52 项全部通过**。交接 ZIP 也已解压至独立临时目录，复用当前安装的 node_modules，再次通过同样 52 项检查，确认相关源码与历史 SQL 已包含。每个归档文件的 SHA-256 已与 manifest 核对。

这些测试使用隔离 PGlite 和 mock provider，不访问真实用户或产生 AI 费用。此次未运行目标项目 lint/build、OAuth、真实 provider 或线上数据库检查；它们是接收项目部署验收内容。不能把源码测试通过当成线上凭证已配置。

### 13.2 接收项目必须逐项通过

- [ ] 新域名 Google 登录返回正确 admin 路径，同一用户 UUID/profile/admin flag，无需重复注册；普通登录 fallback 和 onboarding 目标可达。
- [ ] 匿名/普通用户/无 profile/非 Google/邮箱未确认均不能读 admin 页面、列表 API、preview；权限查询失败拒绝访问。
- [ ] admin 被可信维护端撤权后，下次请求拒绝；正在生成的结果不能在撤权后保存。
- [ ] 缺 Origin、异域 Origin 的所有变更请求失败；浏览器不包含 server secret/Ark/Gemini/management token。
- [ ] Users 包含待建 profile 账号；筛选、总数、前后页、纽约时间一致；users/votes 无编辑入口。
- [ ] Media 所有筛选与 Gallery/Battle votes 的 target/value 含义正确，实际 totals 保持字符串精度。
- [ ] 成品图上传≤2 MiB、静态/格式/像素边界校验正确；选择其他完成 profile 的 owner 生效；新图只在私有 bucket/images 中。
- [ ] 一次真实 Seedream prompt 可生成私有 WebP；模型/size/watermark 正确；权限、额度、超时错误可理解。此项需要授权环境的有效 provider 凭证。
- [ ] 修改 title/description 不修改 owner/path/source/image bytes；普通字段额外注入无效。
- [ ] Publish 重试只有一行和一个获胜 public object；原用户站 Gallery、Checkboard、Leaderboard 在选定刷新机制下可见。
- [ ] Delete 取消无写入，确认后删除图片与 gallery votes；有销售引用返回 409 且对象保留；Storage 失败可按日志重试。
- [ ] Factory 两页导航不丢内存状态；文件选择/拖放不调用模型；Create meme 才调用，方向可空且五张对应同一原图。
- [ ] 切换五文案零新增模型调用；字体是当前 96/12/116/两行参数；固定输入像素测试通过，横竖图/EXIF 正确，发布 byte-for-byte 保留输出。
- [ ] remount 恢复 batch、不重复收费；取消忽略迟到响应；不同账户不能读取/发布/丢弃对方 batch。
- [ ] 并发不同选择只能有一个 keeper；上传失败等其他 upload settle 再清理；清理失败重试仍用同一个 image ID。
- [ ] 发布后仅保留选中的私有原图；过期任务保留所有已发布 keeper，清未发布草稿/批次；cron 未授权 401。
- [ ] 目标函数 bundle 含 Anton；桌面、手机、矮屏、键盘导航、弹窗、reduced motion 和错误状态与当前界面一致。
- [ ] 源站与新站无重复 cron，跨部署缓存与跳转 URL 均实际验证。

真实 smoke test 使用测试 owner/测试图片；不要随意删除共享数据库里的真实媒体。离线回归已经能验证的失败场景无需重复付费生成。

## 14 切换与从原应用移除后台

本次交付没有执行删除。接收项目完成验收后，再进行以下代码切换：

1. 发布新后台并验证，保留旧后台作为短期回退入口；使用同一数据库不需要做全量数据拷贝或切换 schema。
2. 原 app 移除 `app/admin/**`、`app/api/admin/**` 及纯 admin 的入口/调用；account menu 改为新后台 URL 或移除 Admin 入口；移除原 proxy 的 admin 匹配/header 和仅后台使用的 return-path 分支时同步处理相关测试。
3. 原 app 若不再有 `lib/admin` 的引用才删除它；检查 `rg -n 'is_superadmin|/admin|lib/admin|adminReturnPath|x-checked-admin-return' app lib proxy.ts scripts`，逐个判断共享依赖。
4. **保留数据库的 `profiles.is_superadmin`、三个 admin RPC、factory 表、images/votes/sales、Storage buckets 和现有文件**，新后台仍在使用。
5. 原用户站还提供 `/disguise` 时，保留其 factory/API/render/fonts/Gemini 配置；仅 admin 迁移不应导致用户 factory 消失。若也迁走 factory，更新原站所有 Factory/camera 跳转，移除旧路由之前验证跨域 draft 的替代流程。
6. `lib/auth/profile.ts`、`lib/supabase.ts`、`lib/gallery-media.ts`、`lib/seedream-generation.ts`、`lib/roast/read-body.ts`、字体与 globals 都可能被其他页面使用，不能按“admin 依赖”整组删除。
7. 记录 cron 归属与跨项目 revalidation 上线时间；移除旧重复任务，复跑原用户站相关回归，再下线旧后台。

回退：重新启用上一版 admin 路由/入口或切回上一部署即可，保留共享数据库。切换期间新后台产生的合法记录继续保留；不可为了回退把数据库恢复到旧快照覆盖新数据。已确认的永久删除无法由部署回退恢复。

## 15 常见问题定位

| 现象 | 优先检查 |
| --- | --- |
| 登录成功但 admin 404/403 | 同一 Supabase 项目、Google identity、confirmed email、profile.is_superadmin；不能只检查邮箱 |
| 登录后去了 Gallery 或空白主页 | `ego_return`、`adminReturnPath`、proxy header、callback/profile 完成分支；目标项目默认入口是否存在 |
| 所有变更 403 | Origin 是否存在且严格匹配 request.url origin；是否从原站跨域调用新 API；反向代理 origin |
| users/media/votes 返回 503 | service secret、RPC 精确签名和授权、admin schema 是否部分安装、依赖表是否存在 |
| owner 创建失败 | profile 是否完成 onboarding；UUID 是否为该 Auth 项目的用户 |
| Admin 上传却显示 generated | 当前设计如此，私有成品上传走 generated 分支；不要改 source 规避 |
| Admin 图和 Factory 图清晰度不同 | Admin 做 2048/quality85 标准化；Factory 保原图分辨率且 lossless；不要合并这两条处理路径 |
| Factory 生成不可用 | GEMINI_API_KEY/GEMINI_MODEL，而不是 ARK_API_KEY 或 ROAST_PROVIDER |
| 部署后字体缺失/仅部分文字显示 | tracing 字体路径、包内 Anton、原样 outlineData 序列化；不要用 SVG text 替换 |
| Caption 不适配/非拉丁文持续失败 | 固定两行与 Anton 字符支持；允许一次 shorter 重试，不能自动缩小字号 |
| 发布成功但仍报 cleanup pending | 重试同一 selected 以完成 cleaned_at，不应生成另一张或删除 keeper |
| 新后台发布、旧站看不到 | 共享 DB 不共享 Next cache/sessionStorage；落实第 11 节跨项目刷新 |
| 预览一小时后失效 | signed URL 的 3600 秒 TTL；重新 GET batch 签名，batch 的 24h TTL 另算 |
| 过期文件未立刻消失 | cron Bearer/部署配置、battle 维护前置失败、50 条批处理积压；不是改 bucket 为 public |
| 删除后 Storage 残留 | 按 admin cleanup 日志的 bucket/path 在可信维护端重试；factory cron 不清普通 admin 残留 |

## 16 可直接交给接收项目开发者的任务

> 阅读本迁移文档和 `admin-migration-source.zip`，以 manifest 校验的当前工作区源码为基线，在目标项目合并完整 admin 与 Checked Factory。连接相同 Supabase PostgreSQL/Auth/Storage，保留 Google identity + confirmed email + profiles.is_superadmin 的逐请求权限校验、同源变更保护、私有预览和服务端凭证边界。完整实现 users/media/votes 页面及所有 admin API；同时保留 admin Seedream 和用户五文案 Gemini factory 两条工作流、原 Anton 字体及 96px 固定排版、发布原字节、批次并发与清理重试。不得重放全部历史 SQL、复制真实用户数据、清空 buckets 或把后台成品上传改为 source=upload。先完成配置/源码/测试，再验证新域名 OAuth、真实生成、共享数据库可见性、跨项目缓存与单一 cron 归属。逐项完成第 13 节验收后，单独执行原应用 admin 下线；不要提前删除共享模块或数据库结构。
