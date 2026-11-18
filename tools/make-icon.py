from PIL import Image, ImageDraw, ImageFilter

S = 1024
SS = 2
W = S * SS
img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# ---- background squircle with a deep, luminous gradient ----
bg = Image.new("RGBA", (W, W), (0, 0, 0, 0))
bd = ImageDraw.Draw(bg)
for y in range(W):
    t = y / (W - 1)
    r = int(22 + 22 * t)
    g = int(30 + 38 * t)
    b = int(62 + 106 * t)
    bd.line([(0, y), (W, y)], fill=(r, g, b, 255))

# radial cool glow upper-right
glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W * 0.46, -W * 0.24, W * 1.28, W * 0.58], fill=(126, 214, 255, 105))
glow = glow.filter(ImageFilter.GaussianBlur(120 * SS))
bg = Image.alpha_composite(bg, glow)

# teal glow lower-left
glow2 = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd2 = ImageDraw.Draw(glow2)
gd2.ellipse([-W * 0.30, W * 0.53, W * 0.58, W * 1.28], fill=(70, 255, 208, 70))
glow2 = glow2.filter(ImageFilter.GaussianBlur(130 * SS))
bg = Image.alpha_composite(bg, glow2)

# squircle mask
mask = Image.new("L", (W, W), 0)
md = ImageDraw.Draw(mask)
pad = int(W * 0.06)
radius = int(W * 0.30)
md.rounded_rectangle([pad, pad, W - pad, W - pad], radius=radius, fill=255)
img = Image.alpha_composite(img, bg)
img.putalpha(mask)

# ---- inner glass slab ----
slab = Image.new("RGBA", (W, W), (0, 0, 0, 0))
sd = ImageDraw.Draw(slab)
m = int(W * 0.175)
slab_box = [m, int(W * 0.195), W - m, int(W * 0.805)]
sd.rounded_rectangle(slab_box, radius=int(W * 0.175), fill=(255, 255, 255, 38))
sd.rounded_rectangle(slab_box, radius=int(W * 0.175), outline=(255, 255, 255, 130), width=int(W * 0.007))
sd.rounded_rectangle(
    [slab_box[0] + 9 * SS, slab_box[1] + 9 * SS, slab_box[2] - 9 * SS, slab_box[3] - 9 * SS],
    radius=int(W * 0.169), outline=(255, 255, 255, 50), width=int(W * 0.0035),
)
img = Image.alpha_composite(img, slab)

# ---- four quadrant tiles ----
tiles = Image.new("RGBA", (W, W), (0, 0, 0, 0))
td = ImageDraw.Draw(tiles)
size = W * 0.170
gap = W * 0.032
start_x = W / 2 - size - gap / 2
start_y = W / 2 - size - gap / 2
tile_radius = int(size * 0.30)
colors = [(255, 126, 126, 242), (99, 215, 255, 242), (255, 196, 107, 242), (184, 167, 255, 242)]
for index, color in enumerate(colors):
    col = index % 2
    row = index // 2
    x = start_x + col * (size + gap)
    y = start_y + row * (size + gap)
    # soft glow behind each tile
    halo = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    hd.rounded_rectangle(
        [x - size * 0.12, y - size * 0.12, x + size * 1.12, y + size * 1.12],
        radius=int(size * 0.38), fill=(color[0], color[1], color[2], 90),
    )
    halo = halo.filter(ImageFilter.GaussianBlur(26 * SS))
    tiles = Image.alpha_composite(tiles, halo)
    td = ImageDraw.Draw(tiles)
    td.rounded_rectangle([x, y, x + size, y + size], radius=tile_radius, fill=color)

# top gloss must live on its own layer: ImageDraw writes RGBA values directly
# instead of blending them, so drawing translucent white on the tiles would
# punch transparent holes in them.
tile_gloss = Image.new("RGBA", (W, W), (0, 0, 0, 0))
tgd = ImageDraw.Draw(tile_gloss)
for index in range(4):
    col = index % 2
    row = index // 2
    x = start_x + col * (size + gap)
    y = start_y + row * (size + gap)
    tgd.rounded_rectangle(
        [x + size * 0.06, y + size * 0.05, x + size * 0.94, y + size * 0.44],
        radius=int(tile_radius * 0.7), fill=(255, 255, 255, 40),
    )
tiles = Image.alpha_composite(tiles, tile_gloss)

img = Image.alpha_composite(img, tiles)

# ---- check mark on the first tile ----
check = Image.new("RGBA", (W, W), (0, 0, 0, 0))
cd = ImageDraw.Draw(check)
cx = start_x + size * 0.5
cy = start_y + size * 0.53
w = int(W * 0.016)
cd.line(
    [(cx - size * 0.20, cy), (cx - size * 0.05, cy + size * 0.15), (cx + size * 0.22, cy - size * 0.17)],
    fill=(255, 255, 255, 245), width=w, joint="curve",
)
img = Image.alpha_composite(img, check)

# gloss streak across the slab
gloss = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gd3 = ImageDraw.Draw(gloss)
gd3.ellipse([-W * 0.12, -W * 0.28, W * 0.56, W * 0.36], fill=(255, 255, 255, 55))
gloss = gloss.filter(ImageFilter.GaussianBlur(72 * SS))
gloss.putalpha(Image.composite(gloss.getchannel("A"), Image.new("L", (W, W), 0), mask))
img = Image.alpha_composite(img, gloss)

# outer rim highlight
rim = Image.new("RGBA", (W, W), (0, 0, 0, 0))
rd = ImageDraw.Draw(rim)
rd.rounded_rectangle([pad, pad, W - pad, W - pad], radius=radius, outline=(255, 255, 255, 72), width=int(W * 0.007))
img = Image.alpha_composite(img, rim)

img = img.resize((S, S), Image.LANCZOS)
img.save("assets/icon.png")

sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
img.save("assets/icon.ico", sizes=[(s, s) for s in sizes])
print("wrote assets/icon.png and assets/icon.ico")
