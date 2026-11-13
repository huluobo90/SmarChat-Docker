"""Isolated OOXML text preview service. No macros, network requests or office execution."""
import json, os, re, time, zipfile, html, resource
from pathlib import Path
from defusedxml import ElementTree
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.pagesizes import A4

ROOT = Path('/exchange')
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
style = ParagraphStyle('Body', fontName='STSong-Light', fontSize=10, leading=16)

def convert(directory):
    source = directory / 'input.zip'
    if source.stat().st_size > 20 * 1024 * 1024:
        raise ValueError('文件超过大小限制')
    text = []
    with zipfile.ZipFile(source) as archive:
        entries = archive.infolist()
        if len(entries) > 2000 or sum(e.file_size for e in entries) > 100 * 1024 * 1024:
            raise ValueError('文件展开大小超过限制')
        names = archive.namelist()
        if any(n.endswith('vbaProject.bin') for n in names):
            raise ValueError('不处理包含宏的文件')
        shared = []
        if 'xl/sharedStrings.xml' in names:
            root = ElementTree.fromstring(archive.read('xl/sharedStrings.xml'))
            shared = [''.join(x.itertext()) for x in root]
        if 'word/document.xml' in names:
            root = ElementTree.fromstring(archive.read('word/document.xml'))
            ns = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            for p in root.iter(ns + 'p'):
                text.append(''.join(x.text or '' for x in p.iter(ns + 't')))
        else:
            ns = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
            for name in sorted(n for n in names if re.fullmatch(r'xl/worksheets/sheet\d+\.xml', n)):
                text.append('— ' + name.split('/')[-1] + ' —')
                root = ElementTree.fromstring(archive.read(name))
                for row in root.iter(ns + 'row'):
                    values = []
                    for cell in row.iter(ns + 'c'):
                        value = cell.find(ns + 'v')
                        if cell.get('t') == 'inlineStr':
                            values.append(''.join(x.text or '' for x in cell.iter(ns + 't')))
                        elif value is not None and value.text:
                            values.append(shared[int(value.text)] if cell.get('t') == 's' else value.text)
                    text.append(' | '.join(values))
        value = '\n'.join(text)[:200000]
        (directory / 'text.txt').write_text(value, encoding='utf-8')
        story = [Paragraph('SmarChat · 文本预览', style), Spacer(1, 18)]
        for line in value[:80000].splitlines():
            # Split oversized paragraphs to bound reportlab layout work.
            for at in range(0, max(1, len(line)), 1000):
                story.append(Paragraph(html.escape(line[at:at+1000]) or ' ', style))
                story.append(Spacer(1, 5))
        SimpleDocTemplate(str(directory / 'preview.pdf'), pagesize=A4).build(story)

while True:
    for ready in ROOT.glob('*/ready'):
        directory = ready.parent
        if not re.fullmatch(r'[0-9a-f-]{36}', directory.name):
            continue
        try:
            ready.unlink()
            pid = os.fork()
            if pid == 0:
                try:
                    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
                    resource.setrlimit(resource.RLIMIT_AS, (384*1024*1024, 384*1024*1024))
                    resource.setrlimit(resource.RLIMIT_FSIZE, (30*1024*1024, 30*1024*1024))
                    convert(directory)
                    (directory / 'result.json').write_text(json.dumps({'ok': True}))
                    os._exit(0)
                except Exception:
                    (directory / 'result.json').write_text(json.dumps({'ok': False, 'error': '文件不能安全提取；请补充文本或下载原件'}))
                    os._exit(1)
            start = time.monotonic()
            while os.waitpid(pid, os.WNOHANG)[0] == 0:
                if time.monotonic() - start > 25:
                    os.kill(pid, 9)
                    os.waitpid(pid, 0)
                    (directory / 'result.json').write_text(json.dumps({'ok': False, 'error': '文件预览处理超时'}))
                    break
                time.sleep(.2)
        except Exception:
            pass
    time.sleep(.5)
