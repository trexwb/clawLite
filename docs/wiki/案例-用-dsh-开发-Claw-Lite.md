# 案例：用 dsh 开发 Claw Lite

> **一句话**：把 dsh（DeepSeek Harness）的 web 会话当作开发入口，从零写出了一个「能托管 dsh 的 Electron 桌面宿主」——Claw Lite 既是被 dsh 开发出来的项目，又是让 dsh 免装 Node 就能跑起来的载体。

---

## 一、为什么会有这个项目

`@deepseek-ai/dsh` 的官方形态是一个 npm 包：常规用法是先装 Node 环境，再装包、跑 `dsh web`。对不写代码的用户来说，**Node 环境本身就是第一道门槛**。

Claw Lite 的做法是把门槛搬进安装包：不打包额外的 node 二进制，直接用 Electron 自带的 Node（v24）作为解释器；把官方 dsh 依赖树预置进安装包；把原生模块放在 asar 之外保证可用。

于是形成了一个闭环：**开发过程用 dsh 完成，开发出来的应用又用来托管 dsh**。这个案例的两端，就是下面两张截图。

---

## 二、开发侧：dsh 会话就是开发入口

![dsh web 新会话界面（预览版）](images/1.png)

上图是 dsh web 的新会话界面（预览版）：中央是「描述你想要构建的内容…」输入框，右下角可选择模型（截图中为 DeepSeek-V41-Flash High）。Claw Lite 的源码与构建脚本，都是在这类会话里一轮轮生成、修改、验证出来的。

实践中的三点做法：

**1）需求 + 约束 + 验收标准一起交给会话。** 只描述「做什么」会让产出风格漂移。每次会话都同时给出：改哪个模块、必须遵守哪些硬约束（如 IPC 三层对齐、CSP 不得放宽）、验收口径（`npm run check` 必须全绿）。

**2）把规范固化成仓库文件，而不是每次口头重复。** 仓库根目录的 `AGENTS.md` 承载全部强制规范——架构分层与进程模型、IPC 契约三层对齐、CSP 与安全基线、源码后缀统一、状态机枚举可达、版本号纪律、自检清单。它对人、对 dsh 会话、对项目上运行的所有 Agent 服务都是同一份规范基线。

**3）每一轮产出都必须过门禁。** 会话交付的代码不允许「看起来对」，必须跑静态自检与构建验证、通过启动冒烟，才算完成。

---

## 三、产物侧：Claw Lite 主控制面板

![Claw Lite 主控制面板](images/0.png)

上图是 Claw Lite 的主控制面板：状态胶囊显示「已就绪 · 未启动」，下方是启动 / 停止 / 重启三个动作按钮，再往下是访问地址输入框与「复制」「打开界面」按钮。它对应的正是 dsh 托管链路：

```
点击「启动」
  → 主进程 HarnessManager.start()
  → 以 Electron 可执行文件作纯 Node 解释器 spawn dsh web
  → HTTP 探活轮询，直至就绪
  → 从子进程 stdout 捕获 dsh web: http://127.0.0.1:<port>/?token=xxx
  → 带 token 的完整 URL 回填「访问地址」输入框
  → 「打开界面」在应用内窗口（persist:dsh-web 分区，登录态留存）或系统浏览器打开
```

| 界面元素 | 源码位置 |
|---|---|
| 状态胶囊「已就绪 · 未启动」 | `HarnessManager` 状态机 `notInstalled` / `stopped` / `starting` / `stopping` / `running` / `error`，经 `harness:state` 广播到渲染层 |
| 启动 / 停止 / 重启 | `harness:start` / `harness:stop` / `harness:restart` |
| 访问地址 + 复制 | `HarnessManager._captureUrl()` 捕获带 token 的 URL；复制走 `navigator.clipboard` |
| 打开界面 | `harness:open`，`openMode` 决定应用内窗口还是系统浏览器 |

---

## 四、一轮会话的完整路径

| 阶段 | 动作 | 落地产物 |
|---|---|---|
| 1. 提需求 | 在 dsh 会话中说明目标、约束与验收口径 | 会话上下文（约束以 `AGENTS.md` 为准） |
| 2. 出代码 | dsh 生成 / 修改源码 | `electron/*.ts`、`src/*.ts`、`scripts/*.ts` |
| 3. 过门禁 | 静态自检 + 构建 + 产物校验 | 自检全绿，`dist/`、`dist-electron/` 产物 |
| 4. 记日志 | 按版本纪律追加发布日志 | `docs/version/RELEASE-v{主版本}.md` |
| 5. 打包分发 | 本地打包或推送 `v*` tag 触发 CI | `release/` 下安装包 / GitHub Release |
| 6. 自举验证 | 用打出来的 Claw Lite 启动 dsh，进入下一轮开发 | 见上图主控制面板 |

第 6 步是这个案例最特别的地方：**开发工具和开发产物互为验证**。

---

## 五、踩过的坑（已固化为禁止移除的约束）

| # | 现象 | 结论 |
|---|---|---|
| 1 | dsh web 启动后立即退出 | dsh 的 `cordis-plugin-hmr` 依赖 Node 内部能力，spawn 必须带 `--expose-internals`；同时用 `ELECTRON_RUN_AS_NODE=1` 把 Electron 当纯 Node，`--no-open` 阻止其自行拉浏览器 |
| 2 | 打开 Web UI 被拒 | 就绪输出 `dsh web: http://127.0.0.1:<port>/?token=xxx` 中的 `token` 是信任凭据，必须整条 URL 原样捕获，不能自行拼接 |
| 3 | preload 加载失败 | `sandbox: true` 下 ESM preload 必须 `.mjs` 且要求关沙箱，走不通；产物形态被运行时反向约束为 CJS |
| 4 | 换新 dsh 版本后启动异常 | dsh v0.1.7 系列依赖更新的 Node / Electron，与当前锁定版本冲突，内置运行时维持 `0.1.5-rc.3` |
| 5 | 原生模块加载失败 | 约 300MB 依赖树不能塞进 asar，须 `extraResources` 解包为真实文件；代价是安装包体积增大 |
| 6 | 后台更新阶段应用崩溃 | `autoUpdater` 等 EventEmitter 型模块必须挂 `error` 监听，异步 error 用 `try/catch` 覆盖不到 |

---

## 六、让产出可控的三层门禁

1. **静态自检**：IPC 契约三层对齐、状态枚举双向可达、日志着色类名与 CSS 交叉、端口范围三方一致、安全与无障碍基线、源码后缀门禁与类型检查、产物模块形态。
2. **产物校验**：断言 `dist/index.html` 资源引用为相对路径、品牌图标真实产出并被引用——静态自检看不到构建产物。
3. **CI 流水线**：macOS / Windows runner 上完整跑一遍构建链路后才创建 Release。**能过 CI 的产出才算完成。**

细节见 [[自检与发布流程]]。

---

## 七、版本纪律

- 版本号单一来源：`package.json` 的 `version`。
- **正式发布后按语义化版本（SemVer）正常迭代**：破坏性变更推主版本、向后兼容新功能推次版本、向后兼容修复与文档 / 样式等非功能性改动推修订号（v1.0.1 即首个发布后修订号）。
- 发布前的 v1.0.0 基线阶段口径更严：末位 +1 仅限「不同类、不同根因的新功能 / 新修复」且用户明确允许；同一问题多轮往返、同日同模块追加修复、**仅文档更新**、纯 CSS / 文案打磨一律不推进版本号。
- 每次迭代都要写日志：追加到 `docs/version/RELEASE-v{主版本}.md`，历史日志只增不改。
- 内置 DSH 运行时版本是独立维度，由 `scripts/fetch-runtime.ts` 的 `DSH_VERSION` 决定；内置 DSH 依赖树自身的 `package.json` 的 `version` 也不属于应用版本，不随应用版本改动。

---

## 八、继续阅读

- [[快速开始]] — 装起来、跑起来
- [[架构总览]] — 进程模型与 IPC 契约
- [[DSH-版本管理与热切换]] — 版本下载与切换
- [[自检与发布流程]] — 门禁与 CI
