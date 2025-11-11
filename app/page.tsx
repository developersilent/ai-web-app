import { LandingPage } from "@/components/pages/landing-page";
import { SettingsPage } from "@/components/pages/settings-page";

import { CameraUIPage } from "@/components/pages/camera-eye-page";
import TestImageUpload from "@/components/pages/test";

export default function Home() {
  return (
    <>
      {/* <LandingPage/> */}
      <SettingsPage />
      <CameraUIPage/>
      {/* <TestImageUpload/>  */}
    </>
  );
}
