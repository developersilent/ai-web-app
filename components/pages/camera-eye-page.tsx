"use client";

import { useEffect, useRef, useState } from "react";
import Webcam from "react-webcam";
import { Pause, ScanLine, Settings } from "lucide-react";
import { useCam } from "@/hooks/camera-permission";
import { LoadOnnx } from "@/lib/onnx";
import type { InferenceSession } from "onnxruntime-web";

// ---------- types ----------
type Det = { bbox: [number, number, number, number]; score: number; classId: number };

// Simple Non-Maximum Suppression (NMS)
function nms(boxes: number[][], scores: number[], iouThres: number): number[] {
  const idxs = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  const keep: number[] = [];

  function area(b: number[]) {
    return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  }

  while (idxs.length) {
    const i = idxs.shift()!;
    keep.push(i);
    for (let k = idxs.length - 1; k >= 0; --k) {
      const j = idxs[k];
      const xx1 = Math.max(boxes[i][0], boxes[j][0]);
      const yy1 = Math.max(boxes[i][1], boxes[j][1]);
      const xx2 = Math.min(boxes[i][2], boxes[j][2]);
      const yy2 = Math.min(boxes[i][3], boxes[j][3]);
      const w = Math.max(0, xx2 - xx1);
      const h = Math.max(0, yy2 - yy1);
      const inter = w * h;
      const union = area(boxes[i]) + area(boxes[j]) - inter + 1e-9;
      const iou = inter / union;
      if (iou > iouThres) idxs.splice(k, 1);
    }
  }
  return keep;
}


// Smooth box coordinates using exponential moving average
function smoothBbox(current: [number, number, number, number], previous: [number, number, number, number], alpha: number = 0.7): [number, number, number, number] {
  return [
    alpha * current[0] + (1 - alpha) * previous[0],
    alpha * current[1] + (1 - alpha) * previous[1],
    alpha * current[2] + (1 - alpha) * previous[2],
    alpha * current[3] + (1 - alpha) * previous[3]
  ];
}

export function CameraUIPage() {
  const { cameraState } = useCam();
  const [scan, setScan] = useState(false);

  const webcamRef = useRef<Webcam | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);     // actual <video> node
  const overlayRef = useRef<HTMLCanvasElement | null>(null);  // drawing overlay
  const sessionRef = useRef<InferenceSession | null>(null);
  const rafRef = useRef<number | null>(null);

  // temp preprocessing canvas (hidden)
  const prepCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prepCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // performance optimization refs
  const overlayCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const isInferenceRunningRef = useRef<boolean>(false);
  const frameCountRef = useRef<number>(0);

  // Pre-allocate reusable arrays to avoid memory allocation overhead
  const floatDataRef = useRef<Float32Array | null>(null);
  const cachedVideoSizeRef = useRef<{ w: number, h: number } | null>(null);

  // Detection history for simple smoothing
  const detectionHistoryRef = useRef<Det[][]>([]);

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
      const vid = (webcamRef.current as { video?: HTMLVideoElement })?.video;
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
    isInferenceRunningRef.current = false;
    frameCountRef.current = 0;

    // Clear cached data for fresh restart
    floatDataRef.current = null;
    cachedVideoSizeRef.current = null;

    // Clear tracking state
    detectionHistoryRef.current = [];

    // Use cached context for cleanup
    const ctx = overlayCtxRef.current;
    if (ctx && overlayRef.current) {
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
  }

  // main rAF loop (increased to ~8 FPS for faster response)
  let lastTime = 0;
  const tick = (t?: number) => {
    rafRef.current = requestAnimationFrame(tick);
    const now = t ?? performance.now();

    // Only run inference every 125ms (~8fps) and skip if already running
    if (now - lastTime < 125 || isInferenceRunningRef.current) return;
    lastTime = now;

    // Run inference async without blocking the rAF loop
    runSingleInference().catch(err => {
      console.warn('Inference error:', err);
    });
  };

  // Convert xywh (center x,y,w,h) to xyxy
  function xywh2xyxy(x: number, y: number, w: number, h: number): [number, number, number, number] {
    return [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
  }

  // Draw detections with simple temporal smoothing using detectionHistoryRef
  function drawDetections(dets: Det[]) {
    const video = videoRef.current, canvas = overlayRef.current;
    if (!video || !canvas) return;

    if (!overlayCtxRef.current) overlayCtxRef.current = canvas.getContext("2d");
    const ctx = overlayCtxRef.current;
    if (!ctx) return;

    const W = video.clientWidth || video.videoWidth;
    const H = video.clientHeight || video.videoHeight;
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }

    const sx = W / video.videoWidth;
    const sy = H / video.videoHeight;

    ctx.clearRect(0, 0, W, H);

    const prev = detectionHistoryRef.current.length ? detectionHistoryRef.current[detectionHistoryRef.current.length - 1] : [];
    const smoothed: Det[] = [];

    for (const d of dets) {
      // find best previous match by class and center distance
      const cx = (d.bbox[0] + d.bbox[2]) / 2;
      const cy = (d.bbox[1] + d.bbox[3]) / 2;
      let bestPrev: Det | null = null;
      let bestDist = Infinity;
      for (const p of prev) {
        if (p.classId !== d.classId) continue;
        const pcx = (p.bbox[0] + p.bbox[2]) / 2;
        const pcy = (p.bbox[1] + p.bbox[3]) / 2;
        const dist = Math.hypot(pcx - cx, pcy - cy);
        if (dist < bestDist) { bestDist = dist; bestPrev = p; }
      }

      const smoothAlpha = 0.6;
      const sbbox = bestPrev && bestDist < 80 ? smoothBbox(d.bbox, bestPrev.bbox, smoothAlpha) : d.bbox;
      smoothed.push({ bbox: sbbox, score: d.score, classId: d.classId });

      const [x1, y1, x2, y2] = sbbox;
      const rx = x1 * sx, ry = y1 * sy, rw = (x2 - x1) * sx, rh = (y2 - y1) * sy;

      ctx.strokeStyle = `rgba(64, 195, 255, 0.9)`;
      ctx.lineWidth = 2;
      ctx.strokeRect(rx, ry, rw, rh);

      ctx.font = "12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(0,200,255,0.9)";
      const label = `C:${d.classId} ${(d.score * 100).toFixed(0)}%`;
      ctx.fillText(label, rx + 4, Math.max(12, ry - 4));
    }

    // store smoothed detections for next frame (keep last 5)
    detectionHistoryRef.current.push(smoothed);
    if (detectionHistoryRef.current.length > 5) detectionHistoryRef.current.shift();
  }

  // one frame → preprocess → session.run → postprocess → draw
  const runSingleInference = async () => {
    // Prevent concurrent inference runs
    if (isInferenceRunningRef.current) return;
    isInferenceRunningRef.current = true;

    const session = sessionRef.current;
    const video = videoRef.current;
    const prep = prepCanvasRef.current, pctx = prepCtxRef.current;
    if (!session || !video || !prep || !pctx || video.readyState < 2) {
      isInferenceRunningRef.current = false;
      return;
    }

    // Remove frame skipping for faster response
    frameCountRef.current++;

    const size = 640;
    const vw = video.videoWidth, vh = video.videoHeight;

    // Cache video dimensions to avoid repeated calculations
    const cached = cachedVideoSizeRef.current;
    let scale, nw, nh, dx, dy;

    if (!cached || cached.w !== vw || cached.h !== vh) {
      // Recalculate letterbox parameters when video size changes
      scale = Math.min(size / vw, size / vh);
      nw = Math.round(vw * scale);
      nh = Math.round(vh * scale);
      dx = Math.floor((size - nw) / 2);
      dy = Math.floor((size - nh) / 2);
      cachedVideoSizeRef.current = { w: vw, h: vh };
    } else {
      // Reuse cached calculations
      const s = Math.min(size / vw, size / vh);
      scale = s;
      nw = Math.round(vw * s);
      nh = Math.round(vh * s);
      dx = Math.floor((size - nw) / 2);
      dy = Math.floor((size - nh) / 2);
    }

    // Use cached fill style
    if (pctx.fillStyle !== "rgb(114, 114, 114)") {
      pctx.fillStyle = "rgb(114,114,114)";
    }
    pctx.fillRect(0, 0, size, size);
    pctx.drawImage(video, 0, 0, vw, vh, dx, dy, nw, nh);

    const imageData = pctx.getImageData(0, 0, size, size).data; // RGBA
    const wh = size * size;

    // Reuse pre-allocated array or create new one
    if (!floatDataRef.current || floatDataRef.current.length !== 3 * wh) {
      floatDataRef.current = new Float32Array(3 * wh);
    }
    const floatData = floatDataRef.current;

    // More efficient pixel conversion - process in chunks
    let srcIdx = 0;
    const rStart = 0, gStart = wh, bStart = 2 * wh;
    for (let i = 0; i < wh; i++) {
      floatData[rStart + i] = imageData[srcIdx] / 255;     // R
      floatData[gStart + i] = imageData[srcIdx + 1] / 255; // G  
      floatData[bStart + i] = imageData[srcIdx + 2] / 255; // B
      srcIdx += 4; // skip alpha
    }

    try {
      const ort = await import("onnxruntime-web");
      const inputTensor = new ort.Tensor("float32", floatData, [1, 3, size, size]);
      const inputName = session.inputNames?.[0] ?? "images";
      const outputMap = await session.run({ [inputName]: inputTensor });
      const outTensor = Object.values(outputMap)[0] as { dims: readonly number[]; data: Float32Array };

      // ---- reshape to (N, C) ----
      const B = outTensor.dims[0], A = outTensor.dims[1], N = outTensor.dims[2];
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
      const confThres = 0.4, iouThres = 0.5; // Lower thresholds for better tracking

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

      // undo letterbox → original video coords (optimized)
      const dets: Det[] = new Array(keep.length);
      const invScale = 1 / scale;

      for (let idx = 0; idx < keep.length; idx++) {
        const i = keep[idx];
        let [x1, y1, x2, y2] = boxesXYXY[i];

        // Faster coordinate transformation
        x1 = Math.max(0, Math.min(vw - 1, (x1 - dx) * invScale));
        x2 = Math.max(0, Math.min(vw - 1, (x2 - dx) * invScale));
        y1 = Math.max(0, Math.min(vh - 1, (y1 - dy) * invScale));
        y2 = Math.max(0, Math.min(vh - 1, (y2 - dy) * invScale));

        dets[idx] = {
          bbox: [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)],
          score: scores[i],
          classId: classIds[i],
        };
      }

      // Draw detections with light temporal smoothing
      drawDetections(dets);
    } catch (err) {
      // swallow occasional frame errors to keep loop alive
      console.warn('Frame processing error:', err);
    } finally {
      // Always reset the inference flag
      isInferenceRunningRef.current = false;
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
              autoFocus={true}
              ref={webcamRef}
              audio={false}
              videoConstraints={{
                facingMode: { ideal: "environment" },
                frameRate: { ideal: 15, max: 30 },
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 }
              }}
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