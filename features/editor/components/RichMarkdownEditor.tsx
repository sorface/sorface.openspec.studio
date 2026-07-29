"use client";

import { useEffect, useRef, useState } from "react";

interface RichMarkdownEditorProps {
  documentId: string;
  markdown: string;
  onBlur: () => void;
  onChange: (markdown: string) => void;
}

export function RichMarkdownEditor({ documentId, markdown, onBlur, onChange }: RichMarkdownEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onBlurRef = useRef(onBlur);
  const onChangeRef = useRef(onChange);
  const initialMarkdownRef = useRef(markdown);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    onBlurRef.current = onBlur;
    onChangeRef.current = onChange;
    initialMarkdownRef.current = markdown;
  }, [markdown, onBlur, onChange]);

  useEffect(() => {
    let disposed = false;
    let destroy: (() => void) | undefined;

    async function initialize() {
      const root = rootRef.current;
      if (!root) return;

      try {
        const { Crepe } = await import("@milkdown/crepe");
        if (disposed) return;

        const editor = new Crepe({
          root,
          defaultValue: initialMarkdownRef.current,
          features: {
            [Crepe.Feature.TopBar]: true,
            [Crepe.Feature.Latex]: false,
            [Crepe.Feature.AI]: false,
          },
          featureConfigs: {
            [Crepe.Feature.Placeholder]: {
              text: "Начните писать или нажмите «/», чтобы добавить блок…",
              mode: "doc",
            },
            [Crepe.Feature.LinkTooltip]: {
              inputPlaceholder: "Вставьте ссылку",
            },
          },
        });

        editor.on((listener) => {
          listener.markdownUpdated((_context, nextMarkdown, previousMarkdown) => {
            if (nextMarkdown !== previousMarkdown) onChangeRef.current(nextMarkdown);
          });
          listener.blur(() => onBlurRef.current());
        });

        await editor.create();
        if (disposed) {
          editor.destroy();
          return;
        }
        destroy = () => editor.destroy();
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
    <div className="rich-editor-shell" data-editor-status={status}>
      <div
        ref={rootRef}
        className="rich-editor-root"
        role="textbox"
        aria-label="Визуальный Markdown-редактор"
        aria-multiline="true"
      />
      {status === "loading" && <div className="editor-loading">Подготавливаем визуальный редактор…</div>}
      {status === "failed" && (
        <div className="editor-error" role="alert">
          Редактор не загрузился. Обновите страницу — черновик не потерян.
        </div>
      )}
    </div>
  );
}
