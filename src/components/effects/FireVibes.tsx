"use client";

/**
 * Purely-for-the-vibes fire animation: a full-width lottie pinned to the
 * bottom edge of the screen. Toggled from Settings, persisted per-browser.
 *
 * lottie-web is imported lazily (only when first enabled) so it never ships
 * weight to anyone who keeps it off, and is mounted with pointer-events:none
 * so it can't intercept clicks on the board beneath it.
 */

import { useEffect, useRef, useState } from "react";
import type { AnimationItem } from "lottie-web";
import { usePrefs } from "@/store/prefs";

export function FireVibes() {
  const fireVibes = usePrefs((s) => s.fireVibes);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<AnimationItem | null>(null);
  const [mounted, setMounted] = useState(false);

  // Avoid SSR/CSR mismatch: localStorage-backed prefs only resolve on the client.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted || !fireVibes) return;
    let disposed = false;

    void (async () => {
      // Both the player and the (large) animation data are code-split into
      // their own chunks, fetched only the first time the vibes are enabled.
      const [{ default: lottie }, anim] = await Promise.all([
        import("lottie-web"),
        import("@/assets/fire.json"),
      ]);
      if (disposed || !containerRef.current) return;
      animRef.current = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        animationData: anim.default,
        // Fill the full width and anchor to the bottom edge, cropping the top
        // (the mask then fades whatever's left). The source is 16:9.
        rendererSettings: { preserveAspectRatio: "xMidYMax slice" },
      });
    })();

    return () => {
      disposed = true;
      animRef.current?.destroy();
      animRef.current = null;
    };
  }, [mounted, fireVibes]);

  if (!mounted || !fireVibes) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-40 overflow-hidden"
      style={{
        maskImage: "linear-gradient(to top, black 55%, transparent)",
        WebkitMaskImage: "linear-gradient(to top, black 55%, transparent)",
      }}
    >
      <div ref={containerRef} className="h-full w-full opacity-90" />
    </div>
  );
}
