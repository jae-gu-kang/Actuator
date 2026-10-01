"""Compose the original, sample-free intro bed (32-second seamless loop).

Run: python3 build/generate_intro_music.py
Then: ffmpeg -y -i /tmp/actuator-intro.wav -c:a aac -b:a 128k ai/media/intro-music.m4a
"""
import math
import struct
import wave
from array import array

RATE = 22050
SECONDS = 32
SIZE = RATE * SECONDS
left = array('d', [0.0]) * SIZE
right = array('d', [0.0]) * SIZE


def note(midi, start, length, level, pan=0.0, pad=False):
    frequency = 440 * 2 ** ((midi - 69) / 12)
    for i in range(int(length * RATE)):
        t = i / RATE
        attack = 1 - math.exp(-t / (0.7 if pad else 0.035))
        release = min(1.0, (length - t) / (2.0 if pad else 1.4)) ** 2
        envelope = attack * release * (1.0 if pad else math.exp(-t / 2.3))
        phase = 2 * math.pi * frequency * t
        tone = math.sin(phase) + 0.16 * math.sin(2 * phase) + 0.035 * math.sin(3 * phase)
        value = level * envelope * tone
        index = (int(start * RATE) + i) % SIZE
        left[index] += value * math.sqrt((1 - pan) / 2)
        right[index] += value * math.sqrt((1 + pan) / 2)


# Cmaj7 / Am7 / Fmaj7 / Gadd9, at 60 BPM. Soft pad plus sparse keys.
chords = [(48, 55, 59, 64), (45, 52, 55, 60), (41, 48, 52, 57), (43, 50, 57, 59)]
melody = [(76, 74, 71), (72, 71, 67), (69, 72, 76), (74, 71, 67)]
for bar, chord in enumerate(chords):
    start = bar * 8
    for voice, midi in enumerate(chord):
        note(midi, start, 10, 0.038, (voice - 1.5) * 0.25, pad=True)
    for step in range(8):
        note(chord[step % 4] + 12, start + step, 4.5, 0.045, (-1 if step % 2 else 1) * 0.3)
    for step, midi in enumerate(melody[bar]):
        note(midi, start + 1 + step * 2, 5, 0.043, 0.12)

# Circular, quiet stereo echoes preserve the loop boundary and soften the keys.
for channel, delays in [(left, (0.31, 0.73)), (right, (0.43, 0.89))]:
    dry = channel[:]
    for delay, gain in zip(delays, (0.16, 0.08)):
        offset = int(delay * RATE)
        for i in range(SIZE):
            channel[i] += dry[(i - offset) % SIZE] * gain

peak = max(max(abs(x) for x in left), max(abs(x) for x in right))
scale = 0.65 / peak
pcm = bytearray()
for lval, rval in zip(left, right):
    pcm.extend(struct.pack('<hh', round(lval * scale * 32767), round(rval * scale * 32767)))
with wave.open('/tmp/actuator-intro.wav', 'wb') as output:
    output.setnchannels(2)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(pcm)
print('Wrote /tmp/actuator-intro.wav (32 s, original composition, no external samples)')
