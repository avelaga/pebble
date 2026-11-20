"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useState, useRef, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// A post is HTML-authored if it's a full HTML document. Used as a fallback for
// legacy posts saved before the `format` field existed.
function isFullDocument(html) {
  return /<!doctype\s+html|<html[\s>]/i.test(html || "");
}

// Mirrors the API's slug derivation so the editor can preview the auto-generated
// URL and detect whether a stored slug is a custom override.
function toSlug(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// The editing mode a post was authored in. Once set it never changes —
// converting HTML <-> rich text mangles content, so the toggle is locked
// for existing posts.
function postMode(post) {
  if (!post) return "rich";
  if (post.format === "html" || post.format === "rich") return post.format;
  return isFullDocument(post.content) ? "html" : "rich";
}

export default function PostEditor({ post }) {
  const router = useRouter();
  const { authFetch } = useAuth();
  const startMode = postMode(post);
  const formatLocked = !!post; // can only choose the format on a new post
  const [title, setTitle] = useState(post?.title || "");
  const [subtitle, setSubtitle] = useState(post?.subtitle || "");
  const [previewText, setPreviewText] = useState(post?.preview_text || "");
  const [author, setAuthor] = useState(post?.author || "");
  // Custom URL override. Empty means "derive from the title" (the default). For
  // an existing post we only prefill it when the stored slug isn't the plain
  // title-derived one — i.e. it was genuinely a custom URL.
  const [slug, setSlug] = useState(
    post?.slug && post.slug !== toSlug(post.title) ? post.slug : ""
  );
  const [tags, setTags] = useState((post?.tags || []).join(", "));
  const [metaDescription, setMetaDescription] = useState(post?.meta_description || "");
  const [ogImage, setOgImage] = useState(post?.og_image || "");
  const [isPrivate, setIsPrivate] = useState(!!post?.private);
  const [saving, setSaving] = useState(false);
  const [ogImageUploading, setOgImageUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState(startMode); // "rich" | "html" — body editor only
  const [htmlContent, setHtmlContent] = useState(post?.content || "");
  const fileInputRef = useRef(null);
  const ogImageInputRef = useRef(null);

  // The title box grows with its text, so long titles never get cut off.
  // Re-measured on every change and whenever the window resizes (which changes
  // where the title wraps).
  const titleRef = useRef(null);
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    function fit() {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 2}px`; // + top and bottom border
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [title]);

  const editor = useEditor({
    extensions: [StarterKit, Image],
    // Never load an HTML-authored post into Tiptap — it would mangle the markup.
    content: startMode === "html" ? "" : post?.content || "",
    immediatelyRender: false,
  });

  // Pasted line breaks become spaces. Handled here rather than in onChange
  // because Safari drops the text after a pasted line break in this field.
  function pasteIntoTitle(e) {
    const text = e.clipboardData.getData("text");
    if (!/\n/.test(text)) return;
    e.preventDefault();
    const el = e.target;
    const clean = text.replace(/\s*\n+\s*/g, " ");
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setTitle(title.slice(0, start) + clean + title.slice(end));
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + clean.length;
    });
  }

  // Choose the body format on a NEW post. Locked once the post exists, so an
  // HTML post can never be reopened into rich text (which would convert it).
  function switchMode(target) {
    if (formatLocked || target === mode) return;
    if (target === "html") {
      // An empty Tiptap editor still reports "<p></p>"; carrying that over would
      // wrap whatever gets pasted into the textarea in a stray paragraph.
      if (editor) setHtmlContent(editor.isEmpty ? "" : editor.getHTML());
    } else {
      editor?.commands.setContent(htmlContent || "");
    }
    setMode(target);
  }

  // Current body content regardless of which editor is active
  function getContent() {
    return mode === "html" ? htmlContent : editor?.getHTML() || "";
  }

  function parseTags(input) {
    return input
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  async function savePost(status) {
    if (!title.trim()) {
      setMessage("Title is required");
      return;
    }

    setSaving(true);
    setMessage("");

    const body = {
      title,
      subtitle,
      preview_text: previewText,
      author,
      slug: slug.trim(),
      format: mode,
      content: getContent(),
      status,
      tags: parseTags(tags),
      meta_description: metaDescription,
      og_image: ogImage,
      private: isPrivate,
    };

    try {
      const url = post
        ? `${API_URL}/api/posts/${post.id}`
        : `${API_URL}/api/posts`;
      const method = post ? "PUT" : "POST";

      const res = await authFetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const wasPublished = post?.status === "published";
      if (status === "published") {
        setMessage(wasPublished ? "Updated" : "Published");
      } else {
        setMessage(wasPublished ? "Unpublished. It's a draft now." : "Draft saved");
      }

      setTimeout(() => router.push("/"), 1500);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  // A private post is only as private as its URL, so it gets a random suffix
  // nobody can guess from the title.
  function generatePrivateSlug() {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    setSlug(`${toSlug(slug) || toSlug(title) || "post"}-${suffix}`);
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);

    try {
      setMessage("Uploading image...");
      const res = await authFetch(`${API_URL}/api/uploads`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const { url } = await res.json();
      editor.chain().focus().setImage({ src: url }).run();
      setMessage("");
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }

    e.target.value = "";
  }

  async function handleOgImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("image", file);

    try {
      setOgImageUploading(true);
      const res = await authFetch(`${API_URL}/api/uploads`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const { url } = await res.json();
      setOgImage(url);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setOgImageUploading(false);
    }

    e.target.value = "";
  }

  async function deletePost() {
    if (!post) return;
    if (!confirm(`Delete "${post.title}"? This cannot be undone.`)) return;

    try {
      const res = await authFetch(`${API_URL}/api/posts/${post.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      router.push("/");
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  const isPublished = post?.status === "published";

  return (
    <div className="post-editor">
      {/* The writing comes first: title, subtitle, body */}
      {/* Title and Body have no visible label: the big bold line and the
          writing box with its toolbar explain themselves. The labels stay for
          screen readers. The fields below look alike, so they keep theirs. */}
      <label className="field-label">
        <span className="visually-hidden">Title</span>
        {/* A one-line title that wraps: Enter doesn't add a line break, and
            pasted line breaks become spaces */}
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\s*\n+\s*/g, " "))}
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
          onPaste={pasteIntoTitle}
          placeholder="Title"
          className="title-input"
        />
      </label>
      <label className="field-label">
        Subtitle
        <input
          type="text"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          placeholder="Optional"
          className="subtitle-input"
        />
      </label>
      <label className="field-label">
        Author
        <input
          type="text"
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          className="author-input"
        />
      </label>

      <div className="field-group">
        <span className="visually-hidden">Body</span>
        {/* The format can only be chosen on a new post; once a post exists it's
            locked, and the toolbar or the code view already shows which it is */}
        {/* One bar above the body: formatting tools on the left (rich text),
            and on a new post the Rich Text / HTML switch on the right */}
        {(mode === "rich" || !formatLocked) && (
          <div className="body-bar">
            {mode === "rich" && (
              <div className="toolbar">
                <button
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  className={`tb-bold ${editor?.isActive("bold") ? "active" : ""}`}
                >
                  B
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  className={`tb-italic ${editor?.isActive("italic") ? "active" : ""}`}
                >
                  I
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                  className={editor?.isActive("heading", { level: 2 }) ? "active" : ""}
                >
                  H2
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                  className={editor?.isActive("heading", { level: 3 }) ? "active" : ""}
                >
                  H3
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  className={editor?.isActive("bulletList") ? "active" : ""}
                >
                  List
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleCodeBlock().run()}
                  className={editor?.isActive("codeBlock") ? "active" : ""}
                >
                  Code
                </button>
                <button
                  onClick={() => editor.chain().focus().toggleBlockquote().run()}
                  className={editor?.isActive("blockquote") ? "active" : ""}
                >
                  Quote
                </button>
                <button onClick={() => fileInputRef.current?.click()}>Image</button>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  style={{ display: "none" }}
                />
              </div>
            )}
            {!formatLocked && (
              <div className="editor-mode-toggle">
                <button
                  type="button"
                  onClick={() => switchMode("rich")}
                  className={mode === "rich" ? "active" : ""}
                >
                  Rich Text
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("html")}
                  className={mode === "html" ? "active" : ""}
                >
                  HTML
                </button>
              </div>
            )}
          </div>
        )}

        {mode === "rich" ? (
          <>
            <EditorContent editor={editor} className="editor-content" />
          </>
        ) : (
          <textarea
            value={htmlContent}
            onChange={(e) => setHtmlContent(e.target.value)}
            className="html-editor"
            spellCheck={false}
            placeholder="<p>Write raw HTML…</p>"
          />
        )}
      </div>

      <label className="field-label">
        Preview text
        <textarea
          value={previewText}
          onChange={(e) => setPreviewText(e.target.value)}
          placeholder="Shown under the title in the blog list"
          className="preview-input"
          rows={2}
        />
      </label>

      {/* Behind-the-scenes settings only. Fields readers see on the site
          (author byline, preview text in the blog list) live above with the post. */}
      <section className="editor-meta">
        <h2 className="section-label">
          Settings <span className="section-hint">Optional</span>
        </h2>

        <div className="field-label slug-field">
          URL
          <div className="slug-input-wrap">
            <span className="slug-prefix">/</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="Optional. Defaults to the title"
              className="slug-input"
              aria-label="URL"
            />
          </div>
          <span className="field-hint">
            This post's address: /{toSlug(slug) || toSlug(title) || "…"}
          </span>
        </div>

        <div className="private-field">
          <label className="private-toggle">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private (unlisted)
          </label>
          {isPrivate && (
            <>
              <span className="field-hint">
                Reachable by direct link only. Left out of the post list and
                sitemap, and marked noindex. Anyone with the link can open it.
              </span>
              <button type="button" onClick={generatePrivateSlug} className="private-slug-btn">
                Generate unguessable URL
              </button>
            </>
          )}
        </div>

        <label className="field-label">
          Tags
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="Separate with commas"
            className="meta-input"
          />
        </label>

        <label className="field-label">
          Search description
          <textarea
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            placeholder="What search engines show under the link. Up to 300 characters."
            maxLength={300}
            className="meta-input meta-textarea"
          />
        </label>

        <div className="field-label">
          Header image
          <div className="og-image-field">
            <button
              type="button"
              onClick={() => ogImageInputRef.current?.click()}
              disabled={ogImageUploading}
            >
              {ogImageUploading ? "Uploading..." : ogImage ? "Replace image" : "Upload image"}
            </button>
            <input
              type="file"
              ref={ogImageInputRef}
              onChange={handleOgImageUpload}
              accept="image/jpeg,image/png,image/gif,image/webp"
              style={{ display: "none" }}
            />
            {ogImage && (
              <>
                <img src={ogImage} alt="Header image preview" className="og-preview" />
                <button type="button" onClick={() => setOgImage("")} className="text-btn">
                  Remove
                </button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* At the end of the page, after the optional card, so you scroll past
          everything before saving. Buttons say what will happen to this post:
          a published post is updated or unpublished, never quietly turned
          back into a draft by a "Save draft" button. */}
      <div className="actions">
        {isPublished ? (
          <>
            <button onClick={() => savePost("published")} disabled={saving} className="publish-btn">
              Update
            </button>
            <button onClick={() => savePost("draft")} disabled={saving}>
              Unpublish
            </button>
          </>
        ) : (
          <>
            <button onClick={() => savePost("published")} disabled={saving} className="publish-btn">
              Publish
            </button>
            <button onClick={() => savePost("draft")} disabled={saving}>
              Save draft
            </button>
          </>
        )}
        {message && (
          <p className={`message ${messageTone(message)}`} role="status">
            {message}
          </p>
        )}
        {post && (
          <button onClick={deletePost} className="delete-btn">
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// Green for a finished save, red for anything that went wrong
function messageTone(message) {
  if (/^Error|required/i.test(message)) return "error";
  if (/^(Published|Updated|Draft saved|Unpublished)/.test(message)) return "success";
  return "";
}
