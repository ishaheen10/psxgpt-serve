import type { SourcePreview } from "../types";
export function rowToSource(row: Record<string, unknown>): SourcePreview {
  if (row.source_doc || row.doc_type) {
    const sourceDoc = String(row.source_doc || "").trim();
    const chapter = String(row.chapter || "").trim();
    const pageNumber = Number(row.page_num) || 0;
    const pageFile = `page_${String(pageNumber).padStart(3, "0")}`;
    const rel = [sourceDoc, chapter, pageFile].filter(Boolean).join("/");
    const base = "https://source.psxgpt.com";
    const docType = String(row.doc_type || "macro").replace(/_/g, " ");
    const fiscalYear = String(row.fiscal_year || "");
    const contentType = String(row.content_type || "text");
    return {
      id: `macro:${String(row.id ?? "")}`,
      sourceType: "macro",
      ticker: docType.toUpperCase(),
      filingType: contentType === "table" ? "Macro table" : "Macro text",
      filingPeriod: fiscalYear,
      filingYear: fiscalYear,
      sourceDoc,
      docType: String(row.doc_type || "macro"),
      pageNumber,
      pdfUrl: rel ? `${base}/MACRO_PAGES/${rel}.pdf` : null,
      thumbnailUrl: rel ? `${base}/MACRO_THUMBNAILS/${rel}.jpg` : null,
      snippet:
        `${docType} ${fiscalYear}${chapter ? ` ${chapter}` : ""} p.${pageNumber}`.trim(),
    };
  }
  if (row.announcement_date || row.direct_url || row.local_path) {
    const ticker = String(row.ticker || "").toUpperCase();
    const date = String(row.announcement_date || "");
    const title = String(row.title || "PSX announcement");
    const localPath = String(row.local_path || "").replace(
      /^announcement_documents\//,
      "",
    );
    const isPdf =
      /\.pdf$/i.test(localPath) || /pdf/i.test(String(row.content_type || ""));
    const isImage =
      /^image\//i.test(String(row.content_type || "")) ||
      /\.(gif|jpe?g|png|webp)$/i.test(localPath);
    const publicBase = "https://source.psxgpt.com";
    const publicAssetUrl = localPath
      ? `${publicBase}/ANNOUNCEMENTS/${localPath}`
      : "";
    const publicThumbUrl =
      isPdf && localPath
        ? `${publicBase}/ANNOUNCEMENT_THUMBNAILS/${localPath.replace(/\.pdf$/i, ".jpg")}`
        : "";
    const directUrl =
      publicAssetUrl ||
      String(row.direct_url || row.source_url || "").trim() ||
      null;
    return {
      id: `announcement:${String(row.id ?? "")}`,
      sourceType: "announcement",
      ticker,
      filingType: "Announcement",
      filingPeriod: date,
      filingYear: date.slice(0, 4),
      pageNumber: null,
      pdfUrl: directUrl,
      thumbnailUrl: publicThumbUrl || (isImage ? publicAssetUrl : null),
      snippet:
        `${ticker} ${date}${row.announcement_time ? ` ${row.announcement_time}` : ""}: ${title}`.trim(),
    };
  }
  const jpgPath = String(row.jpg_path || "");
  const base = "https://source.psxgpt.com";
  const ticker = String(row.ticker || "");
  const pageNumber = Number(row.pg) || 0;
  const retrievalSnippet = String(row.search_text || row.content || "")
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: String(row.id ?? ""),
    sourceType: "filing",
    ticker,
    filingType: String(row.filing_type || ""),
    filingPeriod: String(row.filing_period || ""),
    filingYear: String(row.filing_year || ""),
    pageNumber,
    pdfUrl: `${base}/PDF_PAGES/${jpgPath.replace(/\.jpg$/, ".pdf")}`,
    thumbnailUrl: `${base}/PDF_THUMBNAILS/${jpgPath}`,
    snippet:
      retrievalSnippet ||
      `${ticker} ${row.filing_type || ""} ${row.filing_period || ""} p.${pageNumber}`.trim(),
  };
}
