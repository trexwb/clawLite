'use strict'
/* ═══════════════════════════════════════════════════════════════════
   Claw Lite — DSH 运行时托管（Electron 主进程侧）
   ───────────────────────────────────────────────────────────────────
   设计要点：
     • 用 Electron 自带的 Node 运行时执行 dsh，不依赖系统 Node，
       也不外挂 node 二进制 —— spawn 时置 ELECTRON_RUN_AS_NODE=1，
       以 process.execPath 作为解释器（打包后即应用自身可执行文件）。
     • 必须传 --expose-internals：dsh 的 cordis-plugin-hmr 依赖 Node
       内部 binding，缺失会导致 web profile 加载失败并退出。
      • dsh 依赖树位于 resources/dsh/app/node_modules，随安装包分发。
     • 端口：优先用户配置端口（PORT_MIN–PORT_MAX），被占用或越界则由 OS 分配空闲端口。
     • 就绪判定：HTTP 探活轮询（dsh web 启动后监听 /）。
   ═══════════════════════════════════════════════════════════════════ */

const { spawn } = require('node:child_process')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const http = require('node:http')
const os = require('node:os')

const LOG_LIMIT = 800
const READY_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 6_000
// 端口策略单一来源：渲染层输入框 min/max、主进程 IPC 校验、此处分配三处共用，
// 与 index.html `#f-port`、src/main.js 的 PORT_* 保持一致（scripts/check.mjs §9 校验）
const PORT_MIN = 1024
const PORT_MAX = 65535
const PORT_DEFAULT = 8799

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 探测 URL 是否可服务（2xx~4xx 均视为服务已起） */
function probe(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 500)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
  })
}

/** 取一个可用端口：优先 preferred，被占用则让 OS 分配 */
function pickPort(preferred) {
  return new Promise((resolve) => {
    const attempt = (port, fallback) => {
      const srv = net.createServer()
      srv.once('error', () => {
        if (fallback) attempt(0, false)
        else resolve(0)
      })
      srv.once('listening', () => {
        const got = srv.address().port
        srv.close(() => resolve(got))
      })
      srv.listen(port, '127.0.0.1')
    }
    // 端口范围钳制：越界值（负数 / >65535 / NaN）会让 srv.listen 抛 RangeError，
    // 而该异常位于 start() 的 await 链路中且无捕获点，会击穿调用点，
    // 使界面永久停留在「正在启动…」且所有按钮被禁用。
    const p = Math.trunc(Number(preferred))
    attempt(Number.isFinite(p) && p >= PORT_MIN && p <= PORT_MAX ? p : 0, true)
  })
}

class HarnessManager extends EventEmitter {
  /**
   * @param {object} opts
   * @param {string} opts.appRoot       开发态项目根（打包态忽略）
   * @param {boolean} opts.isPackaged
   * @param {string} opts.resourcesPath 打包态资源目录（process.resourcesPath）
   * @param {string} opts.userDataDir   应用数据目录
   */
  constructor(opts) {
    super()
    this.appRoot = opts.appRoot
    this.isPackaged = opts.isPackaged
    this.resourcesPath = opts.resourcesPath
    this.userDataDir = opts.userDataDir

    this.child = null
    this.state = 'stopped' // notInstalled | stopped | starting | running | error
    this.message = '已就绪 · 未启动'
    this.url = ''
    this.port = 0
    this.starting = false
    this.logs = []
    // 默认端口与 PORT_DEFAULT 同源：原先此处另写 8799，改端口策略时极易漏改
    this.settings = {
      port: PORT_DEFAULT,
      autoStart: false,
      openMode: 'window',
      workspace: '',
      dshHome: '',
    }
    this._stopping = false
  }

  /* ── 路径解析 ────────────────────────────────────────────────── */

  get dshRoot() {
    return this.isPackaged
      ? path.join(this.resourcesPath, 'dsh')
      : path.join(this.appRoot, 'resources', 'dsh')
  }

  get dshEntry() {
    return path.join(this.dshRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  }

  get dshHome() {
    const custom = (this.settings.dshHome || '').trim()
    return custom || path.join(this.userDataDir, 'dsh-home')
  }

  /** dsh 依赖树版本（读 package.json，不启动进程） */
  get dshVersion() {
    try {
      const p = path.join(this.dshRoot, 'app', 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
      return JSON.parse(fs.readFileSync(p, 'utf8')).version || ''
    } catch {
      return ''
    }
  }

  /** 校验内置运行时是否完整 */
  checkRuntime() {
    if (!fs.existsSync(this.dshEntry)) {
      return { ok: false, reason: `未找到内置 DSH 运行时：${this.dshEntry}` }
    }
    if (!this.dshVersion) {
      return { ok: false, reason: '内置 DSH 运行时元数据缺失（package.json 不可读）' }
    }
    return { ok: true }
  }

  /* ── 状态与日志 ──────────────────────────────────────────────── */

  setState(state, message) {
    this.state = state
    if (message !== undefined) this.message = message
    this.emit('state', this.snapshot())
  }

  log(line) {
    const text = String(line).replace(/\r$/, '')
    if (!text.trim()) return
    this.logs.push(text)
    if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT)
    this._captureUrl(text)
    this.emit('log', text)
  }

  /**
   * 从 dsh 输出中捕获带 token 的访问地址。
   * dsh web 就绪时会打印：`dsh web: http://127.0.0.1:8799/?token=xxx`
   * token 是 Web UI 的浏览器信任凭据，缺失会导致打开界面被拒，必须原样带上。
   */
  _captureUrl(text) {
    const tagged = text.match(/dsh\s*web:\s*(https?:\/\/\S+)/i)
    const generic = text.match(/https?:\/\/127\.0\.0\.1:\d+\/\S*token=\S*/)
    const found = (tagged ? tagged[1] : generic ? generic[0] : '').replace(/[),.;'"]+$/, '')
    if (!found || found === this.url) return
    this.url = found
    this.emit('state', this.snapshot())
  }

  clearLogs() {
    this.logs = []
    this.emit('log', '')
  }

  snapshot() {
    const installed = this.checkRuntime().ok
    return {
      installed,
      running: this.state === 'running',
      starting: this.starting,
      // 渲染层据此决定「停止」能否点：启动探活阶段（最长 60s）子进程已存在，
      // 有信号可发，应允许用户中止本次启动而不是干等超时
      canStop: !!this.child,
      state: this.state,
      message: this.message,
      url: this.url,
      dshVersion: this.dshVersion,
      nodeVersion: process.versions.node,
      runtimeKind: 'Electron 内置 Node',
      nodeBin: process.execPath,
      dshDir: this.dshRoot,
      dshHome: this.dshHome,
      workspace: this.settings.workspace || '',
      settings: { ...this.settings },
      logs: [...this.logs],
    }
  }

  /* ── 生命周期 ────────────────────────────────────────────────── */

  async start() {
    if (this.starting) return this.snapshot()
    if (this.state === 'running' && this.child) return this.snapshot()
    // 停止流程未收尾（stop() 已置 stopping / _stopping）时拒绝重入启动：
    // 否则两段流程会互相覆盖 child 句柄，新起的进程会被 stop() 的超时分支误杀
    if (this._stopping) return this.snapshot()

    const rt = this.checkRuntime()
    if (!rt.ok) {
      this.setState('notInstalled', rt.reason)
      this.log(`[claw-lite] ✗ ${rt.reason}`)
      return this.snapshot()
    }

    this.starting = true
    this._stopping = false
    this.setState('starting', '正在启动 DSH 服务…')
    this.log('[claw-lite] 正在启动 DSH 服务…')

    // 端口分配与数据目录准备是 spawn 之前仅有的两个可失败步骤，必须自带错误边界：
    // 否则任一步骤抛错（端口越界 / DSH_HOME 不可写）都会击穿 start() 调用点，
    // 令 starting 恒为 true、状态停在 starting，界面按钮全禁用且无自愈路径。
    let port
    let url
    let cwd
    try {
      port = await pickPort(this.settings.port)
      url = `http://127.0.0.1:${port}`
      this.port = port
      this.url = url

      fs.mkdirSync(this.dshHome, { recursive: true })
      cwd = this.settings.workspace && fs.existsSync(this.settings.workspace)
        ? this.settings.workspace
        : os.homedir()
    } catch (e) {
      this.starting = false
      this._stopping = false
      this.url = ''
      const msg = `启动准备失败：${e.message}`
      this.setState('error', msg)
      this.log(`[claw-lite] ✗ ${msg}`)
      return this.snapshot()
    }

    // 关键：ELECTRON_RUN_AS_NODE 让 Electron 可执行文件以纯 Node 模式运行脚本
    const env = {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: this.dshHome,
    }
    // 避免 Electron 相关变量污染子进程
    delete env.ELECTRON_NO_ATTACH_CONSOLE

    this.log(`[claw-lite] 解释器：${process.execPath}（Node ${process.versions.node}）`)
    this.log(`[claw-lite] 入口：${this.dshEntry}`)
    this.log(`[claw-lite] DSH_HOME：${this.dshHome}`)
    this.log(`[claw-lite] 工作目录：${cwd}`)
    this.log(`[claw-lite] 监听端口：${port}`)

    let child
    try {
      child = spawn(
        process.execPath,
        [
          // dsh 的 cordis-plugin-hmr 需要 Node 内部 binding；
          // 缺少该标志会导致 web profile 加载失败、进程随即退出。
          '--expose-internals',
          '--no-warnings',
          this.dshEntry,
          'web',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
          '--no-open',
        ],
        { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      )
    } catch (e) {
      this.starting = false
      this.setState('error', `进程创建失败：${e.message}`)
      this.log(`[claw-lite] ✗ 进程创建失败：${e.message}`)
      return this.snapshot()
    }

    this.child = child
    this.attachPipes(child)

    child.on('error', (e) => {
      this.log(`[claw-lite] ✗ 子进程错误：${e.message}`)
      this.starting = false
      this.setState('error', e.message)
    })

    child.on('exit', (code, signal) => {
      // 已被新进程接管（restart 等「停→启」竞态）时忽略旧进程的退出事件：
      // 否则会清掉新进程句柄，并把正在运行的服务误判为「意外退出」。
      if (this.child !== child) return
      const wasStopping = this._stopping
      this.child = null
      this.starting = false
      this.url = ''
      if (wasStopping) {
        this.setState('stopped', '已停止')
        this.log('[claw-lite] DSH 已停止')
      } else {
        this.setState('error', `DSH 进程意外退出（code=${code} signal=${signal}）`)
        this.log(`[claw-lite] ✗ DSH 进程意外退出（code=${code} signal=${signal}）`)
      }
    })

    const ready = await this.waitForReady(url, child)
    this.starting = false

    if (ready) {
      this.setState('running', '运行中')
      this.log(`[claw-lite] ✓ DSH 已就绪：${url}`)
    } else if (this.child) {
      // 进程还在但未探活成功 —— 不武断判死，保留 running 提示
      this.setState('running', `服务已启动（探活超时，可尝试打开界面）`)
      this.log(`[claw-lite] ⚠ 探活超时，进程仍在运行，请尝试打开界面确认`)
    }
    return this.snapshot()
  }

  /** 消费子进程 stdout/stderr */
  attachPipes(child) {
    const pipe = (stream) => {
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk) => {
        buf += chunk
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const l of lines) this.log(l)
      })
      stream.on('end', () => { if (buf.trim()) this.log(buf) })
    }
    if (child.stdout) pipe(child.stdout)
    if (child.stderr) pipe(child.stderr)
  }

  /** 等待 HTTP 服务就绪 */
  async waitForReady(url, child) {
    const deadline = Date.now() + READY_TIMEOUT_MS
    while (Date.now() < deadline) {
      if (this.child !== child) return false // 进程已退出
      if (await probe(url)) {
        // 探活通过时，dsh 打印的带 token 地址可能尚未经管道送达。
        // 该 token 是 Web UI 的信任凭据，缺失会被拒，故短暂等待其到达。
        for (let i = 0; i < 15 && !/token=/.test(this.url); i++) await sleep(100)
        return true
      }
      await sleep(400)
    }
    return false
  }

  async stop() {
    if (!this.child) {
      this.url = ''
      this._stopping = false
      this.setState('stopped', '已停止')
      return this.snapshot()
    }
    this._stopping = true
    // 停止期必须落在 stopping 态：复用 starting 会让渲染层无法把停止窗口判为
    // 忙碌（busy 依赖 state === 'stopping'），「停止→启动」按钮解禁即生孤儿子进程
    this.setState('stopping', '正在停止…')
    this.log('[claw-lite] 正在停止 DSH…')

    const child = this.child
    const exited = new Promise((resolve) => child.once('exit', resolve))

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], { windowsHide: true })
      } else {
        child.kill('SIGTERM')
      }
    } catch (e) {
      this.log(`[claw-lite] 终止信号发送失败：${e.message}`)
    }

    const timedOut = await Promise.race([
      exited.then(() => false),
      sleep(STOP_GRACE_MS).then(() => true),
    ])

    // 只强杀本次调用捕获的进程：this.child 可能已被新进程接管，
    // 沿用 this.child 会在竞态下杀掉刚起来的服务
    if (timedOut && this.child === child) {
      this.log('[claw-lite] 优雅退出超时，强制结束进程')
      try { child.kill('SIGKILL') } catch {}
    }

    // 收尾前解除停止标记，允许后续 start() / restart() 正常重入
    this._stopping = false
    // 新进程已接管时（理论竞态路径）不得覆盖其状态与 URL
    if (this.child && this.child !== child) return this.snapshot()

    this.url = ''
    this.starting = false
    this.setState('stopped', '已停止')
    return this.snapshot()
  }

  async restart() {
    await this.stop()
    await sleep(300)
    return this.start()
  }
}

module.exports = { HarnessManager, PORT_MIN, PORT_MAX, PORT_DEFAULT }
