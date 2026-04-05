"""
generate-post-gifs.py
Generates 10 branded GIF cards for claudeSession social posts.
LinkedIn: 1200x628, Twitter: 1200x675
"""

import os
import textwrap
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BG       = "#080c10"
ACCENT   = "#58a6ff"
GREEN    = "#3fb950"
YELLOW   = "#e3b341"
TEXT     = "#e6edf3"
DIM      = "#7d8590"
BORDER   = "#21262d"
BRAND    = "#58a6ff"  # same as accent

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "posts", "gifs")
os.makedirs(OUT_DIR, exist_ok=True)

FONT_CANDIDATES = [
    "C:/Windows/Fonts/JetBrainsMono-Regular.ttf",
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/arial.ttf",
]

def load_font(size):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()

def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def draw_bg(draw, w, h):
    draw.rectangle([0, 0, w, h], fill=hex_to_rgb(BG))

def draw_border(draw, w, h, thickness=2):
    draw.rectangle([0, 0, w-1, h-1], outline=hex_to_rgb(BORDER), width=thickness)

def draw_brand_bar(draw, w, bar_h, offset_x, font_title, font_tag):
    """Draws the brand bar sliding in from offset_x."""
    # bar background
    draw.rectangle([offset_x, 0, w + offset_x, bar_h], fill=hex_to_rgb("#0d1117"))
    # left accent line
    draw.rectangle([offset_x, 0, offset_x + 4, bar_h], fill=hex_to_rgb(ACCENT))
    # title
    draw.text((offset_x + 24, 14), "claudeSession", font=font_title, fill=hex_to_rgb(ACCENT))
    # tagline
    draw.text((offset_x + 24, 14 + font_title.size + 6),
              "Session identity for Claude Code", font=font_tag, fill=hex_to_rgb(DIM))

def draw_text_block(draw, text, x, y, max_width, font, color, line_spacing=6):
    """Wraps and draws text, returns final y."""
    # estimate chars per line
    try:
        char_w = font.getlength("x")
    except AttributeError:
        char_w = font.size * 0.6
    chars_per_line = max(1, int(max_width / char_w))
    lines = []
    for para in text.split("\n"):
        if para.strip() == "":
            lines.append("")
        else:
            wrapped = textwrap.wrap(para, width=chars_per_line)
            lines.extend(wrapped if wrapped else [""])
    cy = y
    for line in lines:
        draw.text((x, cy), line, font=font, fill=hex_to_rgb(color))
        cy += font.size + line_spacing
    return cy

def quantize_image(img, colors=64):
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img.quantize(colors=colors, method=Image.Quantize.MEDIANCUT)

# ---------------------------------------------------------------------------
# Frame builders
# ---------------------------------------------------------------------------

BAR_H = 80  # height of brand bar

def make_frame_brand(w, h, slide_pct=1.0):
    """Frame 1: brand bar slides in. slide_pct 0=off-screen, 1=fully visible."""
    img = Image.new("RGB", (w, h), hex_to_rgb(BG))
    draw = ImageDraw.Draw(img)
    draw_bg(draw, w, h)

    font_title = load_font(28)
    font_tag   = load_font(16)

    # slide from left: offset goes from -w to 0
    offset_x = int((1.0 - slide_pct) * -w)
    draw_brand_bar(draw, w, BAR_H, offset_x, font_title, font_tag)
    draw_border(draw, w, h)
    return img

def make_frame_text(w, h, post_text, card_label, slide_pct=1.0):
    """Frame 2: brand bar + text builds in."""
    img = Image.new("RGB", (w, h), hex_to_rgb(BG))
    draw = ImageDraw.Draw(img)
    draw_bg(draw, w, h)

    font_title  = load_font(28)
    font_tag    = load_font(16)
    font_label  = load_font(14)
    font_body   = load_font(18)

    # brand bar fully visible
    draw_brand_bar(draw, w, BAR_H, 0, font_title, font_tag)

    # card label badge
    label_x, label_y = 40, BAR_H + 24
    draw.rectangle([label_x - 8, label_y - 4,
                    label_x + int(font_label.getlength(card_label) if hasattr(font_label, 'getlength') else len(card_label)*8) + 8,
                    label_y + font_label.size + 4],
                   fill=hex_to_rgb("#161b22"), outline=hex_to_rgb(ACCENT))
    draw.text((label_x, label_y), card_label, font=font_label, fill=hex_to_rgb(ACCENT))

    # body text — reveal proportionally to slide_pct
    text_x = 40
    text_y = label_y + font_label.size + 20
    max_w  = w - 80
    available_h = h - text_y - 40

    # split text into lines up front to know total
    try:
        char_w = font_body.getlength("x")
    except AttributeError:
        char_w = font_body.size * 0.6
    chars_per_line = max(1, int(max_w / char_w))
    all_lines = []
    for para in post_text.split("\n"):
        if para.strip() == "":
            all_lines.append("")
        else:
            wrapped = textwrap.wrap(para, width=chars_per_line)
            all_lines.extend(wrapped if wrapped else [""])

    # how many lines to show
    line_h = font_body.size + 6
    max_lines_visible = max(1, int(available_h / line_h))
    lines_to_show = max(1, int(len(all_lines) * slide_pct))
    lines_to_show = min(lines_to_show, max_lines_visible)

    cy = text_y
    for line in all_lines[:lines_to_show]:
        draw.text((text_x, cy), line, font=font_body, fill=hex_to_rgb(TEXT))
        cy += line_h

    # footer
    footer_font = load_font(13)
    footer_y = h - 32
    draw.text((40, footer_y), "claudesession.whhite.com", font=footer_font, fill=hex_to_rgb(DIM))
    draw.text((w - 240, footer_y), "github.com/ibrahimokdadov/claudeSession",
              font=footer_font, fill=hex_to_rgb(DIM))

    draw_border(draw, w, h)
    return img

def make_frame_hold(w, h, post_text, card_label):
    """Frame 3: fully rendered final state."""
    return make_frame_text(w, h, post_text, card_label, slide_pct=1.0)

# ---------------------------------------------------------------------------
# GIF assembly
# ---------------------------------------------------------------------------

def make_gif(out_path, w, h, post_text, card_label):
    frames_raw = []

    # Frame 1a: brand bar slides in (half-way)
    frames_raw.append((make_frame_brand(w, h, slide_pct=0.4), 80))
    # Frame 1b: brand bar fully in
    frames_raw.append((make_frame_brand(w, h, slide_pct=1.0), 120))
    # Frame 2: text builds in (partial)
    frames_raw.append((make_frame_text(w, h, post_text, card_label, slide_pct=0.5), 120))
    # Frame 3: hold final
    frames_raw.append((make_frame_hold(w, h, post_text, card_label), 200))  # ~2000ms hold (centiseconds)

    # Quantize for size
    q_frames = []
    durations = []
    for img, dur in frames_raw:
        q_frames.append(quantize_image(img))
        durations.append(dur * 10)  # PIL duration is in milliseconds

    q_frames[0].save(
        out_path,
        save_all=True,
        append_images=q_frames[1:],
        loop=0,
        duration=durations,
        optimize=True,
    )
    size_kb = os.path.getsize(out_path) / 1024
    print(f"  Saved {os.path.basename(out_path)} ({size_kb:.0f} KB)")

# ---------------------------------------------------------------------------
# Post content
# ---------------------------------------------------------------------------

LINKEDIN_W, LINKEDIN_H = 1200, 628
TWITTER_W,  TWITTER_H  = 1200, 675

posts = {
    # (filename_stem, width, height, label, text_excerpt)
    "linkedin-technical": (
        LINKEDIN_W, LINKEDIN_H,
        "LinkedIn · Technical",
        "Built a session identity layer for Claude Code using its native hook system.\n"
        "\n"
        "The core problem: Claude Code's hooks fire on every action but the data goes nowhere by default.\n"
        "claudeSession intercepts those hooks, writes structured session state to disk,\n"
        "and streams it to a React dashboard over WebSocket.\n"
        "\n"
        "Sessions are keyed by cwd at SessionStart so subagents cluster under one tree automatically.\n"
        "Parent-child relationships are inferred from the session_id chain.\n"
        "Tab focus uses Windows UI Automation to switch the right terminal to foreground.\n"
        "Zombie detection walks the process tree for orphaned node.exe processes."
    ),
    "linkedin-eli5": (
        LINKEDIN_W, LINKEDIN_H,
        "LinkedIn · ELI5",
        "Imagine 15 browser tabs open and every single one says 'New Tab'.\n"
        "That's what running Claude Code at scale feels like.\n"
        "\n"
        "Every terminal window, every VS Code panel — all say 'Claude Code'.\n"
        "You're running 15 sessions across 8 projects and they're completely anonymous.\n"
        "\n"
        "claudeSession fixes that: live dashboard showing which project each session belongs to,\n"
        "what it's currently doing, which sessions are parent agents vs. subagents,\n"
        "and which sessions are technically running but actually zombied."
    ),
    "linkedin-why-built": (
        LINKEDIN_W, LINKEDIN_H,
        "LinkedIn · Why we built it",
        "At some point I had 12 Claude Code sessions open across 4 projects\n"
        "and I genuinely could not tell which was which.\n"
        "\n"
        "The thing that broke me: I answered a question, approved an approach, said proceed.\n"
        "Three minutes later I realized I'd been talking to the wrong session for six minutes.\n"
        "I'd just approved the wrong service to proceed.\n"
        "\n"
        "The problem isn't that Claude Code hides session info — there's just no mechanism for it.\n"
        "No session registry, no process naming, no status indicator.\n"
        "The hooks exist but feed nothing by default. So I built the registry."
    ),
    "linkedin-unique": (
        LINKEDIN_W, LINKEDIN_H,
        "LinkedIn · What makes it different",
        "Most Claude Code monitoring tools focus on output: logs, token counts, cost.\n"
        "claudeSession focuses on identity.\n"
        "\n"
        "Hook-native, not polling — state changes in real time via Claude's own hook pipeline.\n"
        "Subagent tree, not a flat list — see the full execution tree per project.\n"
        "Windows Terminal tab control — 'Focus' actually switches the terminal tab.\n"
        "Zombie detection — crashed sessions get flagged, not stuck at 'working' forever.\n"
        "\n"
        "None of this required patching Claude Code or using undocumented internals.\n"
        "Everything runs through the documented hook system and standard Node.js APIs."
    ),
    "linkedin-story": (
        LINKEDIN_W, LINKEDIN_H,
        "LinkedIn · Story",
        "About two months into running Claude Code seriously, I had a specific failure mode:\n"
        "come back after ten minutes, spend two minutes figuring out which session I was in.\n"
        "\n"
        "I was reviewing output from what I thought was authentication work.\n"
        "I gave detailed feedback, approved the approach, told it to proceed.\n"
        "It proceeded — on the payment service, which I hadn't intended to touch.\n"
        "\n"
        "I built claudeSession that weekend. Now I open the dashboard before anything else.\n"
        "Green = working. Yellow = waiting. Gray = done. Red = look at it now.\n"
        "The tree shows exactly who spawned what."
    ),
    "twitter-technical": (
        TWITTER_W, TWITTER_H,
        "Twitter · Technical",
        "Built a session identity layer for Claude Code.\n"
        "Intercepts SessionStart/Stop/PreToolUse hooks, groups by cwd,\n"
        "streams to a React dashboard over WebSocket.\n"
        "Subagent trees auto-build from session_id chains.\n"
        "Tab focus via Windows UI Automation. #ClaudeCode"
    ),
    "twitter-eli5": (
        TWITTER_W, TWITTER_H,
        "Twitter · ELI5",
        "Every Claude Code tab says 'Claude Code'.\n"
        "With 15 sessions open that's 15 identical tabs.\n"
        "\n"
        "claudeSession watches each session and builds a live dashboard:\n"
        "project name, status, which sessions spawned which.\n"
        "Click to focus the right terminal. #ClaudeCode"
    ),
    "twitter-why-built": (
        TWITTER_W, TWITTER_H,
        "Twitter · Why we built it",
        "I answered a 6-minute conversation in the wrong Claude session.\n"
        "Gave detailed feedback, approved the approach, said proceed.\n"
        "It was working on the wrong service entirely.\n"
        "\n"
        "Built claudeSession that weekend."
    ),
    "twitter-unique": (
        TWITTER_W, TWITTER_H,
        "Twitter · What makes it different",
        "Most Claude monitoring tools track output.\n"
        "claudeSession tracks identity — which session is which,\n"
        "who spawned whom, which ones are zombied.\n"
        "\n"
        "Hook-native so updates are real time.\n"
        "One-click Windows Terminal focus actually switches the tab. #buildinpublic"
    ),
    "twitter-story": (
        TWITTER_W, TWITTER_H,
        "Twitter · Story",
        "Ran pwd to figure out which Claude session I was in.\n"
        "\n"
        "That's when I knew I had a tooling problem.\n"
        "\n"
        "claudeSession: claudesession.whhite.com"
    ),
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"Generating {len(posts)} GIFs into {OUT_DIR} ...\n")
    for stem, (w, h, label, text) in posts.items():
        out_path = os.path.join(OUT_DIR, f"{stem}.gif")
        print(f"  [{stem}]")
        make_gif(out_path, w, h, text, label)

    print(f"\nDone. Verifying files:")
    for stem in posts:
        p = os.path.join(OUT_DIR, f"{stem}.gif")
        if os.path.exists(p):
            print(f"  OK  {stem}.gif  ({os.path.getsize(p)//1024} KB)")
        else:
            print(f"  MISSING  {stem}.gif")
