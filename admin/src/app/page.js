"use client";

import Link from "next/link";
import PostList from "./components/PostList";
import { useAuth } from "./components/AuthProvider";

export default function Home() {
  const { logout } = useAuth();

  return (
    <main className="container">
      <div className="header">
        <h1>Blog Admin</h1>
        <div className="header-actions">
          <Link href="/posts/new" className="new-post-btn">
            + New Post
          </Link>
          <button onClick={logout} className="logout-btn">
            Log out
          </button>
        </div>
      </div>
      <PostList />
    </main>
  );
}
