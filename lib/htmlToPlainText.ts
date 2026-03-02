// lib/htmlToPlainText.ts

export function htmlToPlainText(html: string): string {
  if (!html) return "";

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // Remove script/style just in case
    doc.querySelectorAll("script, style").forEach((n) => n.remove());

    const out: string[] = [];

    const walk = (node: Node) => {
      // Text node
      if (node.nodeType === Node.TEXT_NODE) {
        out.push((node as Text).data);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as HTMLElement;
      const tag = el.tagName.toLowerCase();

      if (tag === "br") {
        out.push("\n");
        return;
      }

      if (tag === "li") {
        out.push("\n• ");
        Array.from(el.childNodes).forEach(walk);
        return;
      }

      if (
        tag === "p" ||
        tag === "div" ||
        tag === "section" ||
        tag === "article"
      ) {
        out.push("\n");
        Array.from(el.childNodes).forEach(walk);
        out.push("\n");
        return;
      }

      if (tag === "ul" || tag === "ol") {
        out.push("\n");
        Array.from(el.childNodes).forEach(walk);
        out.push("\n");
        return;
      }

      Array.from(el.childNodes).forEach(walk);
    };

    Array.from(doc.body.childNodes).forEach(walk);

    let text = out.join("");

    // Clean up spacing but PRESERVE line breaks
    text = text.replace(/\r/g, "");
    text = text.replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n");
    text = text.replace(/\n{3,}/g, "\n\n");

    return text.trim();
  } catch {
    return html;
  }
}

export function truncate(s: string, max = 180): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}