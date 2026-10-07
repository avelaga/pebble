"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useState, useRef } from "react";
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

  const editor = useEditor({
    extensions: [StarterKit, Image],
    // Never load an HTML-authored post into Tiptap — it would mangle the markup.
    content: startMode === "html" ? "" : post?.content || "",
    immediatelyRender: false,
  });

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

      if (status === "published") {
        setMessage("Published!");
      } else {
        setMessage("Draft saved!");
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

  return (
    <div className="post-editor">
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Post title"
        className="title-input"
      />
      <input
        type="text"
        value={subtitle}
        onChange={(e) => setSubtitle(e.target.value)}
        placeholder="Subtitle"
        className="subtitle-input"
      />
      <textarea
        value={previewText}
        onChange={(e) => setPreviewText(e.target.value)}
        placeholder="Preview text (shown in the blog list)"
        className="preview-input"
        rows={2}
      />
      <input
        type="text"
        value={author}
        onChange={(e) => setAuthor(e.target.value)}
        placeholder="Author"
        className="author-input"
      />
      <div className="slug-field">
        <div className="slug-input-wrap">
          <span className="slug-prefix">/</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="custom-url (optional — defaults to the title)"
            className="slug-input"
          />
        </div>
        <span className="field-hint">
          URL slug: /{toSlug(slug) || toSlug(title) || "…"}
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
              Reachable only by direct link. Left out of the post list, tags and
              sitemap, and marked noindex. Anyone with the link can still open it.
            </span>
            <button type="button" onClick={generatePrivateSlug} className="private-slug-btn">
              Generate unguessable URL
            </button>
          </>
        )}
      </div>

      <div className="editor-mode-toggle">
        <button
          type="button"
          onClick={() => switchMode("rich")}
          disabled={formatLocked}
          className={mode === "rich" ? "active" : ""}
        >
          Rich Text
        </button>
        <button
          type="button"
          onClick={() => switchMode("html")}
          disabled={formatLocked}
          className={mode === "html" ? "active" : ""}
        >
          HTML
        </button>
        {formatLocked && (
          <span className="mode-locked-note">
            Format is locked for existing posts
          </span>
        )}
      </div>

      {mode === "rich" ? (
        <>
          <div className="toolbar">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={editor?.isActive("bold") ? "active" : ""}
            >
              B
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={editor?.isActive("italic") ? "active" : ""}
            >
              I
            </button>
            <button
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
              className={editor?.isActive("heading", { level: 2 }) ? "active" : ""}
            >
              H2
            </button>
            <button
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 3 }).run()
              }
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
            <button onClick={() => fileInputRef.current?.click()}>
              Image
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageUpload}
              accept="image/jpeg,image/png,image/gif,image/webp"
              style={{ display: "none" }}
            />
          </div>

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

      <div className="editor-meta">
        <label>
          Tags (comma-separated)
          <input
            type="text"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="javascript, react, tutorial"
            className="meta-input"
          />
        </label>

        <label>
          Meta Description
          <textarea
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            placeholder="Brief description for search engines (max 300 chars)"
            maxLength={300}
            className="meta-input meta-textarea"
          />
        </label>

        <label>
          Header Image
          <div>
            <button
              type="button"
              onClick={() => ogImageInputRef.current?.click()}
              disabled={ogImageUploading}
              className="meta-input"
              style={{ cursor: "pointer", display: "inline-block", width: "auto" }}
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
              <div style={{ marginTop: "8px" }}>
                <img src={ogImage} alt="OG preview" style={{ maxHeight: "120px", borderRadius: "4px" }} />
                <button
                  type="button"
                  onClick={() => setOgImage("")}
                  style={{ display: "block", marginTop: "4px", background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, padding: 0, fontSize: "0.85em" }}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </label>
      </div>

      <div className="actions">
        <button onClick={() => savePost("draft")} disabled={saving}>
          Save Draft
        </button>
        <button
          onClick={() => savePost("published")}
          disabled={saving}
          className="publish-btn"
        >
          Publish
        </button>
        {post && (
          <button onClick={deletePost} className="delete-btn">
            Delete
          </button>
        )}
      </div>

      {message && <p className="message">{message}</p>}
    </div>
  );
}
