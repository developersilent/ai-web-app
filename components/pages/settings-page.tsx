"use client";

import { Camera, ChevronLeft, Languages } from "lucide-react";
import { Switch } from "../ui/switch";

import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import { languages } from "@/lib/lang";
import { useEffect, useState } from "react";
import { useCam } from "@/hooks/camera-permission";


export function SettingsPage() {
  const [lang, setLang] = useState<typeof languages[0]>({ code: "eng", label: "English" });
  const { cameraState, setCameraState } = useCam();

  useEffect(() => {
    (async () => {
      if (navigator.permissions) {
        const getcamInfo = await navigator.permissions.query({ name: "camera" });
        setCameraState(getcamInfo.state)
        getcamInfo.onchange = () => {
          setCameraState(getcamInfo.state)
        }
      } else {
        alert("ERROR: Not Supported !!")
      }
    })()
  }, [cameraState, setCameraState])

  const handleCamToggle = async () => {
    if (cameraState === "prompt") {
      try {
        const getcam = await navigator.mediaDevices.getUserMedia({
          video: true
        })
        getcam.getTracks().forEach(s => s.stop())
        setCameraState("granted")
      } catch (err) {
        setCameraState("denied")
      }

    } else if (cameraState === "denied") {
      alert("Please change the permissions from browser setting.")
    }
  }

  console.log(cameraState)
  return (
    <div className="min-h-screen overflow-hidden">
      {/* header  */}
      <div className="h-20 flex items-center px-1">
        <button className="px-5 py-2 text-white/90 flex gap-2 items-center outline-none">
          <ChevronLeft />
          <p className="text-base font-medium">Settings</p>
        </button>
      </div>
      <div className="border m-5 rounded-2xl flex flex-col">
        <p className="text-xs px-3 p-3 m-2 mb-0">Permissions</p>
        {/* Camera */}
        <div className="flex items-center justify-between mb-3 p-3 mx-3 gap-3 rounded-xl">
          <div className="flex items-center h-full gap-3">
            <Camera className="w-5 h-5 text-white/90" />
            <p className="font-medium text-sm h-full">Camera</p>
          </div>
          <Switch checked={cameraState === "granted"} onCheckedChange={() => {
            handleCamToggle()
          }} />
        </div>
      </div>

      {/* Preference */}
      <div className="border m-5 rounded-2xl flex flex-col">
        <p className="text-xs px-3 p-3 m-2 mb-0">Preference</p>


        <Drawer>
          <DrawerTrigger className="outline-none">
            <div className="flex items-center mb-3 p-3 mx-3 gap-3 rounded-xl">
              <Languages className="w-5 h-5" />
              <p className="font-medium text-sm">Language

                <span className="text-violet-400 mx-2">({lang.code})</span>
              </p>
            </div>
          </DrawerTrigger>
          <DrawerContent>

            <DrawerTitle className="hidden">{""}</DrawerTitle>
            <div className="px-3 py-7">
              {languages.map(lang => (
                <DrawerClose onClick={() => {
                  setLang({
                    label: lang.label,
                    code: lang.code
                  })
                }} key={lang.code} className="flex items-center mb-1 p-3 mx-3 gap-3 border-b w-[90%]">
                  <div>
                    <p className="font-medium text-sm">{lang.label}
                      <span className="text-violet-400 mx-2">({lang.code})</span>
                    </p>
                  </div>
                </DrawerClose>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      </div>

    </div>
  )
}
