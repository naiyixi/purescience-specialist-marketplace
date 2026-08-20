---
name: example-literature-search
description: 示例文献检索：按关键词检索论文标题与摘要并返回可引用列表。
---

# Example Literature Search

A demonstration skill bundled with the example-researcher specialist. It shows how a
marketplace skill is provisioned into a Specialist session without leaking into the
Main Agent's own skill set.

## Usage

Given a research topic, produce a short ranked list of paper titles with one-line
summaries. Prefer recent reviews and high-citation primary sources. Never fabricate
titles or authors — mark anything unverified as such.
