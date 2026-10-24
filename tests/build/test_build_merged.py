#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""build/build_merged.py 의 번들 홈 정리(strip_home) 검증.

  python3 -m unittest discover -s tests/build

번들에 들어가지 않는 파일을 가리키는 카드가 번들 홈에 남으면, 누르는 순간 iframe 이
없는 파일로 이동해 깨진다. strip_home 은 그런 카드를 빼고, 마크업이 바뀌어 못 찾으면
조용히 넘어가지 않고 빌드를 멈춰야 한다.
"""
import importlib.util
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
spec = importlib.util.spec_from_file_location("build_merged", os.path.join(ROOT, "build", "build_merged.py"))
bm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bm)  # main() 가드 덕분에 import 만으로는 번들을 쓰지 않는다

CARD = '    <a class="card theme-{t}" href="{href}"{extra}>\n      <h2>{name}</h2>\n    </a>\n'


def home(cards, count, papers_attr=""):
    return (
        f'<nav><span class="nav-count">{count}개의 도구</span></nav>\n'
        '<section class="grid-section">\n  <div class="grid">\n' + "".join(cards) + "  </div>\n</section>\n"
        f'<section class="grid-section" id="papers"{papers_attr}>\n  <a class="card paper" href="deck.html">x</a>\n</section>\n'
        "<footer>f</footer>"
    )


class StripHome(unittest.TestCase):
    def test_removes_hidden_papers_section(self):
        out = bm.strip_home(home([CARD.format(t="blue", href="a.html", extra="", name="A")], 1, papers_attr=" hidden"))
        self.assertNotIn('id="papers"', out)
        self.assertNotIn("deck.html", out)
        self.assertIn("<footer>", out)

    def test_removes_web_only_card_with_its_comment_and_keeps_others(self):
        cards = [
            CARD.format(t="blue", href="a.html", extra="", name="A"),
            "    <!-- data-web-only: 번들에 없는 도구 -->\n" + CARD.format(t="indigo", href="w.html", extra=" data-web-only", name="W"),
            CARD.format(t="gray", href="m.html", extra="", name="M"),
        ]
        out = bm.strip_home(home(cards, 3))
        self.assertNotIn("w.html", out)
        self.assertNotIn("data-web-only", out)  # 주석까지 같이 빠져야 한다
        self.assertIn('href="a.html"', out)
        self.assertIn('\n    <a class="card theme-gray" href="m.html">', out)  # 다음 카드의 들여쓰기는 그대로
        self.assertIn('<span class="nav-count">2개의 도구</span>', out)

    def test_count_unchanged_without_web_only_cards(self):
        out = bm.strip_home(home([CARD.format(t="blue", href="a.html", extra="", name="A")], 1))
        self.assertIn('<span class="nav-count">1개의 도구</span>', out)

    def test_removes_every_web_only_card_and_decrements_count_by_that_many(self):
        cards = [
            CARD.format(t="blue", href="a.html", extra="", name="A"),
            CARD.format(t="indigo", href="w1.html", extra=" data-web-only", name="W1"),
            CARD.format(t="gray", href="m.html", extra="", name="M"),
            CARD.format(t="teal", href="w2.html", extra=" data-web-only", name="W2"),
        ]
        out = bm.strip_home(home(cards, 4))
        self.assertNotIn("w1.html", out)
        self.assertNotIn("w2.html", out)
        self.assertIn('href="a.html"', out)
        self.assertIn('href="m.html"', out)
        self.assertIn('<span class="nav-count">2개의 도구</span>', out)

    def test_spacing_between_remaining_cards_is_preserved(self):
        # index.html 처럼 카드 사이에 빈 줄이 있을 때, 빼고 난 결과가 처음부터 그 카드가 없던 홈과 글자 단위로 같아야 한다
        a = CARD.format(t="blue", href="a.html", extra="", name="A")
        w = "    <!-- data-web-only: 번들에 없는 도구 -->\n" + CARD.format(t="indigo", href="w.html", extra=" data-web-only", name="W")
        m = CARD.format(t="gray", href="m.html", extra="", name="M")
        out = bm.strip_home(home([a, "\n", w, "\n", m], 3))
        self.assertEqual(out, bm.strip_home(home([a, "\n", m], 2)))

    def test_missing_papers_section_stops_build(self):
        html = home([CARD.format(t="blue", href="a.html", extra="", name="A")], 1).replace('id="papers"', 'id="other"')
        with self.assertRaisesRegex(SystemExit, "'논문 발표' 섹션"):
            bm.strip_home(html)

    def test_unmatched_web_only_marker_stops_build(self):
        # 마크업이 바뀌어 정규식이 카드를 못 잡으면(여기선 <div>) 깨진 카드를 싣지 말고 멈춘다
        odd = '    <div class="card" data-web-only><a href="w.html">W</a></div>\n'
        with self.assertRaisesRegex(SystemExit, "data-web-only 카드 1개 중 0개"):
            bm.strip_home(home([odd], 1))

    def test_missing_nav_count_stops_build(self):
        html = home([CARD.format(t="blue", href="a.html", extra="", name="A")], 1).replace("nav-count", "nav-x")
        with self.assertRaisesRegex(SystemExit, "nav-count"):
            bm.strip_home(html)


class RealIndex(unittest.TestCase):
    """실제 index.html: 번들 홈의 모든 도구 카드가 번들 안의 도구를 가리키고, 개수 표기가 맞는지."""

    def test_every_home_card_points_into_the_bundle(self):
        with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
            out = bm.strip_home(f.read())
        bundled = {fn for _, fn, _ in bm.TOOLS}
        hrefs = re.findall(r'<a class="card[^"]*" href="([^"]+)"', out)
        self.assertTrue(hrefs)
        self.assertEqual([h for h in hrefs if h not in bundled], [])
        n = int(re.search(r'<span class="nav-count">(\d+)개의 도구</span>', out).group(1))
        self.assertEqual(n, len(hrefs))


if __name__ == "__main__":
    unittest.main()
