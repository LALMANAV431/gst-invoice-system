"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function PwaSetup() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Register the service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    // Capture the install prompt
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      // Only nudge if not already dismissed this session
      if (!sessionStorage.getItem("pwa-dismissed")) setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function install() {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
    setShow(false);
  }

  function dismiss() {
    setShow(false);
    sessionStorage.setItem("pwa-dismissed", "1");
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-md"
        >
          <div className="card card-padding shadow-2xl flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold shrink-0">
              G
            </div>
            <div className="flex-1">
              <div className="font-semibold text-sm">Install GST Books</div>
              <div className="text-xs text-slate-500">Add to home screen for app-like access</div>
            </div>
            <button className="btn-primary !py-2 !px-3" onClick={install}>
              <Download className="h-4 w-4" /> Install
            </button>
            <button className="btn-ghost p-2" onClick={dismiss} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
