# 灵动岛新增功能设计

**日期**：2026-07-02
**范围**：为 NetSpeed-Dynamic 灵动岛新增 5 个功能：番茄钟、微信/QQ 消息提醒、天气、久坐/喝水提醒、快捷启动器。

## 1. 背景与目标

当前灵动岛已实现网速、音乐、系统通知、硬件监控四种模式及轮换。本次扩展在不引入新框架的前提下，复用现有 Rust(lib.rs) + Vue(WidgetIsland/MainPanel) 架构，新增以下能力：

1. **番茄钟**——经典四阶段循环，常驻角标倒计时，阶段结束全岛弹出提醒。
2. **微信/QQ 消息提醒**——QQ 抓 Toast 摘要；微信靠窗口标题检测未读数；"有新消息就提醒"。
3. **天气与温度**——常驻角标，点击展开预报。
4. **久坐/喝水提醒**——基于真实闲置检测的健康提醒。
5. **快捷启动器**——长按灵动岛唤起自定义应用列表。

## 2. 整体架构

5 个功能全部在现有架构上扩展，按实现层次分三类：

| 类型 | 功能 | 落点 |
|------|------|------|
| 纯前端计时 | 番茄钟、久坐/喝水提醒 | 前端状态机（抽 composable） + `setInterval` + `localStorage` |
| 后端能力 | 天气（reqwest）、微信窗口检测（winapi） | lib.rs 新增 commands |
| 复用现有 | 快捷启动器、QQ Toast | 复用 `open_app_by_aumid` / `ShellExecuteW`；QQ 复用现有通知抓取 |

### 关键架构决策

1. **统一角标插槽（badge slot）**：番茄钟、久坐、喝水都要在网速岛右上角挂迷你数字。统一做一个角标插槽，按优先级排队显示（番茄钟 > 久坐 > 喝水），各功能不各自绘制，避免重叠。
2. **微信复用通知动画路径**：微信未读数提醒走与系统 Toast 通知相同的 `isMsgActive` 扩展动画通道，并做优先级仲裁防跳动。
3. **配置归集**：所有新功能开关进 `MainPanel.vue` 现有"灵动岛设置"区，`localStorage` 键名统一 `nsd_` 前缀。

## 3. 番茄钟 + 久坐/喝水提醒（前端计时类）

三者同源，统一设计。

### 3.1 番茄钟状态机

独立抽出 `src/composables/usePomodoro.ts`，避免 WidgetIsland.vue 继续膨胀。

```
状态：Idle → Focus(25) → ShortBreak(5) → Focus → ... → 第4次 → LongBreak(15) → 循环
字段：phase、remaining(秒)、cycleCount、isRunning
```

- `remaining` 每秒 `setInterval` 递减；阶段切换时清零、播铃、触发全岛弹出提醒（复用消息扩展动画 `animateIslandSize` + 短暂高亮）。
- **持久化**：每 5 秒把 `{phase, remaining, deadline}` 写 `localStorage`，窗口重开/崩溃可恢复。用 `deadline` 时间戳校准，而非纯计数，避免休眠漂移。
- **角标**：`mm:ss` 迷你文本，颜色按阶段：专注红 `#ff6b6b` / 短休绿 / 长休蓝；暂停时角标变灰。

### 3.2 久坐/喝水提醒

独立抽出 `src/composables/useHealthReminders.ts`。

- **久坐**：默认 45 分钟无键鼠活动 → 提醒。无活动检测用 Rust 侧 `GetLastInputInfo` 判定真实闲置时间（比纯计时准——真起身了就不催）。
- **喝水**：固定 30 分钟一次，纯计时。
- 两者都走番茄钟同款"全岛弹出提醒"通道，互斥排队（同时触发时只显示优先级高的）。

### 3.3 数据流

`composable` 暴露 `remainingText`、`badgeColor` 给角标插槽；触发提醒时 emit 事件给 WidgetIsland 主组件接管动画。

### 3.4 lib.rs 新增 command

- `get_idle_seconds() -> u32`：用 `winapi::um::sysinfo::GetLastInputInfo` + `GetTickCount` 计算真实闲置秒数，供久坐检测使用。

## 4. 天气 + 快捷启动器（后端能力 + 复用类）

### 4.1 天气

lib.rs 新增 `get_weather(location: String, key: String) -> Result<WeatherData, String>` command。

- reqwest 调和风天气 `https://devapi.qweather.com/v7/weather/now`，参数 `location` + `key`。
- **城市获取**：先尝试 IP 定位（`https://ipapi.co/json/` 拿经纬度 → 城市），用户也可在设置里手动指定城市。`location` 持久化到 `localStorage`。
- **API Key**：设置区让用户填自己的和风 key（免费注册）。未填时角标不显示天气，避免内置 key 滥用/超额。
- 返回 `{temp, text, icon}`，前端映射成天气图标（晴/雨/云…）。10 分钟刷新一次，由前端控制频率。
- **错误处理**：网络失败/超时 → 角标静默隐藏，不刷红屏（天气非关键功能）。

`WeatherData` 结构：

```rust
#[derive(serde::Serialize)]
pub struct WeatherData {
    pub temp: String,
    pub text: String,
    pub icon: String, // 和风图标代码，前端映射
}
```

### 4.2 快捷启动器

- 设置区让用户拖入或选择 `.exe` / 协议 / UWP 应用，存成列表 `nsd_launcher_items`，每项 `{name, target, icon}`。
- **触发**：长按灵动岛（或右键菜单"启动器"）展开竖向列表，点击该项：
  - 协议类（`tencent://`、`weixin://` 等）→ 复用现有 `open_app_by_aumid`。
  - 普通程序（`.exe` 路径）→ 新增 `launch_exe(path: String)` command，用 `ShellExecuteW` 打开。
- **图标**：普通 exe 用 `ExtractIconW` 抽取图标转 base64；协议类用内置通用图标。
- 与现有交互不冲突：长按目前未绑定，右键菜单原有项（重置/锁定/流光/关闭）保留。

## 5. 微信/QQ 消息提醒（数据流 + 动画整合）

与现有通知系统耦合最深的一块。

### 5.1 QQ 消息（改动最小）

lib.rs:354 现有过滤只挡"微信"。QQ 的 Toast 本不在过滤名单，**已能抓到**。唯一改动：`open_app_by_aumid` 已支持 QQ 协议唤醒（`tencent://message/`），点击岛上 QQ 通知直接拉起 QQ。无需新代码，验证即可。

### 5.2 微信消息（新增 Rust 能力）

新增 `get_wechat_unread() -> Option<u32>` command：

- `EnumWindows` 枚举所有顶层窗口，对每个调 `GetWindowTextW`。
- 正则匹配标题：`^微信(?:\((\d+)\))?$` → 捕获组为未读数；纯"微信"（无数子）表示已读或无新消息。
- 找不到匹配窗口 → 微信没开，返回 None。

前端在 notifyTimer（2.5s）里追加一次 `get_wechat_unread` 调用，与系统通知合并为同一个"消息提醒"事件。

### 5.3 动画整合

- **触发**：微信未读数 >0 且当前岛上没在显示别的消息时，走 `isMsgActive` 同款扩展动画，岛上显示"微信 N 条新消息" + 微信图标。
- **优先级仲裁**：系统 Toast（QQ 等，内容更具体）> 微信计数提醒。同一时刻只展示一条，避免岛疯狂跳动。
- **防抖**：未读数从 0→N 触发一次提醒；N→N+1 不重复弹（只有真正"新到达"才弹，靠比较上次计数实现）。
- **收回**：微信计数归零（用户打开微信看了）→ 自动收回。

## 6. 文件改动清单

| 文件 | 改动 |
|------|------|
| `src-tauri/src/lib.rs` | 新增 `get_idle_seconds`、`get_weather`、`get_wechat_unread`、`launch_exe`；注册到 invoke_handler |
| `src/composables/usePomodoro.ts` | 新建——番茄钟状态机 |
| `src/composables/useHealthReminders.ts` | 新建——久坐/喝水提醒 |
| `src/composables/useBadge.ts` | 新建——统一角标插槽（优先级仲裁） |
| `src/views/WidgetIsland.vue` | 接入角标插槽、提醒动画通道、微信未读轮询、天气展示、长按启动器 |
| `src/views/MainPanel.vue` | 新增设置区：番茄钟/久坐喝水/天气(API key+城市)/启动器列表 |
| `src/assets/weather-icons/*` | 天气图标资源 |

## 7. 测试要点

- **番茄钟**：跨阶段切换、休眠恢复校准、角标颜色、暂停灰显。
- **久坐**：`GetLastInputInfo` 真实闲置判定（起身不催）；喝水纯计时。
- **天气**：未填 key 时静默；IP 定位失败 fallback 手动城市；超时不刷红。
- **微信**：窗口标题正则（`微信` / `微信(3)`）；防抖（不重复弹）；计数归零收回；优先级仲裁（与 QQ Toast 同时到达）。
- **QQ**：验证 Toast 已能抓取、点击协议唤醒。
- **启动器**：长按触发；协议/exe 两类启动；图标抽取。
- **角标**：多提醒同时触发时的优先级排队。

## 8. 实施顺序建议

1. 角标插槽基础设施（`useBadge`）+ 番茄钟（最先见效、最独立）。
2. 久坐/喝水（复用番茄钟通道，加 `get_idle_seconds`）。
3. 微信/QQ（改动通知核心，需谨慎测试动画仲裁）。
4. 天气（独立后端 command，低风险）。
5. 快捷启动器（交互最重，最后做）。
