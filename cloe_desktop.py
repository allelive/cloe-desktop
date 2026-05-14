#!/usr/bin/env python3
"""
Cloe Avatar Desktop - Come da guida originale GitHub
Avatar realistico sempre in primo piano, forma libera, mobile
"""

import sys
import time
import random
import requests
from pathlib import Path
from io import BytesIO

from PyQt6.QtCore import Qt, QTimer, QPoint, QSize
from PyQt6.QtGui import QPixmap, QPainter, QImage, QCursor
from PyQt6.QtWidgets import QApplication, QWidget, QMenu
from PIL import Image

CLOE_GIFS = Path("/home/allelive/cloe-desktop/public/gifs")
HTTP_API = "http://localhost:19851"


class CloeAvatar(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Cloe Avatar")
        self.setWindowFlags(
            Qt.WindowType.FramelessWindowHint |
            Qt.WindowType.WindowStaysOnTopHint |
            Qt.WindowType.Tool
        )
        self.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)

        self.setFixedSize(250, 350)
        self._center_on_screen()

        self._current_gif = "blink"
        self._gif_frames = []
        self._frame_idx = 0
        self._frame_duration = 100
        self._last_frame_time = 0

        self._gif_cache = {}
        self._load_all_gifs()
        self._load_gif("blink")

        self._dragging = False
        self._drag_offset = QPoint()

        self._poll_timer = QTimer(self)
        self._poll_timer.timeout.connect(self._poll_http)
        self._poll_timer.start(500)

        self._anim_timer = QTimer(self)
        self._anim_timer.timeout.connect(self._animate)
        self._anim_timer.start(100)

        self._idle_timer = QTimer(self)
        self._idle_timer.timeout.connect(self._idle_behavior)
        self._idle_timer.start(random.randint(8000, 15000))

    def _center_on_screen(self):
        screen = QApplication.primaryScreen()
        geo = screen.geometry()
        # Posizione: sinistra dello schermo, centrato verticalmente
        x = 50
        y = (geo.height() - 500) // 2
        self.move(x, y)
        self.setFixedSize(350, 500)

    def _load_all_gifs(self):
        """Carica tutti i GIF."""
        actions = ["blink", "smile", "kiss", "wave", "think", "working", "speak",
                  "laugh", "clap", "yawn", "shy", "tease", "nod", "shake_head"]
        for name in actions:
            path = CLOE_GIFS / f"{name}.gif"
            if path.exists():
                try:
                    img = Image.open(str(path))
                    frames = []
                    try:
                        while True:
                            frames.append(img.copy().convert("RGBA"))
                            img.seek(len(frames))
                    except EOFError:
                        pass
                    if frames:
                        self._gif_cache[name] = frames
                except Exception as e:
                    print(f"[Cloe] Errore {name}: {e}")

    def _load_gif(self, name: str):
        """Carica un GIF specifico."""
        if name in self._gif_cache:
            self._gif_frames = self._gif_cache[name]
            self._frame_idx = 0
            self._current_gif = name

    def _poll_http(self):
        """Controlla API per azioni."""
        try:
            r = requests.get(f"{HTTP_API}/status", timeout=1)
            if r.status_code == 200:
                data = r.json()
                action = data.get("current_action", "blink")
                if action != self._current_gif and action in self._gif_cache:
                    self._load_gif(action)
        except:
            pass

    def _animate(self):
        """Avanza animazione."""
        now = time.time() * 1000
        if now - self._last_frame_time > self._frame_duration:
            if self._gif_frames:
                self._frame_idx = (self._frame_idx + 1) % len(self._gif_frames)
            self._last_frame_time = now
            self.update()

    def _idle_behavior(self):
        """Comportamento idle - animazioni casuali."""
        if self._current_gif in ("blink", "idle") and random.random() < 0.3:
            idle_actions = ["smile", "kiss", "think", "nod", "shake_head"]
            action = random.choice(idle_actions)
            if action in self._gif_cache:
                self._load_gif(action)
                QTimer.singleShot(3000, lambda: self._load_gif("blink"))

        self._idle_timer.setInterval(random.randint(8000, 15000))

    def paintEvent(self, _):
        """Disegna l'avatar con sfondo trasparente."""
        p = QPainter(self)
        p.setRenderHint(QPainter.RenderHint.Antialiasing)
        p.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)

        if self._gif_frames:
            frame = self._gif_frames[self._frame_idx]
            buf = BytesIO()
            frame.save(buf, format="PNG")
            qimg = QImage.fromData(buf.getvalue())
            pixmap = QPixmap.fromImage(qimg)

            scaled = pixmap.scaled(
                self.size(),
                Qt.AspectRatioMode.KeepAspectRatio,
                Qt.TransformationMode.SmoothTransformation,
            )
            p.drawPixmap(0, 0, scaled)

    def mousePressEvent(self, e):
        if e.button() == Qt.MouseButton.LeftButton:
            self._dragging = True
            self._drag_offset = e.globalPosition().toPoint() - self.frameGeometry().topLeft()
            self._load_gif("wave")

    def mouseMoveEvent(self, e):
        if self._dragging:
            self.move(e.globalPosition().toPoint() - self._drag_offset)

    def mouseReleaseEvent(self, e):
        if self._dragging:
            self._dragging = False
            self._load_gif("blink")

    def wheelEvent(self, e):
        delta = e.angleDelta().y()
        if delta > 0:
            self.resize(int(self.width() * 1.1), int(self.height() * 1.1))
        else:
            self.resize(int(self.width() * 0.9), int(self.height() * 0.9))

    def contextMenuEvent(self, e):
        from PyQt6.QtWidgets import QMenu
        menu = QMenu(self)
        menu.addAction("Chiudi", self.close)
        menu.exec(QCursor.pos())


if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = CloeAvatar()
    window.show()
    sys.exit(app.exec())