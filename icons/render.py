"""从官方图标源生成 16/48/128 PNG。

`source-256.png` 是 Simplenote 桌面客户端的应用图标，取自
https://github.com/Automattic/simplenote-electron
（resources/images/icon_256x256.png）。这里只做缩放，不改设计。

需要更新图标时重新下载 source-256.png 再跑一次（任意带 Pillow 的 python）：
  python icons/render.py
"""
from pathlib import Path

from PIL import Image

HERE = Path(__file__).parent
SOURCE = HERE / "source-256.png"
SIZES = (16, 48, 128)
# 源图四周有约 14px 留白和投影。工具栏图标只有 16px，留白会让白色圆盘
# 在浅色工具栏上几乎消失，所以先裁到实心部分。
SOLID_ALPHA = 200


def trim(img):
    solid = img.getchannel("A").point(lambda v: 255 if v > SOLID_ALPHA else 0)
    box = solid.getbbox()
    return img.crop(box) if box else img


def main():
    if not SOURCE.exists():
        raise SystemExit(f"缺少图标源 {SOURCE}")

    src = trim(Image.open(SOURCE).convert("RGBA"))
    for size in SIZES:
        out = HERE / f"{size}.png"
        src.resize((size, size), Image.LANCZOS).save(out)
        print(f"wrote {out}")


if __name__ == "__main__":
    main()
