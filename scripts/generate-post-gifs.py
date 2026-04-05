"""
claudeSession — promotional social GIFs
LinkedIn: 1200×628  Twitter: 1200×675
"""
from PIL import Image, ImageDraw, ImageFont
import os

# ── Palette ──────────────────────────────────────────────────────────────────
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
OUT_DIR  = os.path.join(os.path.dirname(__file__), "..", "posts", "gifs")
os.makedirs(OUT_DIR, exist_ok=True)

# ── Fonts ─────────────────────────────────────────────────────────────────────
def load(name, size):
    for f in [FONT_DIR + name,
              FONT_DIR + "consolab.ttf",
              FONT_DIR + "consola.ttf",
              FONT_DIR + "cour.ttf",
              FONT_DIR + "arial.ttf"]:
        try: return ImageFont.truetype(f, size)
        except: pass
    return ImageFont.load_default()

F_MONO_XL  = load("consolab.ttf", 52)
F_MONO_LG  = load("consolab.ttf", 36)
F_MONO_MD  = load("consolab.ttf", 26)
F_MONO_SM  = load("consola.ttf",  18)
F_MONO_XS  = load("consola.ttf",  14)
F_UI_XL    = load("segoeui.ttf",  44)
F_UI_LG    = load("segoeui.ttf",  30)
F_UI_MD    = load("segoeui.ttf",  22)
F_UI_SM    = load("segoeui.ttf",  17)

# ── Helpers ───────────────────────────────────────────────────────────────────
def new_frame(W, H):
    img  = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    for x in range(0, W, 40):
        draw.line([(x,0),(x,H)], fill=(16,21,28))
    for y in range(0, H, 40):
        draw.line([(0,y),(W,y)], fill=(16,21,28))
    return img, draw

def txt_w(draw, text, font):
    try:    return draw.textbbox((0,0), text, font=font)[2]
    except: return len(text) * 10

def rr(draw, xy, r, fill=None, outline=None, width=1):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)

def dot(draw, cx, cy, r, color):
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=color)

def accent_bar(draw, H, color=BLUE):
    draw.rectangle([0, 0, 5, H], fill=color)

def logo_tag(draw, W, H, label="claudeSession"):
    draw.text((W-txt_w(draw, label, F_MONO_XS)-20, H-30), label, font=F_MONO_XS, fill=DIM2)

PROJECTS = [
    ("claudesession", BLUE,   "2"),
    ("recoverer",     GREEN,  "3"),
    ("linkder",       YELLOW, "1"),
    ("brutaltodo",    RED,    "2"),
    ("aiBoss",        PURPLE, "5"),
]

SESSIONS = [
    ("82a2d75a", BLUE,   "working",  "Exploring codebase structure..."),
    ("  sub1",   PURPLE, "subagent", "Analyze · reading files"),
    ("e77c99d5", YELLOW, "waiting",  "Claude is waiting for your input"),
    ("9fc12ab3", GREEN,  "done",     "All changes committed"),
]

def draw_sidebar(draw, x, y, w, h, selected=0):
    rr(draw, [x, y, x+w, y+h], 6, fill=BG2, outline=BORDER)
    rr(draw, [x, y, x+w, y+36], 4, fill=BG3, outline=None)
    draw.text((x+12, y+9), "claudeSession", font=F_MONO_XS, fill=TEXT)
    dot(draw, x+w-20, y+18, 4, GREEN)
    py = y + 44
    for i, (name, color, count) in enumerate(PROJECTS):
        if i == selected:
            rr(draw, [x+4, py-2, x+w-4, py+20], 3, fill=BG3)
        dot(draw, x+16, py+9, 5, color)
        draw.text((x+28, py+1), name, font=F_MONO_XS, fill=TEXT if i==selected else DIM)
        cw = txt_w(draw, count, F_MONO_XS)
        rr(draw, [x+w-cw-18, py+2, x+w-8, py+18], 6, outline=BORDER)
        draw.text((x+w-cw-13, py+3), count, font=F_MONO_XS, fill=DIM2)
        py += 28

def draw_session_card(draw, x, y, w, sid, color, status, meta, indent=0, focused=False):
    bx = x + indent
    bw = w - indent
    rr(draw, [bx, y, bx+bw, y+64], 5, fill=BG3 if focused else BG2, outline=BORDER2 if focused else BORDER)
    if indent > 0:
        draw.line([(x+10, y-8),(x+10, y+32)], fill=BORDER2, width=1)
        draw.line([(x+10, y+32),(x+28, y+32)], fill=BORDER2, width=1)
    dot(draw, bx+16, y+20, 5, color)
    draw.text((bx+28, y+11), sid, font=F_MONO_XS, fill=TEXT)
    sw = txt_w(draw, sid, F_MONO_XS)
    draw.text((bx+28+sw+8, y+13), status, font=load("consola.ttf",11), fill=color)
    draw.text((bx+28, y+34), meta[:52], font=F_MONO_XS, fill=DIM)
    if indent == 0:
        rr(draw, [bx+bw-62, y+16, bx+bw-8, y+38], 3,
           fill=BLUE if focused else None, outline=BORDER2)
        draw.text((bx+bw-56, y+20), "focus",
                  font=F_MONO_XS, fill=BG if focused else DIM)

def draw_full_dashboard(draw, x, y, w, h, selected=1, highlighted=None):
    sb_w = 170
    draw_sidebar(draw, x, y, sb_w, h, selected)
    mx = x + sb_w + 8
    mw = w - sb_w - 8
    rr(draw, [mx, y, mx+mw, y+h], 6, fill=BG2, outline=BORDER)
    draw.text((mx+12, y+10), "2 sessions · 1 active", font=F_MONO_XS, fill=DIM2)
    sy = y + 36
    for i, (sid, color, status, meta) in enumerate(SESSIONS):
        indent = 20 if sid.startswith(" ") else 0
        draw_session_card(draw, mx+8, sy, mw-16, sid.strip(), color, status, meta, indent, highlighted==i)
        sy += 72 if not sid.startswith(" ") else 64

def draw_tab_chaos(draw, x, y, w, count=8):
    for i in range(count):
        ty = y + i * 38
        rr(draw, [x, ty, x+w, ty+30], 4, fill=BG3, outline=BORDER)
        dot(draw, x+16, ty+15, 5, DIM2)
        draw.text((x+28, ty+8), "Claude Code", font=F_MONO_XS, fill=DIM)
        draw.text((x+w-72, ty+8), "which?", font=F_MONO_XS, fill=YELLOW)

def draw_terminal(draw, x, y, w, h, lines):
    rr(draw, [x, y, x+w, y+h], 6, fill=BG2, outline=BORDER)
    rr(draw, [x, y, x+w, y+32], 4, fill=BG3, outline=None)
    dot(draw, x+16, y+16, 5, RED)
    dot(draw, x+32, y+16, 5, YELLOW)
    dot(draw, x+48, y+16, 5, GREEN)
    draw.text((x+68, y+9), "Windows Terminal", font=F_MONO_XS, fill=DIM2)
    ly = y + 42
    for line in lines:
        color = line[1] if isinstance(line, tuple) else TEXT
        text  = line[0] if isinstance(line, tuple) else line
        draw.text((x+14, ly), text, font=F_MONO_SM, fill=color)
        ly += 24

def save_gif(frames_ms, path, colors=96):
    imgs = [f for f, _ in frames_ms]
    durs = [d for _, d in frames_ms]
    q = [im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT) for im in imgs]
    q[0].save(path, save_all=True, append_images=q[1:],
              duration=durs, loop=0, optimize=True)
    kb = os.path.getsize(path) // 1024
    if kb > 500:
        q2 = [im.quantize(colors=64, method=Image.Quantize.MEDIANCUT) for im in imgs]
        q2[0].save(path, save_all=True, append_images=q2[1:],
                   duration=durs, loop=0, optimize=True)
        kb = os.path.getsize(path) // 1024
    print(f"  {os.path.basename(path):42s} {kb:4d} KB")

# ═══════════════════════════════════════════════════════════════════════════════
# LINKEDIN  1200×628
# ═══════════════════════════════════════════════════════════════════════════════
LW, LH = 1200, 628

def make_li_technical():
    frames = []
    # F1 — hook events
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH)
    draw.text((60, 55), "Claude Code fires hooks on every action", font=F_UI_LG, fill=TEXT)
    hooks = [("SessionStart", BLUE, 60, 140), ("PreToolUse", GREEN, 380, 140),
             ("PostToolUse", GREEN, 700, 140), ("Stop", YELLOW, 60, 240), ("Notification", PURPLE, 380, 240)]
    for label, color, hx, hy in hooks:
        rr(draw, [hx, hy, hx+280, hy+52], 8, fill=BG3, outline=color)
        dot(draw, hx+20, hy+26, 5, color)
        draw.text((hx+34, hy+15), label, font=F_MONO_MD, fill=color)
    draw.text((60, 345), "By default → output goes to stdout. Nothing persists.", font=F_UI_MD, fill=DIM)
    draw.text((60, 382), "claudeSession intercepts each one.", font=F_UI_MD, fill=BLUE)
    logo_tag(draw, LW, LH)
    frames.append((img, 2200))

    # F2 — pipeline
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, GREEN)
    draw.text((60, 50), "hooks → session-hook.js → WebSocket → Dashboard", font=F_MONO_MD, fill=GREEN)
    nodes = [("hooks", BLUE, 60), ("hook.js", GREEN, 280), ("Express", YELLOW, 500),
             ("WebSocket", PURPLE, 720), ("React UI", BLUE, 940)]
    ny = 200
    for label, color, nx in nodes:
        rr(draw, [nx, ny, nx+170, ny+56], 8, fill=BG3, outline=color)
        draw.text((nx+14, ny+16), label, font=F_MONO_MD, fill=color)
    for i in range(len(nodes)-1):
        ax = nodes[i][2]+170
        draw.line([(ax+4, ny+28),(nodes[i+1][2]-6, ny+28)], fill=BORDER2, width=2)
        draw.polygon([(nodes[i+1][2]-6, ny+23),(nodes[i+1][2]+6, ny+28),(nodes[i+1][2]-6, ny+33)], fill=BORDER2)
    draw.text((60, 320), "Sessions grouped by cwd  ·  parent-child from session_id chain", font=F_UI_MD, fill=DIM)
    rr(draw, [60, 390, 820, 450], 8, fill=BG2, outline=BORDER)
    draw.text((78, 408), 'cwd: "/projects/recoverer"  →  project: "recoverer"  →  sidebar entry', font=F_MONO_SM, fill=DIM)
    logo_tag(draw, LW, LH)
    frames.append((img, 2200))

    # F3 — live dashboard
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH)
    draw.text((60, 35), "Dashboard updates in milliseconds", font=F_UI_LG, fill=TEXT)
    draw_full_dashboard(draw, 60, 100, LW-120, LH-155)
    dot(draw, LW-110, 118, 7, GREEN)
    draw.text((LW-98, 111), "live", font=F_MONO_XS, fill=GREEN)
    logo_tag(draw, LW, LH)
    frames.append((img, 2500))
    frames.append((frames[0][0], 800))
    save_gif(frames, os.path.join(OUT_DIR, "linkedin-technical.gif"))

def make_li_eli5():
    frames = []
    # F1 — chaos
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, YELLOW)
    draw.text((60, 38), "15 Claude Code sessions open.", font=F_UI_LG, fill=TEXT)
    draw.text((60, 80), "None of them have names.", font=F_UI_LG, fill=YELLOW)
    draw_tab_chaos(draw, 60, 152, 500, count=8)
    draw.text((620, 190), "Which project?", font=F_UI_LG, fill=YELLOW)
    draw.text((620, 236), "Working or crashed?", font=F_UI_LG, fill=YELLOW)
    draw.text((620, 282), "Root or subagent?", font=F_UI_LG, fill=YELLOW)
    draw.text((620, 360), "You click around hoping", font=F_UI_MD, fill=DIM)
    draw.text((620, 390), "to find the right one.", font=F_UI_MD, fill=DIM)
    logo_tag(draw, LW, LH)
    frames.append((img, 2000))

    # F1b — wipe
    img, draw = new_frame(LW, LH)
    draw.rectangle([0,0,LW,LH], fill=(14,20,28))
    draw.text((LW//2-30, LH//2-30), "→", font=F_MONO_XL, fill=BLUE)
    frames.append((img, 400))

    # F2 — solution
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, GREEN)
    draw.text((60, 32), "Now you know.", font=F_UI_XL, fill=GREEN)
    draw_full_dashboard(draw, 60, 96, LW-120, LH-150)
    logo_tag(draw, LW, LH)
    frames.append((img, 3000))
    frames.append((frames[0][0], 800))
    save_gif(frames, os.path.join(OUT_DIR, "linkedin-eli5.gif"))

def make_li_why():
    frames = []
    # F1 — wrong session
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, DIM)
    draw.text((60, 40), "I clicked into a terminal.", font=F_UI_LG, fill=TEXT)
    draw.text((60, 80), "Started reviewing. Gave feedback. Approved.", font=F_UI_MD, fill=DIM)
    draw_terminal(draw, 60, 140, LW//2-80, 310, [
        ("$ claude --resume", DIM),
        ("", TEXT),
        ("> Reviewing authentication changes", TEXT),
        ("> The approach looks solid.", TEXT),
        ("> Use a refresh token here.", TEXT),
        ("> Approved. Proceed.", GREEN),
        ("  ... 6 minutes of feedback ...", DIM),
    ])
    rr(draw, [LW//2+40, 140, LW-60, 450], 8, fill=BG2, outline=BORDER)
    draw.text((LW//2+60, 162), "Session:", font=F_MONO_XS, fill=DIM2)
    draw.text((LW//2+60, 184), "e77c99d5", font=F_MONO_MD, fill=TEXT)
    draw.text((LW//2+60, 232), "Project:", font=F_MONO_XS, fill=DIM2)
    draw.text((LW//2+60, 254), "???", font=F_MONO_LG, fill=YELLOW)
    draw.text((LW//2+60, 320), "Status:", font=F_MONO_XS, fill=DIM2)
    draw.text((LW//2+60, 342), "working", font=F_MONO_MD, fill=BLUE)
    logo_tag(draw, LW, LH)
    frames.append((img, 2200))

    # F2 — wrong session flash
    img, draw = new_frame(LW, LH)
    draw.rectangle([0,0,LW,LH], fill=(20,6,6))
    rr(draw, [LW//2-300, LH//2-80, LW//2+300, LH//2+80], 12, fill=(40,8,8), outline=RED)
    draw.text((LW//2-230, LH//2-60), "WRONG SESSION", font=F_MONO_LG, fill=RED)
    draw.text((LW//2-260, LH//2+10), "proceeding on the payment service", font=F_UI_MD, fill=(200,80,80))
    logo_tag(draw, LW, LH)
    frames.append((img, 1800))

    # F3 — dashboard
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, GREEN)
    draw.text((60, 32), "Built claudeSession that weekend.", font=F_UI_LG, fill=TEXT)
    draw.text((60, 74), "Every session now has a name, a project, a status.", font=F_UI_MD, fill=DIM)
    draw_full_dashboard(draw, 60, 126, LW-120, LH-188)
    logo_tag(draw, LW, LH)
    frames.append((img, 2500))
    frames.append((frames[0][0], 800))
    save_gif(frames, os.path.join(OUT_DIR, "linkedin-why-built.gif"))

def make_li_unique():
    frames = []
    mid = LW // 2

    # F1 — identity vs metrics
    img, draw = new_frame(LW, LH)
    draw.line([(mid, 30),(mid, LH-30)], fill=BORDER2)
    draw.text((80, 44), "Other Claude tools", font=F_UI_LG, fill=DIM2)
    draw.text((mid+40, 44), "claudeSession", font=F_UI_LG, fill=BLUE)
    for i, item in enumerate(["Token count", "Cost tracker", "Output logs", "Latency metrics"]):
        rr(draw, [80, 118+i*76, mid-60, 172+i*76], 6, fill=BG3, outline=BORDER)
        draw.text((100, 134+i*76), item, font=F_UI_LG, fill=DIM2)
    for i, (item, color) in enumerate([("Which session is which", BLUE), ("Who spawned whom", PURPLE), ("Which ones crashed", RED), ("One-click tab focus", GREEN)]):
        rr(draw, [mid+40, 118+i*76, LW-60, 172+i*76], 6, fill=BG3, outline=color)
        dot(draw, mid+60, 145+i*76, 5, color)
        draw.text((mid+76, 134+i*76), item, font=F_UI_LG, fill=TEXT)
    logo_tag(draw, LW, LH)
    frames.append((img, 2500))

    # F2 — hook-native speed
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, BLUE)
    draw.text((60, 42), "Hook-native. Not polling.", font=F_UI_XL, fill=TEXT)
    draw.text((60, 100), "Status updates fire the moment Claude acts — not on a timer.", font=F_UI_MD, fill=DIM)
    for i, (label, color, latency) in enumerate([
        ("Polling (2s interval)", DIM2, "up to 2000ms lag"),
        ("File watching",         DIM2, "up to 500ms lag"),
        ("claudeSession hooks",   BLUE, "< 50ms"),
    ]):
        ry = 195 + i*92
        rr(draw, [60, ry, 860, ry+68], 8, fill=BG3 if color==BLUE else BG2, outline=color if color==BLUE else BORDER)
        draw.text((80, ry+20), label, font=F_MONO_MD, fill=color)
        draw.text((600, ry+20), latency, font=F_MONO_MD, fill=color if color==BLUE else DIM2)
    logo_tag(draw, LW, LH)
    frames.append((img, 2000))

    # F3 — tab focus
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, GREEN)
    draw.text((60, 40), "Focus actually switches the tab.", font=F_UI_XL, fill=TEXT)
    draw.text((60, 96), "PowerShell UI Automation. Not 'here is the PID, good luck.'", font=F_UI_MD, fill=DIM)
    draw_full_dashboard(draw, 60, 158, 560, LH-220, highlighted=0)
    # arrow
    ax1, ax2, ay = 648, 750, LH//2
    draw.line([(ax1, ay),(ax2, ay)], fill=BLUE, width=3)
    draw.polygon([(ax2-8, ay-6),(ax2+4, ay),(ax2-8, ay+6)], fill=BLUE)
    draw_terminal(draw, 780, 158, LW-840, 280, [
        ("$ claude --resume e77c99d5", DIM),
        ("", TEXT),
        ("Resuming session...", GREEN),
        ("Project: recoverer", BLUE),
    ])
    draw.text((780, 460), "Right terminal. First click.", font=F_UI_LG, fill=GREEN)
    logo_tag(draw, LW, LH)
    frames.append((img, 2500))
    frames.append((frames[0][0], 800))
    save_gif(frames, os.path.join(OUT_DIR, "linkedin-unique.gif"))

def make_li_story():
    frames = []
    # F1 — pwd habit
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, DIM)
    draw.text((60, 42), "About two months in, I noticed a habit.", font=F_UI_LG, fill=TEXT)
    draw.text((60, 84), "I'd run pwd to figure out which session I was in.", font=F_UI_MD, fill=DIM)
    draw_terminal(draw, 60, 148, 680, 260, [
        ("$ pwd", DIM),
        ("/c/Users/ibrahim/projects/recoverer", YELLOW),
        ("", TEXT),
        ("$ git log --oneline -3", DIM),
        ("a3f2c1e  fix: rust parser edge case", DIM),
        ("# wait. this isn't auth.", YELLOW),
    ])
    draw.text((800, 200), "Two minutes", font=F_UI_LG, fill=YELLOW)
    draw.text((800, 240), "wasted per", font=F_UI_LG, fill=YELLOW)
    draw.text((800, 280), "context switch.", font=F_UI_LG, fill=YELLOW)
    draw.text((800, 360), "Every. Single. Time.", font=F_UI_MD, fill=DIM)
    logo_tag(draw, LW, LH)
    frames.append((img, 2200))

    # F2 — breaking point
    img, draw = new_frame(LW, LH)
    draw.rectangle([0,0,LW,LH], fill=(10,6,6))
    accent_bar(draw, LH, RED)
    draw.text((60, 50), "Then came the breaking point.", font=F_UI_LG, fill=TEXT)
    rr(draw, [60, 122, LW-60, 390], 8, fill=(20,8,8), outline=RED)
    for i, (line, color) in enumerate([
        ("I clicked into a terminal. Saw a question waiting.", TEXT),
        ("Answered it. In detail. Approved the approach.", TEXT),
        ("Told it to proceed.", TEXT),
        ("", DIM),
        ("Three minutes later: wrong session.", RED),
        ("It had just rewritten the payment service.", RED),
    ]):
        draw.text((80, 146+i*34), line, font=F_UI_SM, fill=color)
    logo_tag(draw, LW, LH)
    frames.append((img, 2200))

    # F3 — resolution
    img, draw = new_frame(LW, LH)
    accent_bar(draw, LH, GREEN)
    draw.text((60, 32), "Spent the weekend wiring it up.", font=F_UI_LG, fill=TEXT)
    draw.text((60, 74), "Now I open the dashboard before I open anything else.", font=F_UI_MD, fill=DIM)
    draw_full_dashboard(draw, 60, 126, LW-120, LH-195)
    lx = 80
    for label, color in [("working", BLUE), ("waiting", YELLOW), ("done", GREEN), ("crashed", RED)]:
        dot(draw, lx+7, LH-44, 5, color)
        draw.text((lx+18, LH-52), label, font=F_MONO_XS, fill=color)
        lx += 108
    logo_tag(draw, LW, LH)
    frames.append((img, 3000))
    frames.append((frames[0][0], 800))
    save_gif(frames, os.path.join(OUT_DIR, "linkedin-story.gif"))

# ═══════════════════════════════════════════════════════════════════════════════
# TWITTER  1200×675
# ═══════════════════════════════════════════════════════════════════════════════
TW, TH = 1200, 675

def make_tw_technical():
    frames = []
    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH)
    draw.text((60, 50), "hook fires →", font=F_MONO_LG, fill=BLUE)
    rr(draw, [60, 120, 580, 182], 8, fill=BG3, outline=BLUE)
    draw.text((82, 138), 'SessionStart  {cwd: "/projects/recoverer", session_id: "82a2"}', font=F_MONO_SM, fill=BLUE)
    logo_tag(draw, TW, TH)
    frames.append((img, 900))

    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH, GREEN)
    draw.text((60, 50), "session-hook.js → WebSocket", font=F_MONO_LG, fill=GREEN)
    nodes = [("hook", BLUE, 60), ("hook.js", GREEN, 240), ("WebSocket", YELLOW, 460), ("React UI", PURPLE, 680)]
    for label, color, nx in nodes:
        rr(draw, [nx, 130, nx+150, 186], 6, fill=BG3, outline=color)
        draw.text((nx+12, 147), label, font=F_MONO_MD, fill=color)
    for i in range(len(nodes)-1):
        ax = nodes[i][2]+150
        draw.line([(ax+4,158),(nodes[i+1][2]-6,158)], fill=BORDER2, width=2)
        draw.polygon([(nodes[i+1][2]-6,153),(nodes[i+1][2]+6,158),(nodes[i+1][2]-6,163)], fill=BORDER2)
    logo_tag(draw, TW, TH)
    frames.append((img, 900))

    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH)
    draw.text((60, 38), "Dashboard updates live", font=F_UI_XL, fill=TEXT)
    draw_full_dashboard(draw, 60, 108, TW-120, TH-175)
    dot(draw, TW-100, 120, 6, GREEN)
    logo_tag(draw, TW, TH)
    frames.append((img, 1600))
    frames.append((frames[0][0], 600))
    save_gif(frames, os.path.join(OUT_DIR, "twitter-technical.gif"))

def make_tw_eli5():
    frames = []
    mid = TW // 2

    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH, YELLOW)
    draw.text((60, 40), "BEFORE", font=F_MONO_MD, fill=DIM2)
    draw_tab_chaos(draw, 60, 88, mid-80, count=8)
    draw.line([(mid, 35),(mid, TH-35)], fill=BORDER2)
    draw.text((mid+30, 40), "AFTER", font=F_MONO_MD, fill=GREEN)
    draw.text((mid+30, 110), "No project names.", font=F_UI_LG, fill=DIM2)
    draw.text((mid+30, 150), "No status.", font=F_UI_LG, fill=DIM2)
    draw.text((mid+30, 190), "Just question marks.", font=F_UI_LG, fill=YELLOW)
    logo_tag(draw, TW, TH)
    frames.append((img, 1200))

    img, draw = new_frame(TW, TH)
    draw.rectangle([0,0,TW,TH], fill=(12,18,24))
    frames.append((img, 250))

    img, draw = new_frame(TW, TH)
    draw.text((60, 40), "BEFORE", font=F_MONO_MD, fill=DIM2)
    draw_tab_chaos(draw, 60, 88, mid-80, count=8)
    draw.line([(mid, 35),(mid, TH-35)], fill=BORDER2)
    draw.text((mid+30, 40), "AFTER", font=F_MONO_MD, fill=GREEN)
    draw_full_dashboard(draw, mid+28, 84, TW-mid-56, TH-148)
    logo_tag(draw, TW, TH)
    frames.append((img, 2200))
    frames.append((frames[0][0], 600))
    save_gif(frames, os.path.join(OUT_DIR, "twitter-eli5.gif"))

def make_tw_why():
    frames = []
    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH, DIM)
    rr(draw, [TW//2-280, TH//2-110, TW//2+280, TH//2+50], 12, fill=BG3, outline=BORDER)
    draw.text((TW//2-220, TH//2-88), '> "looks good, proceed"', font=F_MONO_MD, fill=GREEN)
    draw.text((TW//2-260, TH//2-40), "6 minutes of detailed feedback", font=F_UI_MD, fill=DIM)
    draw.text((TW//2-200, TH//2+4), "session: e77c99d5", font=F_MONO_SM, fill=DIM2)
    logo_tag(draw, TW, TH)
    frames.append((img, 1200))

    img, draw = new_frame(TW, TH)
    draw.rectangle([0,0,TW,TH], fill=(18,5,5))
    rr(draw, [TW//2-300, TH//2-100, TW//2+300, TH//2+100], 12, fill=(30,6,6), outline=RED)
    draw.text((TW//2-218, TH//2-72), "WRONG SESSION", font=F_MONO_LG, fill=RED)
    draw.text((TW//2-266, TH//2+2), "it proceeded on the payment service", font=F_UI_MD, fill=(200,70,70))
    logo_tag(draw, TW, TH)
    frames.append((img, 1300))

    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH, GREEN)
    draw.text((60, 36), "Built claudeSession that weekend.", font=F_UI_LG, fill=TEXT)
    draw_full_dashboard(draw, 60, 104, TW-120, TH-172)
    logo_tag(draw, TW, TH)
    frames.append((img, 2000))
    frames.append((frames[0][0], 600))
    save_gif(frames, os.path.join(OUT_DIR, "twitter-why-built.gif"))

def make_tw_unique():
    frames = []
    mid = TW // 2

    img, draw = new_frame(TW, TH)
    draw.line([(mid, 30),(mid, TH-30)], fill=BORDER2)
    draw.text((80, 46), "Other tools track", font=F_UI_LG, fill=DIM2)
    for i, item in enumerate(["tokens", "cost", "logs"]):
        rr(draw, [80, 120+i*86, mid-60, 178+i*86], 6, fill=BG3, outline=BORDER)
        draw.text((100, 138+i*86), item, font=F_UI_XL, fill=DIM2)
    draw.text((mid+40, 46), "claudeSession tracks", font=F_UI_LG, fill=BLUE)
    for i, (item, color) in enumerate([("who", BLUE), ("what", GREEN), ("where", PURPLE)]):
        rr(draw, [mid+40, 120+i*86, TW-60, 178+i*86], 6, fill=BG3, outline=color)
        draw.text((mid+62, 138+i*86), item, font=F_UI_XL, fill=color)
    logo_tag(draw, TW, TH)
    frames.append((img, 1800))

    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH, GREEN)
    draw.text((60, 36), "Click Focus → right terminal", font=F_UI_XL, fill=TEXT)
    draw.text((60, 90), "PowerShell UI Automation. Works every time.", font=F_UI_MD, fill=DIM)
    draw_full_dashboard(draw, 60, 160, TW-120, TH-230, highlighted=0)
    logo_tag(draw, TW, TH)
    frames.append((img, 2000))
    frames.append((frames[0][0], 600))
    save_gif(frames, os.path.join(OUT_DIR, "twitter-unique.gif"))

def make_tw_story():
    frames = []
    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH, DIM)
    draw_terminal(draw, 60, 56, 640, 290, [
        ("$ pwd", DIM),
        ("/c/Users/ibrahim/projects/recoverer", YELLOW),
        ("", TEXT),
        ("$ git log --oneline -2", DIM),
        ("a3f2c1e  fix: rust parser edge case", DIM),
        ("# wait. this is the wrong project.", YELLOW),
    ])
    draw.text((740, 80), "Running pwd to figure", font=F_UI_LG, fill=TEXT)
    draw.text((740, 120), "out which Claude", font=F_UI_LG, fill=TEXT)
    draw.text((740, 160), "session I was in.", font=F_UI_LG, fill=TEXT)
    draw.text((740, 240), "That's a tooling problem.", font=F_UI_MD, fill=YELLOW)
    logo_tag(draw, TW, TH)
    frames.append((img, 1500))

    img, draw = new_frame(TW, TH)
    draw.rectangle([0,0,TW,TH], fill=(8,12,20))
    draw.text((TW//2-220, TH//2-30), "That's when I knew.", font=F_UI_XL, fill=TEXT)
    logo_tag(draw, TW, TH)
    frames.append((img, 1000))

    img, draw = new_frame(TW, TH)
    accent_bar(draw, TH)
    draw_full_dashboard(draw, 60, 56, TW-120, TH-130)
    draw.text((60, TH-60), "claudesession.whhite.com", font=F_MONO_SM, fill=BLUE)
    logo_tag(draw, TW, TH)
    frames.append((img, 2000))
    frames.append((frames[0][0], 600))
    save_gif(frames, os.path.join(OUT_DIR, "twitter-story.gif"))

# ── Run ───────────────────────────────────────────────────────────────────────
print("Generating promotional GIFs...")
make_li_technical()
make_li_eli5()
make_li_why()
make_li_unique()
make_li_story()
make_tw_technical()
make_tw_eli5()
make_tw_why()
make_tw_unique()
make_tw_story()
print("Done.")
