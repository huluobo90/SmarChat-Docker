import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = workerSrc;
export function PdfPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [doc, setDoc] = useState<any>(null),
    [page, setPage] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    setDoc(null);
    setPage(1);
    setError("");
    setLoading(true);
    let active = true;
    const task = getDocument({
      url,
      withCredentials: true,
      enableXfa: false,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
    });
    task.promise
      .then((pdf) => {
        if (active) setDoc(pdf);
      })
      .catch(() => {
        if (active) {
          setError("无法生成预览，可下载原文件查看。");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      void task.destroy();
    };
  }, [url]);
  useEffect(() => {
    if (!doc) return;
    let active = true,
      render: any;
    setLoading(true);
    doc
      .getPage(page)
      .then((p: any) => {
        if (!active || !canvas.current) return;
        const base = p.getViewport({ scale: 1 }),
          viewport = p.getViewport({
            scale: Math.min(
              1.5,
              Math.max(300, Math.min(window.innerWidth - 100, 900)) /
                base.width,
            ),
          });
        const element = canvas.current,
          ratio = Math.min(window.devicePixelRatio || 1, 2);
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = viewport.width + "px";
        element.style.height = viewport.height + "px";
        render = p.render({
          canvas: element,
          viewport,
          transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0],
        });
        return render.promise;
      })
      .then(() => {
        if (active) setLoading(false);
      })
      .catch((e: any) => {
        if (active && e.name !== "RenderingCancelledException") {
          setError("页面预览失败，可下载原文件。");
          setLoading(false);
        }
      });
    return () => {
      active = false;
      render?.cancel();
    };
  }, [doc, page]);
  return (
    <div className="pdf-preview">
      <div className="pdf-tools">
        <button
          disabled={!doc || page <= 1}
          onClick={() => setPage((p) => p - 1)}
        >
          上一页
        </button>
        <span>
          {page} / {doc?.numPages || "—"}
        </span>
        <button
          disabled={!doc || page >= doc.numPages}
          onClick={() => setPage((p) => p + 1)}
        >
          下一页
        </button>
        {loading && <span>正在渲染…</span>}
      </div>
      {error ? (
        <p role="alert">{error}</p>
      ) : (
        <div className="pdf-canvas">
          <canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />
        </div>
      )}
    </div>
  );
}
