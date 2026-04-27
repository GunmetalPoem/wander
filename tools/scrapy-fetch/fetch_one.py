#!/usr/bin/env python3
"""
One-shot page fetch: prints JSON to stdout {ok, title?, text?, error?}
Invoked from Node: python3 tools/scrapy-fetch/fetch_one.py <url> <max_text_chars>
Uses Scrapy (Twisted) for download + redirects + HTTP handling; lxml for DOM text.
"""
from __future__ import annotations

import os

# Before scrapy: reduce banner noise on stdout (Node parses single JSON line).
os.environ.setdefault("SCRAPY_LOG_LEVEL", "ERROR")

import json
import re
import sys
from typing import Any

import scrapy
from lxml import html
from scrapy.crawler import CrawlerProcess
from scrapy.http import TextResponse
from w3lib.url import safe_url_string


def extract_title_text(url: str, body: bytes) -> tuple[str, str, str]:
    """Return (error_or_empty, title, text). error non-empty on parse failure."""
    try:
        root = html.document_fromstring(body, base_url=url)
    except Exception as e:
        return (str(e), "", "")

    for bad in root.xpath("//script|//style|//noscript|//svg"):
        if bad is not None:
            bad.drop_tree()

    t_parts = (
        root.xpath('string(//meta[@property="og:title"]/@content)').strip()
        or " ".join(root.xpath("//h1[1]//text()"))[:500].strip()
        or " ".join(root.xpath("string(//title)").split())[:200].strip()
        or url
    )
    title = t_parts[:200]

    for tag in ("main", "article", "body"):
        el = root.xpath(f"//{tag}")
        if el:
            raw = " ".join(el[0].xpath(".//text()"))
            out = re.sub(r"\s+", " ", raw).strip()
            if out:
                return ("", title, out)

    out = re.sub(r"\s+", " ", " ".join(root.xpath("//text()"))).strip()
    return ("", title, out)


class OnePageSpider(scrapy.Spider):
    name = "lore_one_page"
    custom_settings: dict[str, Any] = {
        "ROBOTSTXT_OBEY": False,
        "LOG_ENABLED": True,
        "LOG_LEVEL": "ERROR",
        "TELNETCONSOLE_ENABLED": False,
        "DOWNLOAD_TIMEOUT": 30,
        "RETRY_TIMES": 2,
        "RETRY_HTTP_CODES": [500, 502, 503, 504, 408, 429],
        "USER_AGENT": (
            "LoreBot/0.1 (+https://github.com) research scraper; "
            "educational project - contact site owner if problematic"
        ),
    }

    def __init__(self, url: str, max_text_chars: str, result: list, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.start_url = safe_url_string(url, encoding="utf-8")
        self.max_chars = int(max_text_chars)
        self._result = result

    def start_requests(self):
        yield scrapy.Request(
            self.start_url,
            callback=self.parse,
            errback=self.err,
            headers={"Accept": "text/html,application/xhtml+xml,*/*;q=0.8"},
        )

    def parse(self, response: TextResponse) -> None:
        if response.status >= 400:
            self._result.append(
                {"ok": False, "error": f"HTTP {response.status} fetching {self.start_url}"}
            )
            return
        body_bytes = response.body or b""
        if not body_bytes:
            self._result.append({"ok": False, "error": f"Empty body: {self.start_url}"})
            return

        err, title, text = extract_title_text(self.start_url, body_bytes)
        if err:
            self._result.append({"ok": False, "error": f"HTML parse: {err}"})
            return
        if not text or len(text.strip()) < 8:
            self._result.append({"ok": False, "error": "No extractable text from page"})
            return
        if len(text) > self.max_chars:
            text = f"{text[: self.max_chars]} [truncated]"
        self._result.append({"ok": True, "title": title, "text": text})

    def err(self, failure) -> None:
        msg = failure.getErrorMessage() if failure else "request failed"
        self._result.append({"ok": False, "error": f"{self.start_url}: {msg}"})


def main() -> int:
    if len(sys.argv) < 2:
        print(
            json.dumps({"ok": False, "error": "usage: fetch_one.py <url> [max_text_chars]"}),
            flush=True,
        )
        return 1
    url = sys.argv[1]
    max_chars = sys.argv[2] if len(sys.argv) > 2 else "14000"
    if not url.startswith("http://") and not url.startswith("https://"):
        print(
            json.dumps({"ok": False, "error": "URL must be http(s)"}),
            flush=True,
        )
        return 1

    out: list[dict[str, Any]] = []
    process = CrawlerProcess(
        {
            "LOG_LEVEL": "CRITICAL",
            "LOG_VERSIONS": [],
        },
        install_root_handler=False,
    )
    process.crawl(OnePageSpider, url=url, max_text_chars=max_chars, result=out)
    process.start()
    if not out:
        print(
            json.dumps({"ok": False, "error": "Scrapy produced no result"}),
            flush=True,
        )
        return 1
    print(json.dumps(out[0]), flush=True)
    return 0 if out[0].get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
