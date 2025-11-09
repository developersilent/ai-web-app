"use client";

import { useCam } from "@/hooks/camera-permission";
import { LoadOnnx } from "@/lib/onnx";
import { Pause, ScanLine, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import Webcam from "react-webcam";

export function CameraUIPage() {
  const { cameraState } = useCam();
  const [scan, setScan] = useState<boolean>(false);

  const handleScan = async () => {
    if (cameraState === "denied") {
      setScan(false)
      alert("Camera Access Denied !!")
    } else {
      setScan(prev => !prev)
    }
  }
  useEffect(() => {
    (async () => {
      const session = await LoadOnnx();
      if (!session) {
        alert("Failed to LoadOnnx")
      }
    })();
  }, [])
  return (
    <div className="min-h-screen overflow-hidden">
      <div className="h-16 flex items-center justify-end px-1">
        <button className="px-5 py-2 text-white/90 flex gap-2 items-center outline-none">
          <Settings />
        </button>
      </div>

      <div className="h-36 overflow-hidden flex border rounded-xl m-3 items-center justify-center">
        {scan ? (
          <Webcam audio={false} videoConstraints={
            {
              facingMode: {
                ideal: "environment"
              }
            }
          } />
        ) : (
          <p>Press the Scan to use the camera</p>
        )}

      </div>

      <div className="p-1 m-3">
        <button
          onClick={handleScan}
          className={`${scan ? "bg-red-500" : "bg-violet-500"} outline-none w-full flex items-center justify-center p-2.5 rounded-2xl`}>
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
  )
}
