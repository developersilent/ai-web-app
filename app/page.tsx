import { LandingPage } from "@/components/pages/landing-page";
import { SettingsPage } from "@/components/pages/settings-page";

import { CameraUIPage } from "@/components/pages/camera-eye-page";

export default function Home() {
  return (
    <>
      {/* <LandingPage/> */}
      <SettingsPage />
      <CameraUIPage/>
    </>
  );
}
