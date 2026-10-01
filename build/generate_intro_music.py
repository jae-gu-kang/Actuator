"""Compose original upbeat electronic pop at 118 BPM, without external samples.

Run: python3 build/generate_intro_music.py
Then: ffmpeg -y -i /tmp/actuator-intro.wav -c:a aac -b:a 128k ai/media/intro-music.m4a
"""
import math
import random
import struct
import wave
from array import array

RATE = 22050
BPM = 118
BEAT = 60 / BPM
SECONDS = 64 * BEAT
SIZE = round(RATE * SECONDS)
left = array('d', [0.0]) * SIZE
right = array('d', [0.0]) * SIZE
noise = random.Random(118)


def add(start, values, pan=0.0):
    offset = round(start * RATE)
    lg, rg = math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)
    for i, value in enumerate(values):
        index = (offset + i) % SIZE
        left[index] += value * lg
        right[index] += value * rg


def note(midi, start, beats, level, pan=0.0, bass=False):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    duration = beats * BEAT
    values = array('d')
    for i in range(round(duration * RATE)):
        t = i / RATE
        phase = 2 * math.pi * frequency * t
        envelope = (1 - math.exp(-t / 0.008)) * math.exp(-t / (0.22 if bass else 0.32))
        envelope *= min(1, (duration - t) / 0.06)
        tone = math.sin(phase) + (0.24 if bass else 0.38) * math.sin(2 * phase)
        if not bass:
            tone += 0.17 * math.sin(3 * phase) + 0.07 * math.sin(4 * phase)
        values.append(level * envelope * tone)
    add(start, values, pan)


# D major: D / A / Bm / G. Syncopated chords, an original hook, and moving bass.
chords = [(62, 66, 69), (61, 64, 69), (62, 66, 71), (62, 67, 71)]
roots = [38, 33, 35, 31]
hooks = [(78, 81, 78, 76, 74), (76, 73, 76, 81, 76),
         (78, 81, 83, 81, 78), (79, 78, 74, 76, 78)]
for bar in range(16):
    section = bar % 4
    start = bar * 4 * BEAT
    for hit in (0.5, 1.5, 2.75, 3.5):
        for voice, midi in enumerate(chords[section]):
            note(midi, start + hit * BEAT, 0.65, 0.024, (voice - 1) * 0.45)
    for hit, pitch in ((0, 0), (0.75, 0), (1.5, 12), (2, 0), (2.75, 7), (3.5, 12)):
        note(roots[section] + pitch, start + hit * BEAT, 0.5, 0.12, bass=True)
    for hit, midi in zip((0, 0.75, 1.5, 2.5, 3.25), hooks[section]):
        # A second phrase changes the last note instead of repeating every four bars.
        if bar >= 8 and hit == 3.25:
            midi = chords[section][2] + 12
        note(midi, start + hit * BEAT, 0.8, 0.055, 0.15)

# Light stereo echo on the instruments only; drums stay crisp.
for channel, delay in ((left, 0.75 * BEAT), (right, 1.5 * BEAT)):
    dry = channel[:]
    offset = round(delay * RATE)
    for i in range(SIZE):
        channel[i] += dry[(i - offset) % SIZE] * 0.13


def drum(kind, start, level):
    duration = {'kick': 0.3, 'snare': 0.18, 'hat': 0.055}[kind]
    values = array('d')
    previous = 0.0
    for i in range(round(duration * RATE)):
        t = i / RATE
        if kind == 'kick':
            # Smooth pitch sweep from 150 Hz to 48 Hz.
            phase = 2 * math.pi * (48 * t + 102 * 0.025 * (1 - math.exp(-t / 0.025)))
            value = math.sin(phase) * math.exp(-t / 0.075)
        else:
            sample = noise.uniform(-1, 1)
            high = (sample - previous) * 0.5
            previous = sample
            if kind == 'snare':
                value = (0.8 * high + 0.2 * math.sin(2 * math.pi * 185 * t)) * math.exp(-t / 0.045)
            else:
                value = high * math.exp(-t / 0.012)
        values.append(level * value * min(1, t / 0.002))
    add(start, values, 0.35 if kind == 'hat' else 0)


for bar in range(16):
    start = bar * 4 * BEAT
    for beat in range(4):
        drum('kick', start + beat * BEAT, 0.21)
    for beat in (1, 3):
        drum('snare', start + beat * BEAT, 0.14)
    for eighth in range(8):
        drum('hat', start + eighth * BEAT / 2, 0.062 if eighth % 2 else 0.042)

peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
scale = 0.72 / peak
pcm = bytearray()
for lval, rval in zip(left, right):
    pcm.extend(struct.pack('<hh', round(lval * scale * 32767), round(rval * scale * 32767)))
with wave.open('/tmp/actuator-intro.wav', 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(pcm)
print(f'Wrote /tmp/actuator-intro.wav ({SECONDS:.2f} s, {BPM} BPM, original electronic pop)')
