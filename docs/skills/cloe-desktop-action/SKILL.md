---
name: cloe-desktop-action
description: 通过 HTTP API 动态发现和触发 Cloe 桌面角色的表情动作动画
---

# Cloe Desktop Action — 桌面动画触发

## 前置条件

Cloe Desktop 必须在运行：

```bash
curl -s http://localhost:19851/status
# 期望: {"ws_port":19850,"http_port":19851,"clients":1}
```

## 动态发现可用动作

**不要硬编码动作列表。** 通过 API 实时获取：

```bash
curl -s http://localhost:19851/actions
curl -s http://localhost:19851/action-sets
```

`GET /actions` 返回含 `name`、`description`、`hookNames`、`special` 等字段的动作列表。用 `description` 匹配语境，用 `name` 或 `hookNames` 触发。

## 触发动作

```bash
curl -s http://localhost:19851/action -d '{"action":"<ACTION_NAME>"}'
```

动作播放约 3 秒后自动恢复 idle 循环。

## 语音动作（speak）

> ⚠️ **禁止使用 Hermes 内置的 `text_to_speech` 工具。** 所有 TTS 必须使用 `~/.cloe/tts-config.json` 配置的 provider（默认 mosi）。

### 方式一：TTS 动态语音（推荐）

链路：`generate_tts.py` 生成 MP3 → 保存到 `~/.cloe/audio_cache/` → bridge `/tts/` 路由 serve → speak 播放。

#### 脚本：`scripts/generate_tts.py`

**唯一正确的 TTS 调用方式**，自动读取 `~/.cloe/tts-config.json` 配置。

```bash
# 生成音频（输出 MP3 路径到 stdout）
python3 scripts/generate_tts.py --text "要说的话"

# 生成 + 自动触发桌面 speak 播放
python3 scripts/generate_tts.py --text "要说的话" --speak

# 指定输出路径
python3 scripts/generate_tts.py --text "要说的话" --output /tmp/custom.mp3

# 强制指定 provider
python3 scripts/generate_tts.py --text "要说的话" --provider cosyvoice
```

stdout 只输出 MP3 文件路径，日志输出到 stderr。

#### 配置 TTS Provider

配置文件：`~/.cloe/tts-config.json`（**唯一的 TTS 配置来源**）

```json
{
  "provider": "mosi",
  "mosi": {
    "api_key": "<MOSI_API_KEY>",
    "voice_id": "2036257587296473088",
    "url": "https://studio.mosi.cn/v1/audio/tts"
  },
  "cosyvoice": {
    "api_key_env": "BAILIAN_API_KEY",
    "model": "cosyvoice-v1",
    "voice": "longmiao"
  }
}
```

**provider 字段**选择 TTS 引擎：
- `"mosi"` — MOSI 云端 TTS（可可音色，快 ~3s）**← 默认**
- `"cosyvoice"` — 阿里云 CosyVoice（多音色可选）

#### MOSI API 调用规范（⚠️ 脚本已封装，一般不需要手动调）

如果手动调用，**必须**按以下格式：

```python
headers = {
    "Authorization": f"Bearer {api_key}",  # ← 必须用 Bearer auth
    "Content-Type": "application/json",
}
payload = {
    "model": "moss-tts",        # ← 必须有
    "text": text,
    "voice_id": voice_id,
    "sampling_params": {"temperature": 1.7, "top_p": 0.8, "top_k": 25},
}
resp = requests.post(url, json=payload, headers=headers)
# 返回 {"audio_data": "<base64>"}，解码后是 WAV → 必须 ffmpeg 转 MP3
```

❌ 不带 `Authorization` header 或 body 不含 `model` 字段 → 401。

#### 播放要点

- TTS 文本用完整连贯句子，少用省略号/波浪号
- MOSI 返回 WAV，脚本自动转 MP3（Electron `new Audio()` 播放 WAV 不完整）
- 也可以手动 speak 已有音频：`curl -s http://localhost:19851/action -d '{"action":"speak","audio_url":"http://localhost:19851/tts/<FILENAME>.mp3"}'`
- **speak 播放期间其他 action 被 drop，另一个 speak 可覆盖**——长内容合并成一句 TTS 一次发完

### 方式二：预录语音（`audio` 字段）

```bash
curl -s http://localhost:19851/action -d '{"action":"speak","audio":"doing"}'
```

预录文件存放在 `~/.cloe/audio_cache/`，和 TTS 共用 `GET /tts/` 路由。
现有预录文件：`doing.mp3`（"小可爱，我这就去做"）、`done.mp3`（"小可爱，做好了，你看看"）。

添加新语音：TTS 生成 → `ffmpeg` 转 mp3 → 放 `~/.cloe/audio_cache/`。

### 方式三：data URL（短音频，<5s）

base64 编码后传 `data:audio/mpeg;base64,...`，curl 上限约 128KB。

## 系统动作

| 动作 | 触发方式 | 说明 |
|------|---------|------|
| `working` | hook agent:start | 敲键盘，锁定工作模式 |
| `idle` | hook agent:end | 恢复 idle 循环 |
| `wave` | hook session:start | 新会话打招呼 |
| `kiss` | hook session:end | 会话结束 |

## Hermes Plugin（自动触发）

`~/.hermes/plugins/cloe-desktop/` 监听生命周期事件自动触发表情。

### 触发规则（plugin-rules.json）

存在 `~/.cloe/plugin-rules.json`，5 秒缓存自动刷新。

```json
{
  "min_interval": 1.5,
  "tool_expressions": {"terminal": "think", "execute_code": "think", "read_file": null},
  "tool_completions": {"delegate_task": "clap", "execute_code": "nod"},
  "keyword_map": [
    {"keywords": ["晚安", "睡了"], "action": "kiss"}
  ],
  "context_thresholds": {
    "warning": {"pct": 75, "action": "think"},
    "critical": {"pct": 90, "action": "shake_head"}
  }
}
```

### Plugin 监听的 Hooks

| Hook | 时机 | 动作 |
|------|------|------|
| on_session_start | 新 session | wave |
| on_session_end | 正常结束 | kiss |
| on_session_end | 被中断 | shake_head |
| pre_tool_call | 工具执行前 | 按 tool_expressions |
| post_tool_call | 工具完成后 | 按 tool_completions |
| pre_llm_call | LLM 调用前 | 关键词匹配 |
| post_llm_call | LLM 调用后 | idle + 超长→yawn |
| post_api_request | API 请求后 | context 阈值 |
| subagent_stop | 子 agent 完成 | 成功→clap / 失败→shake_head |

> 修改 plugin 文件后需重启 Hermes gateway 才能生效。

## 生成新动作（GIF Pipeline）

Cloe 可以自己生成新动作！完整链路：参考图 → AI 视频 → chromakey → 透明 GIF。

### 方式一：脚本直接生成（推荐，不依赖后台服务）

```bash
# 单个生成（默认绿幕，输出到 ~/.cloe/gifs/{action}.gif）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。"

# 蓝幕模式（对黑发效果更好）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯蓝色背景。电影质感，高清。" \
  --chromakey blue

# 指定参考图
python3 scripts/generate_gif_v2.py \
  --action wave \
  --prompt "她开心地挥手打招呼，身体保持不动。纯蓝色背景。电影质感，高清。" \
  --reference ~/.cloe/references/default.png

# 自定义输出路径（不自动复制到 ~/.cloe/gifs/）
python3 scripts/generate_gif_v2.py \
  --action pout \
  --prompt "..." \
  --output /tmp/pout.gif --no-copy
```

**脚本自动完成**：压缩参考图（>4MB）→ 百炼 wan2.7-i2v 生成视频 → ffmpeg chromakey → Python 去色晕 → 透明 GIF → 复制到 `~/.cloe/gifs/`。

**生成后**：测试播放 `curl -s http://localhost:19851/action -d '{"action":"pout"}'`

> ⚠️ 脚本需要 `requests`、`PIL`、`numpy`、`scipy`，用系统 Python 跑（不用 execute_code）。

### 方式二：管理界面 API（需 bridge 服务运行）

```bash
# 异步生成，立即返回 202 + taskId
curl -s -X POST http://localhost:19851/action-sets/default/generate-action \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pout",
    "prompt": "她微微嘟起嘴唇，表情可爱委屈，身体保持不动。纯绿色背景。电影质感，高清。",
    "duration": 5
  }'

# 查询任务状态
curl -s http://localhost:19851/generation-tasks/<taskId>
```

**自动完成**：生成 GIF → 更新 action-sets.json → 广播到 renderer。无需手动改代码。

### Prompt 写法要点

- **身体保持不动**：只描述头部/上半身微动作，避免大幅移动
- **纯色背景**：末尾必须加"纯绿色背景"或"纯蓝色背景"
- **电影质感，高清**：提高生成质量
- **时长**：一般 3-5 秒（idle 3 秒，表情 5 秒）
- 参考示例：`"她微微嘟起嘴唇，表情可爱委屈。身体保持不动。纯绿色背景。电影质感，高清。"`

### 已知限制

- 每次生成耗时 ~3-5 分钟（百炼 API 异步轮询）
- 绿幕对黑发有轻微残留，蓝幕效果更好

## 注意事项

- 动作间隔至少 3-5 秒，太快会被打断
- `clients=0` 时动作不生效
- `action-sets.json` 和 `plugin-rules.json` 支持热加载（rules 有 5 秒 TTL 缓存）
- **plugin.yaml 的 hooks 不支持热加载**：修改后必须重启 Hermes gateway 进程
