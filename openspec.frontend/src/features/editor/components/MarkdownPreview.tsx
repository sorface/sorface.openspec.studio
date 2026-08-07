"use client";

import { useEffect, useRef, useState } from "react";
import type { Crepe } from "@milkdown/crepe";

interface MarkdownPreviewProps {
  documentId: string;
  markdown: string;
}

export function MarkdownPreview({ documentId, markdown }: MarkdownPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const markdownRef = useRef(markdown);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    markdownRef.current = markdown;
    const crepe = crepeRef.current;
    if (!crepe || crepe.getMarkdown() === markdown) return;

    void import("@milkdown/kit/utils").then(({ replaceAll }) => {
      if (crepeRef.current !== crepe || markdownRef.current !== markdown) return;
      crepe.editor.action(replaceAll(markdown));
    });
  }, [markdown]);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;

    async function initialize() {
      const root = rootRef.current;
      if (!root) return;

      try {
        const { Crepe } = await import("@milkdown/crepe");
        if (disposed) return;

        const crepe = new Crepe({
          root,
          defaultValue: markdownRef.current,
          features: {
            [Crepe.Feature.Cursor]: false,
            [Crepe.Feature.LinkTooltip]: false,
            [Crepe.Feature.ImageBlock]: false,
            [Crepe.Feature.BlockEdit]: false,
            [Crepe.Feature.Toolbar]: false,
            [Crepe.Feature.Placeholder]: false,
            [Crepe.Feature.Latex]: false,
            [Crepe.Feature.TopBar]: false,
            [Crepe.Feature.AI]: false,
          },
        }).setReadonly(true);

        await crepe.create();
        if (disposed) {
          await crepe.destroy();
          return;
        }

        crepeRef.current = crepe;
        destroy = () => {
          crepeRef.current = null;
          void crepe.destroy();
        };
        setStatus("ready");
      } catch {
        if (!disposed) setStatus("failed");
      }
    }

    void initialize();
    return () => {
      disposed = true;
      destroy?.();
    };
  }, [documentId]);

  return (
    <div className="markdown-preview" data-preview-status={status} role="document" aria-label="Предпросмотр Markdown">
      <div ref={rootRef} className="markdown-preview-root" />
      {status === "loading" && (
        <p className="preview-state">
          <span className="editor-bird-loader" aria-hidden="true">
            <svg viewBox="0 0 40 24"><path d="M3 13c8.4-6.4 15.3-7.1 20.8-2.1C27.4 6.4 32 4.2 37.6 4.4c-4 3.1-6.5 6.4-7.6 9.8 2.7.5 5.1 1.5 7.2 3-6.7.9-12.3-.1-16.8-3C15 17.9 9.2 17.5 3 13Z" /></svg>
          </span>
          <span>Подготавливаем предпросмотр…</span>
        </p>
      )}
      {status === "failed" && <p className="preview-state error" role="alert">Не удалось отобразить Markdown.</p>}
    </div>
  );
}
