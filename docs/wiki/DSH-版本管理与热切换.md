---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 16825e3339a4e87ec3619b4c10842061_774eb487b88f11f189c8525400393706
    ReservedCode1: Z+Cgwd5+EiyOmMTsHM93czMo5NGxWBVisCj+D6IsZpb50mjZA1eRXV2yA4vQn/KK2QVWiJPJkU2j+S92RUMZ/F+igVxmmhkdp76N6ACfIoHh0Nom5+U7lxYq9wuQl/RMYVda3yfYbIQodp77yIL244SX1CzSTjJUp5bK48n6g5+odNXz3kVSZ9NvDRQ=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 16825e3339a4e87ec3619b4c10842061_774eb487b88f11f189c8525400393706
    ReservedCode2: Z+Cgwd5+EiyOmMTsHM93czMo5NGxWBVisCj+D6IsZpb50mjZA1eRXV2yA4vQn/KK2QVWiJPJkU2j+S92RUMZ/F+igVxmmhkdp76N6ACfIoHh0Nom5+U7lxYq9wuQl/RMYVda3yfYbIQodp77yIL244SX1CzSTjJUp5bK48n6g5+odNXz3kVSZ9NvDRQ=
---

# DSH 版本管理与热切换

## 一、两种版本来源

Claw Lite 的 dsh 运行时有两个来源，互不冲突：

| 来源 | 位置 | 说明 |
|---|---|---|
| **内置运行时** | `resources/dsh/app/node_modules` + `runtime.json` | 随安装包分发，终端用户开箱即用；版本由 `scripts/fetch-runtime.ts` 的 `DSH_VERSION` 决定 |
| **按需下载版本** | `userData/dsh-versions/<版本>/app/node_modules` | 设置页选定版本后从 npm 下载落地，与内置运行时目录布局一致 |

`runtime.json` 记录实际落地信息，例如：

```json
{
  "platform": "darwin-arm64",
  "dshVersion": "0.1.5-rc.3",
  "entry": "node_modules/@deepseek-ai/dsh/lib/bin.js",
  "nodeRuntime": "electron"
}
```

## 二、使用方式

在设置页「DSH 版本」处：

1. 输入版本号（可填 `latest` 或具体版本，如 `0.1.7-rc.2`），或点「刷新列表」从 npm 拉取全量版本后在下拉面板中选择；
2. **选定即开始下载** —— 不需要先保存、不需要等下次打开应用；
3. 下载区显示进度（标题「正在下载 DSH 运行时…」、进度条、可「取消下载」）；
4. 下载完成后就地出现「切换并启动」，**无需重启应用**即可用新版本启动 dsh。

## 三、下载阶段

主进程上报的任务阶段（`DOWNLOAD_PHASES`，单一来源）：

| 阶段 | 含义 |
|---|---|
| `idle` | 无进行中的任务 |
| `resolving` | 解析依赖树（确定待落地包总量） |
| `downloading` | 拉取 tarball |
| `installing` | 解包落盘 |
| `verifying` | 校验落地结果 |
| `done` | 完成，可切换启动 |
| `error` | 失败（含失败原因） |

> 进度计算同时参考「tarball 拉取计数」与「目标目录已落地包目录数」并取较大值——热缓存场景下拉取会瞬间完成，真正耗时在解包落盘，只看拉取计数会让进度条卡住不动。

## 四、实现要点

- **不阻塞主进程**：旧实现用同步阻塞方式安装，主进程无法响应 IPC；现改为 `spawn` + 流式消费 npm 输出，全程可上报进度、可取消。
- **目录布局不变**：`userData/dsh-versions/<版本>/app/node_modules`，托管层推导 dsh 入口的路径规则与内置运行时一致。
- **阶段枚举双向校验**：渲染层阶段文案键必须与主进程 `DOWNLOAD_PHASES` 严格一致，`scripts/check.ts` 双向断言，杜绝「主进程置入的状态没有文案」这类死枚举。
- **应用版本与运行时版本独立**：切换 dsh 版本不改变 Claw Lite 自身版本号（见 `AGENTS.md` §0）。

## 五、兼容性提醒

dsh v0.1.7 系列依赖更新版本的 Node / Electron，与项目当前锁定的 Electron 版本存在兼容冲突。**内置运行时维持 `0.1.5-rc.3`**；待 Electron 升级迭代并确认支持后再切换。

通过安装包分发的终端用户无需任何操作；开发者本地刷新运行时（`npm run runtime:force`）时请勿手动指定 v0.1.7 系列版本。

## 六、相关页面

- [[快速开始]]
- [[架构总览]]
- [[常见问题]]
