"use client";

import { useState } from "react";
import { handleLogoutEverywhere } from "./actions";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function onLogoutEverywhere() {
    if (!confirm("Are you sure you want to log out from all devices?")) return;
    
    setLoading(true);
    setError(null);
    
    const result = await handleLogoutEverywhere();
    
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      router.push("/auth/login");
      router.refresh();
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8">
      <header className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600">Manage your account security</p>
        </div>
        <Link href="/dashboard" className="text-blue-600 hover:underline font-medium">
          Back to Dashboard
        </Link>
      </header>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Security</h2>
          <p className="text-sm text-gray-500">Manage your active sessions and security preferences.</p>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Log out everywhere</h3>
              <p className="text-sm text-gray-500">This will terminate all your active sessions on all devices.</p>
            </div>
            <button
              onClick={onLogoutEverywhere}
              disabled={loading}
              className="bg-red-50 text-red-600 px-4 py-2 rounded-md text-sm font-semibold hover:bg-red-100 transition disabled:opacity-50"
            >
              {loading ? "Logging out..." : "Log out everywhere"}
            </button>
          </div>
          
          {error && (
            <p className="text-red-600 text-sm mt-2">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
