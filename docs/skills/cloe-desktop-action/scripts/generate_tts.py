#!/usr/bin/env python3
"""
MOSI TTS 音频生成脚本

从 ~/.cloe/tts-config.json 读取配置，生成 MP3 音频文件。
输出到 ~/.cloe/audio_cache/ 目录。

用法:
  python3 generate_tts.py --text "要说的话"
  python3 generate_tts.py --text "要说的话" --output /tmp/custom.mp3
  python3 generate_tts.py --text "要说的话" --speak  # 生成后自动触发桌面 speak

输出: 打印生成的 MP3 文件路径（方便调用方 capture stdout）
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.request


CONFIG_PATH = os.path.expanduser("~/.cloe/tts-config.json")
AUDIO_CACHE = os.path.expanduser("~/.cloe/audio_cache")
BRIDGE_URL = "http://localhost:19851"


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def generate_mosi(text, api_key, voice_id, url):
    """调用 MOSI 云端 TTS，返回 WAV 字节数据"""
    payload = json.dumps({
        "model": "moss-tts",
        "text": text,
        "voice_id": voice_id,
        "sampling_params": {"temperature": 1.7, "top_p": 0.8, "top_k": 25},
    }).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    audio_b64 = result.get("audio_data")
    if not audio_b64:
        raise RuntimeError(f"MOSI 返回无 audio_data: {list(result.keys())}")

    return base64.b64decode(audio_b64)


def generate_cosyvoice(text, api_key, model, voice):
    """调用阿里云 CosyVoice TTS，返回 MP3 字节数据"""
    import urllib.request

    payload = json.dumps({
        "model": model,
        "input": {"text": text},
        "parameters": {"voice": voice},
    }).encode()

    req = urllib.request.Request(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation",
        data=payload,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "false",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())

    # CosyVoice 返回音频 URL，需要下载
    audio_url = result.get("output", {}).get("audio_url")
    if not audio_url:
        raise RuntimeError(f"CosyVoice 返回无 audio_url: {result}")

    with urllib.request.urlopen(audio_url, timeout=30) as audio_resp:
        return audio_resp.read()


def wav_to_mp3(wav_path, mp3_path):
    """WAV 转 MP3（Electron new Audio() 播放 WAV 不完整，必须转）"""
    subprocess.run([
        "ffmpeg", "-y", "-i", wav_path,
        "-c:a", "libmp3lame", "-q:a", "4", mp3_path,
    ], check=True, capture_output=True)
    return mp3_path


def trigger_speak(mp3_filename):
    """触发桌面端 speak 动作播放音频"""
    import urllib.request

    payload = json.dumps({
        "action": "speak",
        "audio_url": f"{BRIDGE_URL}/tts/{mp3_filename}",
    }).encode()

    req = urllib.request.Request(
        f"{BRIDGE_URL}/action",
        data=payload,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def main():
    parser = argparse.ArgumentParser(description="MOSI TTS 音频生成")
    parser.add_argument("--text", required=True, help="要合成的文本")
    parser.add_argument("--output", default=None, help="输出 MP3 路径（默认 ~/.cloe/audio_cache/tts_<timestamp>.mp3）")
    parser.add_argument("--speak", action="store_true", help="生成后自动触发桌面 speak 播放")
    parser.add_argument("--provider", default=None, help="强制指定 provider（mosi/cosyvoice），默认读配置")
    args = parser.parse_args()

    config = load_config()
    provider = args.provider or config.get("provider", "mosi")
    os.makedirs(AUDIO_CACHE, exist_ok=True)

    ts = int(time.time())
    if args.output:
        mp3_path = args.output
    else:
        mp3_path = os.path.join(AUDIO_CACHE, f"tts_{ts}.mp3")

    if provider == "mosi":
        cfg = config["mosi"]
        print(f"[INFO] MOSI TTS 生成中...", file=sys.stderr)
        wav_bytes = generate_mosi(args.text, cfg["api_key"], cfg["voice_id"], cfg["url"])
        # 保存临时 WAV
        wav_path = mp3_path + ".wav"
        with open(wav_path, "wb") as f:
            f.write(wav_bytes)
        print(f"[INFO] WAV: {wav_path} ({len(wav_bytes)} bytes)", file=sys.stderr)
        # 转 MP3
        wav_to_mp3(wav_path, mp3_path)
        os.remove(wav_path)
    elif provider == "cosyvoice":
        cfg = config["cosyvoice"]
        api_key = os.environ.get(cfg["api_key_env"])
        if not api_key:
            raise ValueError(f"环境变量 {cfg['api_key_env']} 未设置")
        print(f"[INFO] CosyVoice TTS 生成中...", file=sys.stderr)
        mp3_bytes = generate_cosyvoice(args.text, api_key, cfg["model"], cfg["voice"])
        with open(mp3_path, "wb") as f:
            f.write(mp3_bytes)
    else:
        raise ValueError(f"未知 provider: {provider}")

    size = os.path.getsize(mp3_path)
    print(f"[OK] MP3: {mp3_path} ({size} bytes)", file=sys.stderr)

    if args.speak:
        filename = os.path.basename(mp3_path)
        result = trigger_speak(filename)
        print(f"[OK] speak triggered: {result}", file=sys.stderr)

    # stdout 只输出路径，方便调用方 capture
    print(mp3_path)


if __name__ == "__main__":
    main()
