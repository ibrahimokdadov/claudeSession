"""
claudeSession — demo GIF generator
Renders a fake-but-realistic UI walkthrough using Pillow.
Output: demo.gif in the project root
"""

from PIL import Image, ImageDraw, ImageFont
import os

# ── Constants ────────────────────────────────────────────────────────────────
W, H = 900, 560
SIDEBAR_W = 200
FONT_DIR = "C:/Windows/Fonts/"
OUT_PATH = os.path.join(os.path.dirname(__file__), "..", "demo.gif")
SIZE_BUDGET_MB = 3.0

# Palette
BG     = (8,   12,  16)
BG2    = (13,  17,  23)
BG3    = (22,  27,  34)
BORDER = (33,  38,  45)
TEXT   = (230, 237, 243)
TEXT2  = (125, 133, 144)
TEXT3  = (72,  79,  88)
BLUE   = (88,  166, 255)
GREEN  = (63,  185, 80)
YELLOW = (227, 179, 65)
RED    = (248, 81,  73)
PURPLE = (188, 140, 255)
GREY   = (100, 110, 120)


# ── Font loader ───────────────────────────────────────────────────────────────
def load_font(size, bold=False):
    candidates = []
    if bold:
        candidates += ["consolab.ttf", "arialbd.ttf", "courbd.ttf"]
    candidates += ["consola.ttf", "cour.ttf", "arial.ttf"]
    for name in candidates:
        try:
            return ImageFont.truetype(FONT_DIR + name, size)
        except Exception:
            pass
    return ImageFont.load_default()


# Pre-load fonts once
F10  = load_font(10)
F11  = load_font(11)
F12  = load_font(12)
F13  = load_font(13)
F12B = load_font(12, bold=True)
F13B = load_font(13, bold=True)
F14B = load_font(14, bold=True)
F16B = load_font(16, bold=True)


# ── Drawing helpers ───────────────────────────────────────────────────────────
def text_w(draw, text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]


def draw_dot(draw, cx, cy, r, color, pulse=False, pulse_phase=0.0):
    """Draw a status indicator dot, optionally with a pulse ring."""
    if pulse:
        # Outer pulse ring fades in/out
        alpha = int(80 + 70 * pulse_phase)
        ring_r = r + 3 + int(2 * pulse_phase)
        ring_color = color + (alpha,)
        # Draw on a temporary RGBA layer for alpha
        # We approximate with a slightly larger circle in a muted version
        dim = tuple(max(0, c // 3) for c in color)
        draw.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r], fill=dim)
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


def draw_rounded_rect(draw, xy, radius, fill=None, outline=None, outline_width=1):
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=outline_width)


def truncate(draw, text, font, max_w):
    """Truncate text with ellipsis to fit within max_w pixels."""
    if text_w(draw, text, font) <= max_w:
        return text
    while text and text_w(draw, text + "…", font) > max_w:
        text = text[:-1]
    return text + "…"


# ── Component: Sidebar ────────────────────────────────────────────────────────
PROJECTS = [
    ("claudesession", BLUE,   "2", 2),
    ("recoverer",     GREEN,  "3", 1),
    ("linkder",       YELLOW, "1", 0),
    ("brutaltodo",    RED,    "2", 0),
    ("zonebar",       PURPLE, "1", 0),
]


def draw_sidebar(draw, selected_idx, hovered_idx=None):
    # Background
    draw_rounded_rect(draw, [0, 0, SIDEBAR_W - 1, H - 1], radius=0, fill=BG2)
    # Right border
    draw.line([SIDEBAR_W - 1, 0, SIDEBAR_W - 1, H], fill=BORDER)

    # Header
    draw.text((14, 18), "claudeSession", font=F14B, fill=TEXT)

    # Live dot + label
    draw_dot(draw, SIDEBAR_W - 22, 24, 4, GREEN)
    draw.text((SIDEBAR_W - 38, 17), "live", font=F10, fill=GREEN)

    # Divider
    draw.line([0, 44, SIDEBAR_W, 44], fill=BORDER)

    # Section label
    draw.text((14, 52), "PROJECTS", font=F10, fill=TEXT3)

    row_h = 38
    start_y = 70
    for i, (name, color, count, active) in enumerate(PROJECTS):
        y = start_y + i * row_h
        is_selected = i == selected_idx
        is_hovered  = i == hovered_idx

        # Row background
        if is_selected:
            draw_rounded_rect(draw, [4, y - 6, SIDEBAR_W - 4, y + row_h - 10], radius=4, fill=BG3)
            # Left accent bar (4px blue line)
            draw.rectangle([4, y - 6, 7, y + row_h - 10], fill=BLUE)
        elif is_hovered:
            draw_rounded_rect(draw, [4, y - 6, SIDEBAR_W - 4, y + row_h - 10], radius=4, fill=(22, 27, 34, 120))

        # Status dot
        draw_dot(draw, 20, y + 7, 4, color)

        # Project name
        name_color = TEXT if is_selected else TEXT2
        draw.text((32, y), name, font=F12B if is_selected else F12, fill=name_color)

        # Session count badge
        badge_x = SIDEBAR_W - 28
        badge_y = y
        badge_text = count
        bw = text_w(draw, badge_text, F10) + 8
        badge_color = color if is_selected else TEXT3
        draw_rounded_rect(draw, [badge_x - bw // 2, badge_y + 1, badge_x + bw // 2, badge_y + 14], radius=6, fill=BG3, outline=badge_color)
        draw.text((badge_x - bw // 2 + 4, badge_y + 2), badge_text, font=F10, fill=badge_color)

        # Active indicator
        if active:
            draw.text((32, y + 16), f"{active} active", font=F10, fill=color)


# ── Component: Session card ───────────────────────────────────────────────────
def draw_session_card(draw, x, y, w, session, pulse_phase=0.0, focus_state=None, opacity=1.0):
    """
    session dict keys:
      id, status, status_color, dot_color, time, message,
      indent (bool), show_focus (bool), show_kill (bool), is_child (bool)
    opacity: 0.0–1.0 for stale sessions
    """
    indent    = session.get("indent", 0)
    is_child  = session.get("is_child", False)
    card_x    = x + indent
    card_w    = w - indent
    card_h    = 64

    def dim(c):
        """Apply opacity to a color tuple."""
        if opacity >= 1.0:
            return c
        return tuple(int(v * opacity + BG2[i] * (1 - opacity)) for i, v in enumerate(c))

    # Tree line for child sessions
    if is_child:
        tree_x = x + indent - 12
        # Vertical line from top of card upward
        draw.line([tree_x, y - 8, tree_x, y + 18], fill=dim(BORDER), width=1)
        # Horizontal line to card
        draw.line([tree_x, y + 18, tree_x + 10, y + 18], fill=dim(BORDER), width=1)

    # Card background
    draw_rounded_rect(draw, [card_x, y, card_x + card_w, y + card_h], radius=5, fill=dim(BG3), outline=dim(BORDER))

    # Status dot
    dot_color = session["dot_color"]
    pulse = session.get("pulse", False)
    draw_dot(draw, card_x + 18, y + 18, 5, dim(dot_color), pulse=pulse, pulse_phase=pulse_phase)

    # Session ID
    draw.text((card_x + 32, y + 10), session["id"], font=F12B, fill=dim(TEXT))

    # Status badge
    sc = dim(session["status_color"])
    draw.text((card_x + 32, y + 27), session["status"], font=F11, fill=sc)

    # Time
    time_str = session.get("time", "")
    tw = text_w(draw, time_str, F11)
    draw.text((card_x + card_w - tw - 10, y + 10), time_str, font=F11, fill=dim(TEXT3))

    # Message
    msg = session.get("message", "")
    if msg:
        max_msg_w = card_w - 100
        msg = truncate(draw, msg, F11, max_msg_w)
        draw.text((card_x + 32, y + 44), msg, font=F11, fill=dim(TEXT2))

    # Action buttons
    btn_y = y + 10
    btn_x = card_x + card_w - 12

    if session.get("show_kill"):
        kill_w = 36
        btn_x -= kill_w
        kill_col = (80, 40, 38)
        kill_txt_col = RED
        draw_rounded_rect(draw, [btn_x, btn_y, btn_x + kill_w, btn_y + 18], radius=3, fill=kill_col, outline=RED)
        draw.text((btn_x + 4, btn_y + 3), "kill", font=F10, fill=kill_txt_col)
        btn_x -= 6

    if session.get("show_focus"):
        focus_label = "focused!" if focus_state == "done" else "focus"
        focus_color = GREEN if focus_state == "done" else BLUE
        focus_bg = (20, 40, 25) if focus_state == "done" else (25, 40, 65)
        focus_outline = GREEN if focus_state == "done" else (BLUE if focus_state == "hover" else BORDER)
        fw = text_w(draw, focus_label, F10) + 10
        btn_x -= fw
        draw_rounded_rect(draw, [btn_x, btn_y, btn_x + fw, btn_y + 18], radius=3, fill=dim(focus_bg), outline=dim(focus_outline))
        draw.text((btn_x + 5, btn_y + 3), focus_label, font=F10, fill=dim(focus_color))


# ── Component: Main panel ─────────────────────────────────────────────────────
def draw_main_panel(draw, title, subtitle, sessions, pulse_phase=0.0, focus_states=None):
    x = SIDEBAR_W + 1
    panel_w = W - x

    # Background
    draw.rectangle([x, 0, W, H], fill=BG)

    # Header row
    draw.text((x + 20, 20), title, font=F16B, fill=TEXT)
    draw.text((x + 20, 44), subtitle, font=F12, fill=TEXT2)

    # Divider
    draw.line([x, 62, W, 62], fill=BORDER)

    # Session cards
    card_y = 78
    card_x = x + 16
    card_w = panel_w - 32
    for i, sess in enumerate(sessions):
        fs = (focus_states or {}).get(i)
        draw_session_card(draw, card_x, card_y, card_w, sess,
                          pulse_phase=pulse_phase, focus_state=fs,
                          opacity=sess.get("opacity", 1.0))
        card_y += sess.get("indent", 0) // 4 + 76  # extra gap for indented


# ── Frame factory ─────────────────────────────────────────────────────────────
def make_frame(selected_project, hovered_project=None,
               main_title="", main_subtitle="",
               sessions=None, pulse_phase=0.0, focus_states=None):
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)

    # Overall chrome
    draw_rounded_rect(draw, [0, 0, W - 1, H - 1], radius=0, fill=BG)

    draw_sidebar(draw, selected_project, hovered_project)
    if sessions:
        draw_main_panel(draw, main_title, main_subtitle, sessions,
                        pulse_phase=pulse_phase, focus_states=focus_states)
    return img


# ── Session data ──────────────────────────────────────────────────────────────
CLAUDESESSION_SESSIONS = [
    dict(id="82a2d75a", status="working", status_color=BLUE, dot_color=BLUE,
         pulse=True, time="2m ago",
         message="curl -s http://localhost:3333/api/…",
         show_focus=True, show_kill=True, indent=0),
    dict(id="subagent", status="subagent", status_color=PURPLE, dot_color=PURPLE,
         pulse=False, time="1m ago",
         message="Explore · exploring codebase",
         show_focus=False, show_kill=False, indent=20, is_child=True),
]

RECOVERER_SESSIONS = [
    dict(id="engine-17163", status="working", status_color=BLUE, dot_color=BLUE,
         pulse=True, time="5m ago",
         message="cd C:/Users/ibrah/cascadeProjects/recov…",
         show_focus=True, show_kill=False, indent=0),
    dict(id="Recoverer-17163", status="waiting", status_color=YELLOW, dot_color=YELLOW,
         pulse=False, time="12m ago",
         message="Claude is waiting for your input",
         show_focus=True, show_kill=False, indent=0),
    dict(id="win-x64-17163", status="done", status_color=TEXT3, dot_color=GREY,
         pulse=False, time="2h ago",
         message="",
         show_focus=False, show_kill=False, indent=0, opacity=0.38),
]


# ── Scene list ────────────────────────────────────────────────────────────────
#
# Each entry: (hold_ms, frame_kwargs)
# pulse_phase cycles 0→1 across frames for the working dot animation

def build_scenes():
    scenes = []

    def add(ms, **kw):
        scenes.append((ms, kw))

    # ── Scene 1: Dashboard loads (1200ms) ─────────────────────────────────────
    for phase in [0.0, 0.3, 0.6]:
        add(400,
            selected_project=0,
            main_title="claudesession",
            main_subtitle="2 sessions · 2 active",
            sessions=CLAUDESESSION_SESSIONS,
            pulse_phase=phase)

    # ── Scene 2: Show claudesession sessions (1500ms) ──────────────────────────
    for phase in [0.9, 0.2, 0.5, 0.8]:
        add(375,
            selected_project=0,
            main_title="claudesession",
            main_subtitle="2 sessions · 2 active",
            sessions=CLAUDESESSION_SESSIONS,
            pulse_phase=phase)

    # ── Scene 3: Hover over recoverer (600ms) ─────────────────────────────────
    for phase in [0.1, 0.4]:
        add(300,
            selected_project=0,
            hovered_project=1,
            main_title="claudesession",
            main_subtitle="2 sessions · 2 active",
            sessions=CLAUDESESSION_SESSIONS,
            pulse_phase=phase)

    # ── Scene 4: Click recoverer (400ms) ──────────────────────────────────────
    add(400,
        selected_project=1,
        main_title="claudesession",
        main_subtitle="2 sessions · 2 active",
        sessions=CLAUDESESSION_SESSIONS,
        pulse_phase=0.6)

    # ── Scene 5: Switch to recoverer (1500ms) ─────────────────────────────────
    for phase in [0.0, 0.3, 0.6, 0.9]:
        add(375,
            selected_project=1,
            main_title="recoverer",
            main_subtitle="3 sessions · 1 active",
            sessions=RECOVERER_SESSIONS,
            pulse_phase=phase)

    # ── Scene 6: Hover focus button on session 1 (600ms) ──────────────────────
    for phase in [0.2, 0.5]:
        add(300,
            selected_project=1,
            main_title="recoverer",
            main_subtitle="3 sessions · 1 active",
            sessions=RECOVERER_SESSIONS,
            pulse_phase=phase,
            focus_states={0: "hover"})

    # ── Scene 7: Click → "focused!" (1000ms) ─────────────────────────────────
    for phase in [0.8, 0.1, 0.4]:
        add(333,
            selected_project=1,
            main_title="recoverer",
            main_subtitle="3 sessions · 1 active",
            sessions=RECOVERER_SESSIONS,
            pulse_phase=phase,
            focus_states={0: "done"})

    # ── Scene 8: Hold final state (1200ms) ────────────────────────────────────
    for phase in [0.7, 0.0, 0.3]:
        add(400,
            selected_project=1,
            main_title="recoverer",
            main_subtitle="3 sessions · 1 active",
            sessions=RECOVERER_SESSIONS,
            pulse_phase=phase,
            focus_states={0: "done"})

    return scenes


# ── Render ────────────────────────────────────────────────────────────────────
def render():
    scenes = build_scenes()

    frames    = []
    durations = []

    for ms, kw in scenes:
        img = make_frame(**kw)
        frames.append(img)
        durations.append(ms)

    # Quantize
    def quantize(imgs, colors):
        return [f.quantize(colors=colors, method=Image.Quantize.MEDIANCUT) for f in imgs]

    print(f"Rendering {len(frames)} frames …")
    quant = quantize(frames, 128)

    out = os.path.normpath(OUT_PATH)
    quant[0].save(
        out,
        save_all=True,
        append_images=quant[1:],
        duration=durations,
        loop=0,
        optimize=True,
    )

    size_mb = os.path.getsize(out) / 1_000_000
    print(f"Saved to {out}  ({size_mb:.2f} MB)")

    if size_mb > SIZE_BUDGET_MB:
        print("Over budget — re-quantizing to 64 colors …")
        quant = quantize(frames, 64)
        quant[0].save(
            out,
            save_all=True,
            append_images=quant[1:],
            duration=durations,
            loop=0,
            optimize=True,
        )
        size_mb = os.path.getsize(out) / 1_000_000
        print(f"Re-saved  ({size_mb:.2f} MB)")

    return out, size_mb


if __name__ == "__main__":
    path, size = render()
    print(f"\ndone — {path}  {size:.2f} MB")
