export function sanitizeHtml(html) {
  if (!html) return "";

  return html
    // Remove script tags and their contents
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    // Remove event handler attributes (onclick, onload, onerror, etc.)
    .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    // Remove javascript: URLs in href/src/action attributes
    .replace(
      /(href|src|action)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi,
      '$1=""'
    )
    // Remove iframe, embed, object tags
    .replace(/<\/?(iframe|embed|object)\b[^>]*>/gi, "");
}
