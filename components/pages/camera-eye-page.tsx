"use client";

import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { Pause, ScanLine, Settings } from "lucide-react";
import { useCam } from "@/hooks/camera-permission";
import { LoadOnnx } from "@/lib/onnx";

// ---------- types ----------
type Det = { bbox: [number, number, number, number]; score: number; classId: number };

// ---------- helpers ----------
function xywh2xyxy(x: number, y: number, w: number, h: number) {
  const x1 = x - w / 2, y1 = y - h / 2, x2 = x + w / 2, y2 = y + h / 2;
  return [x1, y1, x2, y2] as [number, number, number, number];
}

function nms(boxes: number[][], scores: number[], iouThres: number): number[] {
  const order = scores.map((s, i) => [s, i] as [number, number]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
  const keep: number[] = [];
  while (order.length) {
    const i = order.shift()!;
    keep.push(i);
    const [x1, y1, x2, y2] = boxes[i];
    for (let k = order.length - 1; k >= 0; --k) {
      const j = order[k];
      const [xx1, yy1, xx2, yy2] = [
        Math.max(x1, boxes[j][0]),
        Math.max(y1, boxes[j][1]),
        Math.min(x2, boxes[j][2]),
        Math.min(y2, boxes[j][3]),
      ];
      const w = Math.max(0, xx1 < xx2 ? xx2 - xx1 : 0);
      const h = Math.max(0, yy1 < yy2 ? yy2 - yy1 : 0);
      const inter = w * h;
      const a = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
      const b = Math.max(0, boxes[j][2] - boxes[j][0]) * Math.max(0, boxes[j][3] - boxes[j][1]);
      const iou = inter / (a + b - inter + 1e-9);
      if (iou > iouThres) order.splice(k, 1);
    }
  }
  return keep;
}

export function CameraUIPage() {
  const { cameraState } = useCam();
  const [scan, setScan] = useState(false);

  const webcamRef = useRef<Webcam | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);     // actual <video> node
  const overlayRef = useRef<HTMLCanvasElement | null>(null);  // drawing overlay
  const sessionRef = useRef<any>(null);
  const rafRef = useRef<number | null>(null);

  // temp preprocessing canvas (hidden)
  const prepCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prepCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // load ONNX session once
  useEffect(() => {
    (async () => {
      const session = await LoadOnnx();
      if (!session) {
        alert("Failed to load ONNX model");
        return;
      }
      sessionRef.current = session;
    })();
  }, []);

  // capture the internal <video> once webcam mounts
  useEffect(() => {
    const id = setInterval(() => {
      const vid = (webcamRef.current as any)?.video as HTMLVideoElement | undefined;
      if (vid && vid.readyState >= 2) {
        videoRef.current = vid;
        clearInterval(id);
      }
    }, 200);
    return () => clearInterval(id);
  }, [scan]);

  // start/stop loop on scan toggle
  const handleScan = () => {
    if (cameraState === "denied") {
      setScan(false);
      alert("Camera Access Denied !!");
      return;
    }
    setScan(prev => {
      const next = !prev;
      if (next) startLoop();
      else stopLoop();
      return next;
    });
  };

  function startLoop() {
    // init preprocessing canvas once
    if (!prepCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 640; c.height = 640;
      prepCanvasRef.current = c;
      prepCtxRef.current = c.getContext("2d");
    }
    tick();
  }

  function stopLoop() {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    const ctx = overlayRef.current?.getContext("2d");
    if (ctx && overlayRef.current) ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
  }

  // main rAF loop (throttled to ~15 FPS)
  let lastTime = 0;
  const tick = async (t?: number) => {
    rafRef.current = requestAnimationFrame(tick);
    const now = t ?? performance.now();
    if (now - lastTime < 66) return; // ~15 fps
    lastTime = now;
    await runSingleInference();
  };

  // draw boxes in overlay coords that match the displayed video size
  function drawDetections(dets: Det[]) {
    const video = videoRef.current, canvas = overlayRef.current;
    if (!video || !canvas) return;

    // match overlay size to displayed video box
    const W = video.clientWidth || video.videoWidth;
    const H = video.clientHeight || video.videoHeight;
    canvas.width = W; canvas.height = H;

    const sx = W / video.videoWidth;
    const sy = H / video.videoHeight;

    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "lime";
    ctx.fillStyle = "lime";
    ctx.lineWidth = 2;
    ctx.font = "14px system-ui, sans-serif";

    for (const { bbox:[x1,y1,x2,y2], score, classId } of dets) {
      const rx = x1 * sx, ry = y1 * sy, rw = (x2 - x1) * sx, rh = (y2 - y1) * sy;
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.fillText(`${classId}:${score.toFixed(2)}`, rx + 2, Math.max(12, ry + 14));
    }
  }

  // one frame → preprocess → session.run → postprocess → draw
  const runSingleInference = async () => {
    const session = sessionRef.current;
    const video = videoRef.current;
    const prep = prepCanvasRef.current, pctx = prepCtxRef.current;
    if (!session || !video || !prep || !pctx || video.readyState < 2) return;

    const size = 640;
    const vw = video.videoWidth, vh = video.videoHeight;

    // letterbox into 640x640 (Ultralytics style)
    const scale = Math.min(size / vw, size / vh);
    const nw = Math.round(vw * scale), nh = Math.round(vh * scale);
    const dx = Math.floor((size - nw) / 2), dy = Math.floor((size - nh) / 2);

    pctx.fillStyle = "rgb(114,114,114)";
    pctx.fillRect(0, 0, size, size);
    pctx.drawImage(video, 0, 0, vw, vh, dx, dy, nw, nh);

    const imageData = pctx.getImageData(0, 0, size, size).data; // RGBA
    const wh = size * size;
    const floatData = new Float32Array(3 * wh);
    for (let i = 0; i < wh; i++) {
      floatData[i] = imageData[i * 4] / 255;
      floatData[i + wh] = imageData[i * 4 + 1] / 255;
      floatData[i + 2 * wh] = imageData[i * 4 + 2] / 255;
    }

    try {
      const ort = await import("onnxruntime-web");
      const inputTensor = new ort.Tensor("float32", floatData, [1, 3, size, size]);
      const inputName = session.inputNames?.[0] ?? "images";
      const outputMap = await session.run({ [inputName]: inputTensor });
      const outTensor = Object.values(outputMap)[0] as { dims: number[]; data: Float32Array };

      // ---- reshape to (N, C) ----
      let B = outTensor.dims[0], A = outTensor.dims[1], N = outTensor.dims[2];
      let C = A, num = N;
      if (outTensor.dims.length === 3 && outTensor.dims[2] < outTensor.dims[1]) {
        num = outTensor.dims[1];
        C = outTensor.dims[2];
      }
      if (B !== 1) return;

      const data = outTensor.data;
      const rows: Float32Array[] = new Array(num);
      if (outTensor.dims[1] === C && outTensor.dims[2] === num) {
        // (1, C, N) → (N, C)
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

      // ---- postprocess ----
      const nc = C - 4;
      const confThres = 0.5, iouThres = 0.7;

      const boxesXYXY: number[][] = [];
      const scores: number[] = [];
      const classIds: number[] = [];

      for (let n = 0; n < num; n++) {
        const r = rows[n];
        const x = r[0], y = r[1], w = r[2], h = r[3];

        // top class score
        let best = -Infinity, bestId = 0;
        for (let k = 0; k < nc; k++) {
          const s = r[4 + k];
          if (s > best) { best = s; bestId = k; }
        }
        if (best < confThres) continue;

        const box = xywh2xyxy(x, y, w, h); // in 640x640 coords
        boxesXYXY.push(box);
        scores.push(best);
        classIds.push(bestId);
      }

      const keep = nms(boxesXYXY, scores, iouThres);

      // undo letterbox → original video coords
      const dets: Det[] = [];
      for (const i of keep) {
        let [x1, y1, x2, y2] = boxesXYXY[i];
        x1 -= dx; x2 -= dx; y1 -= dy; y2 -= dy;
        x1 /= scale; x2 /= scale; y1 /= scale; y2 /= scale;

        // clip
        x1 = Math.max(0, Math.min(vw - 1, x1));
        x2 = Math.max(0, Math.min(vw - 1, x2));
        y1 = Math.max(0, Math.min(vh - 1, y1));
        y2 = Math.max(0, Math.min(vh - 1, y2));

        dets.push({
          bbox: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
          score: scores[i],
          classId: classIds[i],
        });
      }

      drawDetections(dets);
    } catch (err) {
      // swallow occasional frame errors to keep loop alive
      // console.error(err);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden">
      <div className="h-16 flex items-center justify-end px-1">
        <button className="px-5 py-2 text-white/90 flex gap-2 items-center outline-none">
          <Settings />
        </button>
      </div>

      <div className="h-[600px] overflow-hidden flex border rounded-xl m-3 items-center justify-center relative">
        {scan ? (
          <div className="relative w-full h-full">
            <Webcam
              ref={webcamRef}
              
              audio={false}
              videoConstraints={{ facingMode: { ideal: "environment" }, frameRate: {
                ideal: 10, max: 15
              } }}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
            {/* overlay canvas sits on top of the <video> */}
            <canvas
              ref={overlayRef}
              className="pointer-events-none absolute inset-0"
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        ) : (
          <p>Press the Scan to use the camera</p>
        )}
      </div>

      <div className="p-1 m-3">
        <button
          onClick={handleScan}
          className={`${scan ? "bg-red-500" : "bg-violet-500"} outline-none w-full flex items-center justify-center p-2.5 rounded-2xl`}
        >
          {scan ? (
            <>
              <Pause />
              <span className="mx-2">Stop</span>
            </>
          ) : (
            <>
              <ScanLine />
              <span className="mx-2">Scan</span>
            </>
          )}
        </button>
      </div>

      <div className="h-[200px] border rounded-xl m-3 flex items-center justify-center">
        <p className="text-lg font-medium">AI info</p>
      </div>
    </div>
  );
}