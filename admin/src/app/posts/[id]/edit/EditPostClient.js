"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import PostEditor from "../../../components/PostEditor";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function EditPostClient() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/api/posts/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Post not found");
        return res.json();
      })
      .then((data) => setPost(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <main className="container"><p>Loading...</p></main>;
  if (error) return <main className="container"><p>Error: {error}</p></main>;

  return (
    <main className="container">
      <div className="page-header">
        <Link href="/" className="back-link">&larr; Back to posts</Link>
        <h1>Edit Post</h1>
      </div>
      <PostEditor post={post} />
    </main>
  );
}
