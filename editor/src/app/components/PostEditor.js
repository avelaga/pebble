"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function PostEditor({ post }) {
  const router = useRouter();
  const { authFetch } = useAuth();
  const [title, setTitle] = useState(post?.title || "");
  const [tags, setTags] = useState((post?.tags || []).join(", "));
  const [metaDescription, setMetaDescription] = useState(post?.meta_description || "");
  const [ogImage, setOgImage] = useState(post?.og_image || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef(null);

  const editor = useEditor({
    extensions: [StarterKit, Image],
    content: post?.content || "",
    immediatelyRender: false,
  });

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
      content: editor.getHTML(),
      status,
      tags: parseTags(tags),
      meta_description: metaDescription,
      og_image: ogImage,
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
          OG Image URL
          <input
            type="text"
            value={ogImage}
            onChange={(e) => setOgImage(e.target.value)}
            placeholder="https://example.com/image.jpg"
            className="meta-input"
          />
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
