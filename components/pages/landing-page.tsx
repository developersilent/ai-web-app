"use client";

import { ChevronRight } from "lucide-react";
import landingImg from "@/public/assets/landing-img.png";
import Image from "next/image";
import Link from "next/link";

export function LandingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen pb-10 overflow-hidden">
      {/* Lgog */}
      <div>
        <Image
          src={landingImg.src}
          alt="landingImg"
          width={300}
          height={300}
        />
      </div>
      <Link href="/video"  className="bg-violet-400 w-7/12 flex items-center justify-center p-2.5 rounded-4xl">
        <button   
        >
          <ChevronRight className="text-black/80" />
        </button>
      </Link>

    </div>
  )
}
