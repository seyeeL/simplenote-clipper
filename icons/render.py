"""生成 16/48/128 PNG 图标。

不引 SVG 渲染库，直接用 Pillow 画，视觉和 source.svg 对齐：
Simplenote 蓝 #3361CC 圆角方底 + 白色「剪」字。

改图后跑一次（任意带 Pillow 的 python 都行）：
  python icons/render.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
BG = (51, 97, 204, 255)      # #3361CC，Simplenote 品牌蓝
FG = (255, 255, 255, 255)

# Windows / macOS 常见中文字体 fallback
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyhbd.ttc",   # 微软雅黑 Bold
    r"C:\Windows\Fonts\msyh.ttc",     # 微软雅黑
    r"C:\Windows\Fonts\simhei.ttf",   # 黑体
    "/System/Library/Fonts/PingFang.ttc",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def render(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = max(2, size // 5)
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=BG)

    font = load_font(int(size * 0.68))
    text = "剪"
    bbox = draw.textbbox((0, 0), text, font=font, anchor="lt")
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    # 居中，补偿 bbox 的原点偏移
    draw.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), text, font=font, fill=FG)
    return img


def main():
    for s in (16, 48, 128):
        out = HERE / f"{s}.png"
        render(s).save(out)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
