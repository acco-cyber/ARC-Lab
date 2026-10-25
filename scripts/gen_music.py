#!/usr/bin/env python3
"""ARC Lab — minimal electronic bed for the 15s demo (44.1kHz stereo WAV)."""
import numpy as np
import wave

SR = 44100
BPM = 126.0
BEAT = 60.0 / BPM            # 0.476s
DUR = 15.2
N = int(SR * DUR)
t_all = np.arange(N) / SR
mix = np.zeros(N)

def add(sig, at):
    i = int(at * SR)
    j = min(N, i + len(sig))
    if i < N:
        mix[i:j] += sig[: j - i]

# ── kick: pitch-dropping sine, every beat ────────────────────────────────────
kd = int(0.16 * SR)
tk = np.arange(kd) / SR
freq = 52 + 150 * np.exp(-tk * 26)
phase = 2 * np.pi * np.cumsum(freq) / SR
kick = np.sin(phase) * np.exp(-tk * 15) * 0.52
beat_i = 0
while beat_i * BEAT < DUR - 0.2:
    add(kick, beat_i * BEAT)
    beat_i += 1

# ── hat: short filtered noise on off-beats ───────────────────────────────────
hd = int(0.05 * SR)
th = np.arange(hd) / SR
rng = np.random.default_rng(7)
noise = rng.standard_normal(hd)
noise = np.diff(noise, prepend=0)  # crude high-pass
hat = noise / (np.max(np.abs(noise)) + 1e-9) * np.exp(-th * 90) * 0.12
off = 0
while (off + 0.5) * BEAT < DUR - 0.2:
    add(hat, (off + 0.5) * BEAT)
    off += 1

# ── bass: soft triangle eighths, A minor pentatonic ──────────────────────────
A1, C2, D2, E2 = 55.0, 65.41, 73.42, 82.41
pattern = [A1, None, A1, None, C2, None, E2, D2]
eighth = BEAT / 2
nd = int(eighth * 0.92 * SR)
tn = np.arange(nd) / SR
tri = (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * np.ones(nd)))  # placeholder

step = 0
while step * eighth < DUR - 0.3:
    f = pattern[step % len(pattern)]
    if f:
        tn = np.arange(nd) / SR
        wave_ = (2 / np.pi) * np.arcsin(np.sin(2 * np.pi * f * tn))
        env = np.minimum(1, tn * 220) * np.exp(-tn * 7)
        add(wave_ * env * 0.16, step * eighth)
    step += 1

# ── master: normalize, fades ─────────────────────────────────────────────────
mix = mix / (np.max(np.abs(mix)) + 1e-9) * 0.55
fade_in = int(0.12 * SR)
fade_out = int(1.3 * SR)
mix[:fade_in] *= np.linspace(0, 1, fade_in)
mix[-fade_out:] *= np.linspace(1, 0, fade_out)

stereo = np.stack([mix, mix], axis=1)
pcm = (np.clip(stereo, -1, 1) * 32767).astype(np.int16)
with wave.open("/home/z/my-project/media-tmp/music.wav", "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("music.wav written:", DUR, "s")
