"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "./AuthProvider";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function PostList() {
  const { authFetch } = useAuth();
  const [posts, setPosts] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  async function fetchPosts(p = 1) {
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/api/posts?status=all&page=${p}&limit=20`);
      const data = await res.json();
      setPosts(data.posts);
      setPagination(data.pagination);
    } catch (err) {
      console.error("Failed to fetch posts:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchPosts(page);
  }, [page]);

  async function deletePost(id, title) {
    if (!confirm(`Delete "${title}"? This cannot be undone.`)) return;
    try {
      const res = await authFetch(`${API_URL}/api/posts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      window.dispatchEvent(new Event("pebble:content-changed"));
      fetchPosts(page);
    } catch (err) {
      console.error("Failed to delete post:", err);
    }
  }

  async function toggleStatus(id, currentStatus) {
    const newStatus = currentStatus === "published" ? "draft" : "published";
    try {
      const res = await authFetch(`${API_URL}/api/posts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      window.dispatchEvent(new Event("pebble:content-changed"));
      fetchPosts(page);
    } catch (err) {
      console.error("Failed to update post status:", err);
    }
  }

  if (loading) return <p className="loading label">Loading posts…</p>;

  if (posts.length === 0 && page === 1) {
    return <p className="empty-state">No posts yet. Create your first one!</p>;
  }

  return (
    <div>
      <div className="post-table-wrapper">
        <table className="post-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Author</th>
              <th>Status</th>
              <th>Tags</th>
              <th>Created</th>
              <th className="col-actions">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {posts.map((post) => {
              const published = post.status === "published";
              return (
                <tr key={post.id}>
                  <td className="col-title">
                    <Link href={`/posts/${post.id}/edit`}>{post.title}</Link>
                  </td>
                  <td className="col-author">
                    {/* One line, truncated; the full name shows on hover */}
                    <span title={post.author || undefined}>{post.author || "—"}</span>
                  </td>
                  <td className="col-status">
                    <span className="badges">
                      <span className={`badge ${published ? "published" : "draft"}`}>
                        {published ? "Published" : "Draft"}
                      </span>
                      {post.private && <span className="badge private">Private</span>}
                    </span>
                  </td>
                  <td className="col-tags">
                    <div className="tag-list">
                      {(post.tags || []).map((tag) => (
                        <span key={tag} className="tag">{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td className="col-date">{formatDate(post.created_at)}</td>
                  <td className="col-actions">
                    <div className="table-actions">
                      <Link href={`/posts/${post.id}/edit`} className="button small edit-btn">
                        Edit
                      </Link>
                      <button
                        className={`small toggle-btn ${published ? "" : "publish-outline-btn"}`}
                        onClick={() => toggleStatus(post.id, post.status)}
                      >
                        {published ? "Unpublish" : "Publish"}
                      </button>
                      <button
                        className="small delete-btn"
                        onClick={() => deletePost(post.id, post.title)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pagination && pagination.pages > 1 && (
        <div className="pagination">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="page-info">
            Page {pagination.page} of {pagination.pages}
          </span>
          <button disabled={page >= pagination.pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// "Oct 6, 2026" rather than 10/6/2026, which reads as June 10 in much of the world
function formatDate(createdAt) {
  return new Date(createdAt + "Z").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
