"use client";
import Link from "next/link";
import { motion } from "framer-motion";
import { Plus, Inbox } from "lucide-react";

export default function EmptyState({
  title,
  description,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  description?: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center justify-center text-center py-14"
    >
      <div className="h-14 w-14 rounded-2xl bg-brand-50 text-brand-500 flex items-center justify-center mb-4">
        <Inbox className="h-7 w-7" />
      </div>
      <p className="font-semibold text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
      {ctaHref && ctaLabel && (
        <Link href={ctaHref} className="btn-primary mt-4">
          <Plus className="h-4 w-4" /> {ctaLabel}
        </Link>
      )}
    </motion.div>
  );
}
