"use client";

import { useRef, useState } from "react";
import { LoadOnnx } from "@/lib/onnx";

// ---- Types ----
type Det = { bbox: [number, number, number, number]; score: number; classId: number };

// ---- Helpers ----
function xywh2xyxy(x: number, y: number, w: number, h: number) {
  const x1 = x - w / 2,
    y1 = y - h / 2,
    x2 = x + w / 2,
    y2 = y + h / 2;
  return [x1, y1, x2, y2] as [number, number, number, number];
}

// simple NMS
function nms(boxes: number[][], scores: number[], iouThres: number): number[] {
  const order = scores
    .map((s, i) => [s, i] as [number, number])
    .sort((a, b) => b[0] - a[0])
    .map((x) => x[1]);
  const keep: number[] = [];
  while (order.length) {
    const i = order.shift()!;
    keep.push(i);
    const [x1, y1, x2, y2] = boxes[i];
    for (let k = order.length - 1; k >= 0; --k) {
      const j = order[k];
      const xx1 = Math.max(x1, boxes[j][0]);
      const yy1 = Math.max(y1, boxes[j][1]);
      const xx2 = Math.min(x2, boxes[j][2]);
      const yy2 = Math.min(y2, boxes[j][3]);
      const w = Math.max(0, xx2 - xx1);
      const h = Math.max(0, yy2 - yy1);
      const inter = w * h;
      const a = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const b = Math.max(0, boxes[j][2] - boxes[j][0]) * Math.max(0, boxes[j][3] - boxes[j][1]);
      const iou = inter / (a + b - inter + 1e-9);
      if (iou > iouThres) order.splice(k, 1);
    }
  }
  return keep;
}

export default function TestImageUpload() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const sessionRef = useRef<any>(null);

  // Load ONNX session once
  const loadSession = async () => {
    if (sessionRef.current) return sessionRef.current;
    const session = await LoadOnnx();
    sessionRef.current = session;
    return session;
  };

  // Wait for <img> to finish loading (so naturalWidth/Height are available)
  const waitForImg = async () =>
    new Promise<void>((res) => {
      const img = imageRef.current;
      if (!img) return res();
      if (img.complete && img.naturalWidth > 0) return res();
      img.onload = () => res();
      img.onerror = () => res();
    });

  // Draw green rectangles + labels over the displayed image
  function drawDetections(dets: Det[]) {
    const img = imageRef.current,
      canvas = overlayRef.current;
    if (!img || !canvas) return;

    // match canvas to DISPLAY size
    const W = img.clientWidth || img.naturalWidth;
    const H = img.clientHeight || img.naturalHeight;
    canvas.width = W;
    canvas.height = H;

    // scale original -> displayed pixels
    const sx = W / img.naturalWidth;
    const sy = H / img.naturalHeight;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "lime";
    ctx.fillStyle = "lime";
    ctx.lineWidth = 2;
    ctx.font = "14px system-ui, sans-serif";

    for (const { bbox: [x1, y1, x2, y2], score, classId } of dets) {
      const rx = x1 * sx,
        ry = y1 * sy,
        rw = (x2 - x1) * sx,
        rh = (y2 - y1) * sy;
      ctx.strokeRect(rx, ry, rw, rh);
      const label = `${classId}:${score.toFixed(2)}`;
      ctx.fillText(label, rx + 2, Math.max(12, ry + 14));
    }
  }

  // Handle file upload
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    setLoading(true);
    // wait until <img> actually renders the URL
    setTimeout(async () => {
      await waitForImg();
      await runInference(url);
      setLoading(false);
    }, 0);
  };

  // Preprocess + run ONNX + postprocess → detections
  const runInference = async (url: string) => {
    try {
      const session = await loadSession();
      if (!session) return;

      // Load image into a temporary Image for preprocessing
      const img = new window.Image();
      img.src = url;
      await new Promise<void>((res) => {
        img.onload = () => res();
        img.onerror = () => res();
      });

      const size = 640;

      // Letterbox to 640x640 (like Ultralytics)
      const iw = img.width;
      const ih = img.height;
      const scale = Math.min(size / iw, size / ih);
      const nw = Math.round(iw * scale);
      const nh = Math.round(ih * scale);
      const dx = Math.floor((size - nw) / 2);
      const dy = Math.floor((size - nh) / 2);

      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgb(114,114,114)";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, iw, ih, dx, dy, nw, nh);

      const imageData = ctx.getImageData(0, 0, size, size).data;
      const wh = size * size;
      const floatData = new Float32Array(3 * wh);
      for (let i = 0; i < wh; i++) {
        const r = imageData[i * 4] / 255.0;
        const g = imageData[i * 4 + 1] / 255.0;
        const b = imageData[i * 4 + 2] / 255.0;
        floatData[i] = r;
        floatData[i + wh] = g;
        floatData[i + 2 * wh] = b;
      }

      const ort = await import("onnxruntime-web");
      const inputTensor = new ort.Tensor("float32", floatData, [1, 3, size, size]);
      const inputName = session.inputNames?.[0] ?? "images";
      const outputMap = await session.run({ [inputName]: inputTensor });
      const outTensor = Object.values(outputMap)[0] as { dims: number[]; data: Float32Array };

      // ---- parse to (N, C) ----
      let B = outTensor.dims[0],
        A = outTensor.dims[1],
        N = outTensor.dims[2];
      let C = A,
        num = N;
      if (outTensor.dims.length === 3 && outTensor.dims[2] < outTensor.dims[1]) {
        num = outTensor.dims[1];
        C = outTensor.dims[2];
      }
      if (B !== 1) throw new Error("Batch size > 1 not supported here.");

      const data = outTensor.data; // length = 1 * C * N
      const rows: Float32Array[] = new Array(num);
      if (outTensor.dims[1] === C && outTensor.dims[2] === num) {
        // (1, C, N) -> transpose to (N, C)
        for (let n = 0; n < num; n++) {
          const row = new Float32Array(C);
          for (let c = 0; c < C; c++) row[c] = data[c * num + n];
          rows[n] = row;
        }
      } else {
        // (1, N, C)
        for (let n = 0; n < num; n++) {
          const start = n * C;
          rows[n] = data.subarray(start, start + C);
        }
      }

      // ---- split + filter + NMS ----
      const nc = C - 4; // num classes
      const confThres = 0.5;
      const iouThres = 0.7;

      const boxesXYXY: number[][] = [];
      const scores: number[] = [];
      const classIds: number[] = [];

      for (let n = 0; n < num; n++) {
        const r = rows[n];
        const x = r[0],
          y = r[1],
          w = r[2],
          h = r[3];

        // best class
        let bestId = 0,
          best = -Infinity;
        for (let k = 0; k < nc; k++) {
          const s = r[4 + k];
          if (s > best) {
            best = s;
            bestId = k;
          }
        }
        if (best < confThres) continue;

        const box = xywh2xyxy(x, y, w, h); // in 640x640 letterboxed coords
        boxesXYXY.push(box);
        scores.push(best);
        classIds.push(bestId);
      }

      const keep = nms(boxesXYXY, scores, iouThres);

      // ---- undo letterbox to original image coords ----
      const dets: Det[] = [];
      for (const i of keep) {
        let [x1, y1, x2, y2] = boxesXYXY[i];
        x1 -= dx;
        x2 -= dx;
        y1 -= dy;
        y2 -= dy;
        x1 /= scale;
        x2 /= scale;
        y1 /= scale;
        y2 /= scale;
        // clip to image bounds
        const w0 = img.width - 1,
          h0 = img.height - 1;
        x1 = Math.max(0, Math.min(w0, x1));
        x2 = Math.max(0, Math.min(w0, x2));
        y1 = Math.max(0, Math.min(h0, y1));
        y2 = Math.max(0, Math.min(h0, y2));
        dets.push({
          bbox: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
          score: scores[i],
          classId: classIds[i],
        });
      }

      console.log("Detections:", dets);
      drawDetections(dets);
    } catch (err) {
      console.error("Inference error:", err);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h2 className="text-2xl font-bold mb-4">Image Upload ONNX Demo</h2>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="mb-4"
      />

      {imgUrl && (
        <div className="relative inline-block mb-4">
          <img
            ref={imageRef}
            src={imgUrl}
            alt="Uploaded"
            className="max-w-xs max-h-80 border rounded block"
          />
          <canvas ref={overlayRef} className="absolute inset-0 pointer-events-none" />
        </div>
      )}

      {loading && <p className="text-lg">Running inference...</p>}
    </div>
  );
}
