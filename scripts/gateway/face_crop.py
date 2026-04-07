#!/usr/bin/env python3
import argparse
import sys

import cv2
from PIL import Image

RESAMPLING = getattr(Image, "Resampling", Image)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def build_square_crop_bounds(width: int, height: int, x1: float, y1: float, x2: float, y2: float, padding: float):
    box_width = max(1.0, x2 - x1)
    box_height = max(1.0, y2 - y1)
    center_x = (x1 + x2) / 2.0
    center_y = (y1 + y2) / 2.0
    side = max(box_width, box_height) * (1.0 + padding * 2.0)
    side = min(side, float(max(width, height)))
    half = side / 2.0

    left = center_x - half
    top = center_y - half
    right = center_x + half
    bottom = center_y + half

    if left < 0:
        right -= left
        left = 0
    if top < 0:
        bottom -= top
        top = 0
    if right > width:
        left -= right - width
        right = width
    if bottom > height:
        top -= bottom - height
        bottom = height

    left = clamp(left, 0, width)
    top = clamp(top, 0, height)
    right = clamp(right, left + 1, width)
    bottom = clamp(bottom, top + 1, height)
    return (left, top, right, bottom)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--media-type", choices=["image", "video"], default="image")
    parser.add_argument("--frame-ts-ms", type=int, default=None)
    parser.add_argument("--x1", type=float, required=True)
    parser.add_argument("--y1", type=float, required=True)
    parser.add_argument("--x2", type=float, required=True)
    parser.add_argument("--y2", type=float, required=True)
    parser.add_argument("--size", type=int, default=160)
    parser.add_argument("--padding", type=float, default=0.35)
    args = parser.parse_args()

    if args.media_type == "video":
        capture = cv2.VideoCapture(args.input)
        if not capture.isOpened():
            raise RuntimeError(f"failed to open video: {args.input}")
        try:
            target_ts_ms = max(0, int(args.frame_ts_ms or 0))
            capture.set(cv2.CAP_PROP_POS_MSEC, float(target_ts_ms))
            ok, frame = capture.read()
            if (not ok or frame is None) and (capture.get(cv2.CAP_PROP_FPS) or 0) > 0:
                fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
                frame_index = max(0, int(round((target_ts_ms / 1000.0) * fps)))
                capture.set(cv2.CAP_PROP_POS_FRAMES, float(frame_index))
                ok, frame = capture.read()
            if not ok or frame is None:
                raise RuntimeError(f"failed to read video frame: {args.input}")
            image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        finally:
            capture.release()
    else:
        image = Image.open(args.input).convert("RGB")

    width, height = image.size

    bounds = build_square_crop_bounds(
        width,
        height,
        args.x1,
        args.y1,
        args.x2,
        args.y2,
        max(0.0, args.padding),
    )
    cropped = image.crop(bounds).resize((max(1, args.size), max(1, args.size)), RESAMPLING.LANCZOS)
    cropped.save(sys.stdout.buffer, format="JPEG", quality=90, optimize=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
