"""Small, dependency-light readers for agreement source documents.

Extractors work from text and tables, never a page number.  PDF and DOCX are
normalised here so a grant program can support either delivery format without
duplicating its business rules.
"""

from __future__ import annotations

import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

import pdfplumber

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_W = "{%s}" % W_NS


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").replace("\xa0", " ").strip()


def _paragraph_text(node) -> str:
    return clean("".join(t.text or "" for t in node.iter(_W + "t")))


def _paragraph_lines(node) -> str:
    """Paragraph text with explicit line breaks (``<w:br/>``) kept as newlines.

    Word cells routinely pack a heading and its detail into a single paragraph
    separated by a soft line break rather than a paragraph mark. Collapsing that
    break (as ``_paragraph_text`` does) fuses the two into "procurementFinalize";
    keeping it lets callers split on a real boundary instead of guessing.
    """
    parts = []
    for el in node.iter():
        if el.tag == _W + "t":
            parts.append(el.text or "")
        elif el.tag in (_W + "br", _W + "cr"):
            parts.append("\n")
    return "\n".join(clean(line) for line in "".join(parts).split("\n"))


def read_docx(path: str) -> tuple[str, list[list[list[str]]]]:
    """Return document text plus tables as rows of cleaned cell strings."""
    try:
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError("This file does not appear to be a readable Word document.") from exc

    paragraphs = [_paragraph_text(p) for p in root.findall(".//" + _W + "p")]
    tables = []
    for table in root.findall(".//" + _W + "tbl"):
        rows = []
        for row in table.findall(_W + "tr"):
            cells = []
            for cell in row.findall(_W + "tc"):
                parts = [_paragraph_text(p) for p in cell.findall(".//" + _W + "p")]
                cells.append(clean(" ".join(p for p in parts if p)))
            if any(cells):
                rows.append(cells)
        if rows:
            tables.append(rows)
    return "\n".join(p for p in paragraphs if p), tables


def read_docx_tables(path: str) -> list[list[list[str]]]:
    """Return only the tables, with each cell keeping its internal line breaks.

    Same table shape as ``read_docx`` (rows of cell strings), except a cell may
    contain newlines where the document used paragraph marks or soft line
    breaks. This is what makes the BFF milestone cell — a bold name followed by
    a line-broken description in one paragraph — splittable on a real boundary.
    """
    try:
        with zipfile.ZipFile(path) as archive:
            root = ET.fromstring(archive.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError("This file does not appear to be a readable Word document.") from exc

    tables = []
    for table in root.findall(".//" + _W + "tbl"):
        rows = []
        for row in table.findall(_W + "tr"):
            cells = []
            for cell in row.findall(_W + "tc"):
                lines = [_paragraph_lines(p) for p in cell.findall(".//" + _W + "p")]
                text = "\n".join(line for line in lines if line is not None)
                cells.append("\n".join(l for l in text.split("\n") if l).strip())
            if any(cells):
                rows.append(cells)
        if rows:
            tables.append(rows)
    return tables


def read_text(path: str) -> str:
    """Read text-layer PDF or DOCX agreement content; reject other formats."""
    suffix = Path(path).suffix.lower()
    if suffix == ".docx":
        return read_docx(path)[0]
    if suffix == ".pdf":
        try:
            with pdfplumber.open(path) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        except Exception as exc:  # pdfplumber provides several implementation errors
            raise ValueError("This PDF could not be read. Use a text-based PDF or a DOCX agreement.") from exc
        if not clean(text):
            raise ValueError("This PDF has no readable text layer. Upload a DOCX or an OCRed PDF.")
        return text
    raise ValueError("Upload a PDF or DOCX agreement.")
