"use client";

import { createContext, useContext, useState } from "react";


interface cameraType {
  cameraState:  PermissionState
  setCameraState: (cameraState: PermissionState) => void
}


const cameraCtx = createContext<cameraType | undefined>(undefined);

export function CameraPermissionProvider({children}: {children: React.ReactNode}){
  const [state, setState] = useState<PermissionState>("denied");
  const setCamState = (newState: PermissionState) => { 
    setState(newState)
  }
  return (
    <cameraCtx.Provider value={{setCameraState: setCamState, cameraState: state}}>
      {children}
    </cameraCtx.Provider>
  )
}

export function useCam(){
  const cam = useContext(cameraCtx);
  if (!cam) {
    throw new Error("not in cam Provider")
  }
  return cam;
}
