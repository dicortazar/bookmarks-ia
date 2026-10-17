"""Build the PDF card for a bookmark.
Usage: python3 make_ficha.py input.json output.pdf
input.json: {"title","url","added","processed","tags":[...],"summary","key_points":[...]}
"""
import json, sys
from xml.sax.saxutils import escape
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, ListFlowable, ListItem, HRFlowable

d = json.load(open(sys.argv[1], encoding="utf-8"))
ss = getSampleStyleSheet()
accent = colors.HexColor("#1f6f5c")
title = ParagraphStyle("t", parent=ss["Title"], alignment=0, fontSize=18, leading=22, textColor=colors.HexColor("#1d2321"))
meta = ParagraphStyle("m", parent=ss["Normal"], fontSize=9, leading=12, textColor=colors.HexColor("#66706c"))
h = ParagraphStyle("h", parent=ss["Heading3"], textColor=accent, spaceBefore=10)
body = ParagraphStyle("b", parent=ss["Normal"], fontSize=11, leading=15.5)

e = lambda s: escape(str(s or ""))
story = [
    Paragraph(e(d["title"]), title),
    Paragraph(f'<link href="{e(d["url"])}" color="#1f6f5c">{e(d["url"])}</link>', meta),
    Paragraph(f'Saved: {e(d.get("added"))} · Processed: {e(d.get("processed"))}', meta),
    Paragraph("Tags: " + e(", ".join(d.get("tags", []))), meta),
    Spacer(1, 6), HRFlowable(width="100%", color=colors.HexColor("#dedbd2")),
    Paragraph("Summary", h), Paragraph(e(d.get("summary")), body),
]
if d.get("key_points"):
    story += [Paragraph("Key points", h),
              ListFlowable([ListItem(Paragraph(e(p), body), leftIndent=12) for p in d["key_points"]],
                           bulletType="bullet", start="•", leftIndent=12)]
if d.get("sources"):
    story += [Paragraph("Sources", h),
              Paragraph(e(d.get("source_note") or "Summary based on these sources:"), meta),
              ListFlowable([ListItem(Paragraph(f'<link href="{e(u)}" color="#1f6f5c">{e(u)}</link>', meta), leftIndent=12)
                            for u in d["sources"]], bulletType="bullet", start="•", leftIndent=12)]
SimpleDocTemplate(sys.argv[2], pagesize=A4, leftMargin=18*mm, rightMargin=18*mm,
                  topMargin=18*mm, bottomMargin=18*mm, title=d["title"]).build(story)
