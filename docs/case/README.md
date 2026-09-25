# Claw Lite 文档 · 实践案例目录

> 本目录存放 Claw Lite 的**实践案例类文档**，与 [`docs/version/`](../version/README.md)（版本迭代日志）并列。
> 案例文档的定位是「可复现的经验记录」：讲清一件事是怎么做出来的、踩过哪些坑、用哪些门禁兜住质量，而不是复述 README 的功能清单。

## 目录内容

| 文件 | 说明 |
|---|---|
| [CASE-dsh-clawlite.md](CASE-dsh-clawlite.md) | 主案例：**用 DeepSeek Harness（dsh）开发 Claw Lite 项目**——开发侧会话入口、产物侧控制面板、开发闭环、踩坑记录与工程门禁 |

## 截图素材

本目录文档引用 [`docs/images/`](../images/) 下的两张实拍截图（相对路径 `../images/`）：

| 图片 | 内容 | 在案例中的用途 |
|---|---|---|
| `docs/images/0.png` | Claw Lite 主控制面板：状态「已就绪 · 未启动」，启动 / 停止 / 重启三键，访问地址输入框 + 复制 + 打开界面 | 说明**产物侧**：dsh 被宿主托管之后的运维界面 |
| `docs/images/1.png` | dsh web 新会话界面（预览版）：「描述你想要构建的内容…」输入框，模型选择 DeepSeek-V41-Flash High | 说明**开发侧**：需求与约束从这里进入 dsh 会话 |

> 图片引用一律使用仓库内相对路径（`../images/0.png`），不写绝对路径、不使用外链，保证 GitHub 网页渲染与本地 clone 表现一致。

## GitHub Wiki 文件集

[`docs/wiki/`](../wiki/) 是**可直接发布的 GitHub wiki markdown 文件集**：含首页 `Home.md`、侧边栏 `_Sidebar.md`、页脚 `_Footer.md` 与各内容页，图片随包放在 `docs/wiki/images/`。

发布方式（首次）：

```bash
git clone https://github.com/trexwb/clawLite.wiki.git
cp -R docs/wiki/. clawLite.wiki/
cd clawLite.wiki && git add -A && git commit -m "docs(wiki): 初始化 Claw Lite wiki" && git push
```

> wiki 与主仓库是两个独立 git 仓库：wiki 页面里的图片必须随 wiki 仓库一起提交（`images/0.png`、`images/1.png` 已随包提供），否则发布后图片会 404。wiki 页面之间用 `[[页面名]]` 互链，页面名与文件名（去掉 `.md`）严格一致。

