#!/usr/bin/env python3
"""ARC Lab — assemble the final 10-15s demo video from the raw take.

Cut list (raw webm timeline), speed ramps, scene labels, end card, music.
Output: media-tmp/arc-lab-demo.mp4 (1280x720, 30fps, H.264+AAC, faststart).
"""
import os
import subprocess

TMP = "/home/z/my-project/media-tmp"
RAW = f"{TMP}/76fabfd10443f890c0945cd2c54aa9a3.webm"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

# (id, start, end, speed, label or None, hook)
CUTS = [
    ("a",  1.00,  2.85, 1.67, None,                              "You vs AI — same puzzle."),
    ("b",  3.90,  7.50, 3.00, "1 · SOLVE IT YOURSELF",           None),
    ("c1", 7.50, 12.20, 2.90, "1 · SOLVE IT YOURSELF",           None),
    ("c2",12.20, 14.50, 1.15, "1 · SOLVE IT YOURSELF",           None),
    ("d", 16.20, 19.60, 3.00, "2 · BUILD THE RULE",              None),
    ("e", 20.90, 23.30, 3.00, "2 · BUILD THE RULE",              None),
    ("f", 25.40, 30.30, 3.60, "3 · WATCH AI ATTEMPT IT",         None),
    ("g", 30.30, 34.80, 2.20, "3 · WATCH AI ATTEMPT IT",         None),
    ("h", 36.10, 41.25, 2.60, "4 · COMPARE & BENCHMARK",         None),
]
ENDCARD_DUR = 1.30

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"FFMPEG FAILED ({' '.join(cmd[:6])}…):\n{r.stderr[-1800:]}")

def label_file(name, text):
    p = f"{TMP}/{name}.txt"
    with open(p, "w") as f:
        f.write(text)
    return p

segs = []
total = 0.0
for sid, start, end, speed, label, hook in CUTS:
    dur = (end - start) / speed
    total += dur
    vf = [
        f"setpts=PTS/{speed}",
        "scale=1280:720:flags=lanczos",
        "fps=30",
    ]
    if label:
        lp = label_file(f"label_{sid}", label)
        vf.append(
            f"drawtext=fontfile={FONT}:textfile={lp}:fontsize=38:fontcolor=white:"
            "x=44:y=34:box=1:boxcolor=0x000000@0.55:boxborderw=14"
        )
    if hook:
        lp = label_file(f"hook_{sid}", hook)
        vf.append(
            f"drawtext=fontfile={FONT}:textfile={lp}:fontsize=44:fontcolor=white:"
            "x=(w-text_w)/2:y=26:box=1:boxcolor=0x000000@0.6:boxborderw=16"
        )
    # watermark on every scene
    vf.append(
        f"drawtext=fontfile={FONT}:text='ARC Lab':fontsize=21:fontcolor=white@0.72:"
        "x=w-text_w-32:y=h-text_h-24:box=1:boxcolor=0x000000@0.35:boxborderw=10"
    )
    out = f"{TMP}/seg_{sid}.mp4"
    run([
        "ffmpeg", "-y", "-v", "error", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}",
        "-i", RAW,
        "-vf", ",".join(vf),
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-pix_fmt", "yuv420p",
        out,
    ])
    segs.append(out)
    print(f"seg {sid}: {start:.2f}-{end:.2f} @{speed}x -> {dur:.3f}s")

# ── end card ─────────────────────────────────────────────────────────────────
run([
    "ffmpeg", "-y", "-v", "error",
    "-loop", "1", "-t", f"{ENDCARD_DUR}", "-i", f"{TMP}/endcard.png",
    "-vf", ("scale=1280:720,fps=30,"
            "fade=t=in:st=0:d=0.22,fade=t=out:st=1.02:d=0.28,format=yuv420p"),
    "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "19",
    f"{TMP}/seg_z.mp4",
])
segs.append(f"{TMP}/seg_z.mp4")
total += ENDCARD_DUR
print(f"end card: {ENDCARD_DUR}s")

with open(f"{TMP}/concat.txt", "w") as f:
    for s in segs:
        f.write(f"file '{s}'\n")

run([
    "ffmpeg", "-y", "-v", "error",
    "-f", "concat", "-safe", "0", "-i", f"{TMP}/concat.txt",
    "-i", f"{TMP}/music.wav",
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
    "-shortest", "-movflags", "+faststart",
    f"{TMP}/arc-lab-demo.mp4",
])
print(f"TOTAL {total:.2f}s -> {TMP}/arc-lab-demo.mp4")
