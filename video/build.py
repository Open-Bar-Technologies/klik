"""Assemble la vidéo : images capturées par record.mjs + bande son des clics du métronome.

Les clics sont resynthétisés avec les mêmes réglages que js/engine.js (bloc de bois :
triangle filtré, attaque de 3 ms, légère chute de hauteur), à l'instant exact où l'app
les a joués. Les clics joués en mode muet sont ignorés.
Usage : python3 video/build.py  →  video/klik-presentation.mp4
"""
import json
import subprocess
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).parent
OUT = HERE / 'out'
RATE = 48000
# Décalage du son : l'image capturée arrive un peu après l'instant planifié du clic.
AV_OFFSET = 0.07
TONES = {3: (740, 0.75, 0.12), 2: (1180, 0.45, 0.07), 1: (1180, 0.18, 0.05)}


def lowpass(x, fc=2600, q=0.7):
    # Biquad passe-bas (RBJ), comme le BiquadFilterNode de l'app.
    w = 2 * np.pi * fc / RATE
    a = np.sin(w) / (2 * q)
    b0, b1, b2 = (1 - np.cos(w)) / 2, 1 - np.cos(w), (1 - np.cos(w)) / 2
    a0, a1, a2 = 1 + a, -2 * np.cos(w), 1 - a
    b0, b1, b2, a1, a2 = b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, v, y1, out
        y[i] = out
    return y


def blip(lvl):
    freq, vol, length = TONES[lvl]
    n = int((length + 0.01) * RATE)
    t = np.arange(n) / RATE
    f = np.where(t < 0.012, freq * 1.25 * (1 / 1.25) ** (t / 0.012), freq)
    phase = np.cumsum(f) / RATE
    tri = 2 * np.abs(2 * (phase - np.floor(phase + 0.5))) - 1
    env = np.where(t < 0.003, 0.0001 * (vol / 0.0001) ** (t / 0.003),
                   vol * (0.0001 / vol) ** np.clip((t - 0.003) / (length - 0.003), 0, 1))
    return lowpass(tri * env)


def main():
    meta = json.loads((OUT / 'hits.json').read_text())
    dur = (meta['end'] - meta['start']) / 1000 + 1
    track = np.zeros(int(dur * RATE))
    sounds = {lvl: blip(lvl) for lvl in TONES}
    played = 0
    for h in meta['hits']:
        if h['muted']:
            continue
        i = int(((h['t'] - meta['start']) / 1000 + AV_OFFSET) * RATE)
        if i < 0:
            continue
        s = sounds[h['lvl']]
        track[i:i + len(s)] += s[:len(track) - i]
        played += 1
    track = np.clip(track * 0.9, -1, 1)
    with wave.open(str(OUT / 'clicks.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((track * 32767).astype('<i2').tobytes())
    print(f'{played} clics dans la bande son')

    subprocess.run([
        'ffmpeg', '-y', '-loglevel', 'error',
        '-f', 'concat', '-safe', '0', '-i', str(OUT / 'frames.txt'),
        '-i', str(OUT / 'clicks.wav'),
        '-vf', 'fps=30,format=yuv420p',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-tune', 'animation',
        '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart',
        str(HERE / 'klik-presentation.mp4'),
    ], check=True, cwd=OUT)
    print('video/klik-presentation.mp4')


if __name__ == '__main__':
    main()
