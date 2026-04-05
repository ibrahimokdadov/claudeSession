"""
claudeSession — demo GIF
900×560px, shows the full flow: chaos → dashboard opens → sessions appear →
user clicks Focus → right terminal jumps forward → subagent tree expands.
Output: posts/demo.gif
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 900, 560

BG      = (8,  12, 16)
BG2     = (13, 17, 23)
BG3     = (22, 27, 34)
BORDER  = (33, 38, 45)
BORDER2 = (48, 54, 61)
BLUE    = (88, 166, 255)
GREEN   = (63, 185, 80)
YELLOW  = (227, 179, 65)
RED     = (248, 81, 73)
PURPLE  = (188, 140, 255)
TEXT    = (230, 237, 243)
DIM     = (125, 133, 144)
DIM2    = (72, 79, 88)

FONT_DIR = "C:/Windows/Fonts/"

def font(name, size):
    for f in [FONT_DIR + name,
              FONT_DIR + "consolab.ttf",
              FONT_DIR + "consola.ttf",
              FONT_DIR + "cour.ttf",
              FONT_DIR + "arial.ttf"]:
        try: return ImageFont.truetype(f, size)
        except: pass
    return ImageFont.load_default()

F_BOLD   = font("consolab.ttf", 18)
F_REG    = font("consola.ttf",  14)
F_SM     = font("consola.ttf",  11)
F_UI_LG  = font("segoeui.ttf",  28)
F_UI_MD  = font("segoeui.ttf",  18)
F_UI_SM  = font("segoeui.ttf",  14)

def tw(draw, text, f):
    try:    return draw.textbbox((0,0), text, font=f)[2]
    except: return len(text)*8

def base():
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    for x in range(0, W, 40): draw.line([(x,0),(x,H)], fill=(14,19,26))
    for y in range(0, H, 40): draw.line([(0,y),(W,y)], fill=(14,19,26))
    return img, draw

def rr(draw, xy, r, fill=None, outline=None, w=1):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=w)

def dot(draw, cx, cy, r, color):
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=color)

# ── Shared layout constants ───────────────────────────────────────────────────
NAV_H  = 38
SB_W   = 148
SB_X   = 0
MAIN_X = SB_W + 1
MAIN_W = W - MAIN_X

PROJECTS = [
    ("claudesession", BLUE,   "2"),
    ("recoverer",     GREEN,  "3"),
    ("linkder",       YELLOW, "1"),
    ("brutaltodo",    RED,    "2"),
]

# sessions to reveal progressively
ALL_SESSIONS = [
    dict(sid="82a2d75a", color=BLUE,   status="working",  meta="Editing session-hook.js",       indent=0),
    dict(sid="sub·4f1c", color=PURPLE, status="subagent", meta="Explore · scanning files",       indent=18),
    dict(sid="e77c99d5", color=YELLOW, status="waiting",  meta="Waiting for your input",         indent=0),
    dict(sid="9fc12ab3", color=GREEN,  status="done",     meta="Committed 3 files",              indent=0),
]

def draw_nav(draw):
    draw.rectangle([0, 0, W, NAV_H], fill=BG3)
    draw.line([(0, NAV_H),(W, NAV_H)], fill=BORDER)
    draw.text((12, 10), "claudeSession", font=F_BOLD, fill=BLUE)
    dot(draw, W-20, NAV_H//2, 5, GREEN)
    draw.text((W-50, 12), "live", font=F_SM, fill=GREEN)

def draw_sidebar(draw, selected=0):
    draw.rectangle([SB_X, NAV_H, SB_X+SB_W, H], fill=BG2)
    draw.line([(SB_X+SB_W, NAV_H),(SB_X+SB_W, H)], fill=BORDER)
    draw.text((SB_X+10, NAV_H+8), "PROJECTS", font=F_SM, fill=DIM2)
    py = NAV_H + 30
    for i, (name, color, count) in enumerate(PROJECTS):
        if i == selected:
            draw.rectangle([SB_X+2, py-2, SB_X+SB_W-2, py+22], fill=BG3)
        dot(draw, SB_X+14, py+9, 5, color)
        draw.text((SB_X+26, py+1), name, font=F_SM, fill=TEXT if i==selected else DIM)
        cw = tw(draw, count, F_SM)
        rr(draw, [SB_X+SB_W-cw-16, py+3, SB_X+SB_W-6, py+17], 4, outline=BORDER)
        draw.text((SB_X+SB_W-cw-11, py+4), count, font=F_SM, fill=DIM2)
        py += 28

def draw_session(draw, y, s, focused=False, expanded=False):
    bx = MAIN_X + 8 + s["indent"]
    bw = MAIN_W - 16 - s["indent"]
    bg = BG3 if focused else BG2
    border = BLUE if focused else (BORDER2 if expanded else BORDER)
    rr(draw, [bx, y, bx+bw, y+58], 4, fill=bg, outline=border)
    # tree line for subagents
    if s["indent"] > 0:
        ix = MAIN_X + 8 + 8
        draw.line([(ix, y-10),(ix, y+29)], fill=BORDER2)
        draw.line([(ix, y+29),(ix+12, y+29)], fill=BORDER2)
    dot(draw, bx+14, y+18, 5, s["color"])
    draw.text((bx+26, y+8),  s["sid"],    font=F_REG,  fill=TEXT)
    sw = tw(draw, s["sid"], F_REG)
    draw.text((bx+26+sw+8, y+10), s["status"], font=F_SM, fill=s["color"])
    draw.text((bx+26, y+30), s["meta"],   font=F_SM,  fill=DIM)
    # focus button
    if s["indent"] == 0:
        btn_fill = BLUE if focused else None
        btn_text_color = BG if focused else DIM
        rr(draw, [bx+bw-56, y+14, bx+bw-8, y+34], 3, fill=btn_fill, outline=BORDER2)
        draw.text((bx+bw-50, y+18), "focus", font=F_SM, fill=btn_text_color)

def draw_main_header(draw, count_str):
    draw.rectangle([MAIN_X, NAV_H, W, NAV_H+28], fill=BG2)
    draw.line([(MAIN_X, NAV_H+28),(W, NAV_H+28)], fill=BORDER)
    draw.text((MAIN_X+10, NAV_H+7), count_str, font=F_SM, fill=DIM2)

def draw_empty_main(draw):
    draw_main_header(draw, "0 sessions")
    draw.text((MAIN_X + MAIN_W//2 - 60, H//2 - 10),
              "no sessions yet", font=F_UI_SM, fill=DIM2)

# ══════════════════════════════════════════════════════════════════════════════
# SCENES
# ══════════════════════════════════════════════════════════════════════════════

def scene_chaos():
    """Before: identical tabs with no identity"""
    img, draw = base()
    draw.text((W//2-180, 60), "Claude Code  ●", font=F_UI_LG, fill=DIM)
    draw.text((W//2-180, 100), "Claude Code  ●", font=F_UI_LG, fill=DIM)
    draw.text((W//2-180, 140), "Claude Code  ●", font=F_UI_LG, fill=DIM)
    draw.text((W//2-180, 180), "Claude Code  ●", font=F_UI_LG, fill=DIM)
    draw.text((W//2-180, 220), "Claude Code  ●", font=F_UI_LG, fill=DIM)
    draw.text((W//2-180, 260), "Claude Code  ●", font=F_UI_LG, fill=DIM)
    # question marks
    for i, q in enumerate(["which project?", "working?", "which project?", "subagent?", "crashed?", "which project?"]):
        draw.text((W//2+80, 68+i*40), q, font=F_UI_SM, fill=YELLOW)
    draw.text((40, H-40), "12 sessions, 0 names", font=F_UI_SM, fill=DIM2)
    return img

def scene_dashboard_empty():
    """Dashboard just opened — empty, waiting for first session"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_empty_main(draw)
    return img

def scene_dashboard_1():
    """First session card appears"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_main_header(draw, "1 session · 1 active")
    draw_session(draw, NAV_H+36, ALL_SESSIONS[0])
    return img

def scene_dashboard_2():
    """Subagent appears under first session"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_main_header(draw, "2 sessions · 2 active")
    draw_session(draw, NAV_H+36, ALL_SESSIONS[0])
    draw_session(draw, NAV_H+36+64, ALL_SESSIONS[1])
    return img

def scene_dashboard_full():
    """All 4 sessions visible, different statuses"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_main_header(draw, "4 sessions · 2 active")
    offsets = [0, 64, 136, 200]
    for i, s in enumerate(ALL_SESSIONS):
        draw_session(draw, NAV_H+36+offsets[i], s)
    return img

def scene_focus_hover():
    """User hovering Focus on the waiting session"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_main_header(draw, "4 sessions · 2 active")
    offsets = [0, 64, 136, 200]
    for i, s in enumerate(ALL_SESSIONS):
        draw_session(draw, NAV_H+36+offsets[i], s, focused=(i==2))
    # tooltip
    tooltip_x = MAIN_X + MAIN_W - 200
    tooltip_y = NAV_H + 36 + offsets[2] - 28
    rr(draw, [tooltip_x, tooltip_y, tooltip_x+188, tooltip_y+22], 4,
       fill=BG3, outline=BORDER2)
    draw.text((tooltip_x+8, tooltip_y+4), "Switch to this terminal tab", font=F_SM, fill=DIM)
    return img

def scene_terminal_switch():
    """Terminal tab comes into focus — the right project"""
    img, draw = base()
    # simulate a terminal taking over most of the screen
    rr(draw, [20, 20, W-20, H-20], 8, fill=BG2, outline=BLUE, w=2)
    # titlebar
    rr(draw, [20, 20, W-20, 54], 6, fill=BG3)
    dot(draw, 44, 37, 5, RED)
    dot(draw, 60, 37, 5, YELLOW)
    dot(draw, 76, 37, 5, GREEN)
    draw.text((100, 26), "Windows Terminal  —  recoverer  (e77c99d5)", font=F_REG, fill=TEXT)
    # terminal content
    lines = [
        ("$ claude --resume e77c99d5",          DIM),
        ("",                                     TEXT),
        ("Resuming session e77c99d5...",          GREEN),
        ("Project:  recoverer",                  BLUE),
        ("Last tool: Read  ·  src/parser.rs",    DIM),
        ("",                                     TEXT),
        ("> Claude is waiting for your input",   YELLOW),
        ("",                                     TEXT),
        ("█",                                    TEXT),
    ]
    ly = 66
    for text, color in lines:
        draw.text((40, ly), text, font=F_REG, fill=color)
        ly += 22
    # badge
    rr(draw, [W-240, H-52, W-32, H-24], 4, fill=BG3, outline=BLUE)
    draw.text((W-228, H-46), "claudeSession · focused", font=F_SM, fill=BLUE)
    return img

def scene_subagent_expand():
    """Back to dashboard — subagent tree is visible, emphasised"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_main_header(draw, "4 sessions · 2 active")
    offsets = [0, 64, 136, 200]
    for i, s in enumerate(ALL_SESSIONS):
        draw_session(draw, NAV_H+36+offsets[i], s)
    # callout arrow + label for subagent tree
    ax, ay = MAIN_X + 8 + 18 + 26, NAV_H + 36 + 64 + 10
    draw.line([(ax-30, ay+8),(ax-8, ay+8)], fill=PURPLE, width=2)
    draw.polygon([(ax-8, ay+4),(ax+2, ay+8),(ax-8, ay+12)], fill=PURPLE)
    rr(draw, [MAIN_X+8, ay-14, MAIN_X+8+130, ay+10], 3, fill=BG3, outline=PURPLE)
    draw.text((MAIN_X+14, ay-10), "subagent tree", font=F_SM, fill=PURPLE)
    return img

def scene_hold():
    """Final hold frame — full dashboard, everything labeled"""
    img, draw = base()
    draw_nav(draw)
    draw_sidebar(draw, selected=0)
    draw_main_header(draw, "4 sessions  ·  2 active  ·  0 orphans")
    offsets = [0, 64, 136, 200]
    for i, s in enumerate(ALL_SESSIONS):
        draw_session(draw, NAV_H+36+offsets[i], s)
    # legend bottom
    draw.rectangle([0, H-30, W, H], fill=BG3)
    draw.line([(0, H-30),(W, H-30)], fill=BORDER)
    lx = 12
    for label, color in [("working", BLUE), ("subagent", PURPLE), ("waiting", YELLOW), ("done", GREEN)]:
        dot(draw, lx+5, H-15, 4, color)
        draw.text((lx+14, H-24), label, font=F_SM, fill=color)
        lx += 90
    draw.text((W-200, H-24), "claudesession.whhite.com", font=F_SM, fill=DIM2)
    return img

# ══════════════════════════════════════════════════════════════════════════════
# ASSEMBLE
# ══════════════════════════════════════════════════════════════════════════════
frames_ms = [
    (scene_chaos(),           2000),
    (scene_chaos(),           400),   # subtle hold
    (scene_dashboard_empty(), 600),
    (scene_dashboard_1(),     800),
    (scene_dashboard_2(),     700),
    (scene_dashboard_full(),  1200),
    (scene_focus_hover(),     1000),
    (scene_terminal_switch(), 1800),
    (scene_dashboard_full(),  600),
    (scene_subagent_expand(), 1400),
    (scene_hold(),            2200),
    (scene_chaos(),           600),   # loop back to before
]

imgs = [f for f, _ in frames_ms]
durs = [d for _, d in frames_ms]

out = os.path.join(os.path.dirname(__file__), "..", "posts", "demo.gif")
os.makedirs(os.path.dirname(out), exist_ok=True)

q = [im.quantize(colors=128, method=Image.Quantize.MEDIANCUT) for im in imgs]
q[0].save(out, save_all=True, append_images=q[1:],
          duration=durs, loop=0, optimize=True)

kb = os.path.getsize(out) // 1024
if kb > 2000:
    q2 = [im.quantize(colors=64, method=Image.Quantize.MEDIANCUT) for im in imgs]
    q2[0].save(out, save_all=True, append_images=q2[1:],
               duration=durs, loop=0, optimize=True)
    kb = os.path.getsize(out) // 1024

print(f"demo.gif  →  {kb} KB  ({out})")
