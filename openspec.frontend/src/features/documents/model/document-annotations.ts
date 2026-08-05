import type { DocumentAnnotationEntry } from "@/features/documents/model/document-types";

export interface DocumentAnnotationLine {
  lineNumber: number;
  content: string;
  hash?: string;
  shortHash?: string;
  author: string;
  authorEmail?: string;
  authoredAt?: string;
  subject: string;
  local: boolean;
  groupStart: boolean;
}

export function expandDocumentAnnotations(entries: DocumentAnnotationEntry[]): DocumentAnnotationLine[] {
  return entries.flatMap((entry) => entry.lines.map((content, index) => ({
    lineNumber: entry.startLine + index,
    content,
    hash: entry.hash,
    shortHash: entry.shortHash,
    author: entry.author,
    authorEmail: entry.authorEmail,
    authoredAt: entry.authoredAt,
    subject: entry.subject,
    local: entry.local,
    groupStart: index === 0,
  })));
}
