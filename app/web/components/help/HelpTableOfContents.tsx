"use client";

import { useEffect, useState } from "react";
import { TOC_SECTIONS } from "./helpData";

export function HelpTableOfContents() {
  const [activeId, setActiveId] = useState<string>("");

  useEffect(() => {
    const sectionIds = TOC_SECTIONS.map((s) => s.id);

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the first entry that is intersecting (topmost visible section)
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      {
        rootMargin: "-80px 0px -60% 0px",
        threshold: 0,
      }
    );

    sectionIds.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Table of contents" className="hidden lg:block">
      <div className="sticky top-20 w-[220px]">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-2">
          On this page
        </p>
        <ul className="space-y-0.5">
          {TOC_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className={`block px-3 py-1.5 rounded-md text-sm transition-colors ${
                  activeId === section.id
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
