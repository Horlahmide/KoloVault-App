"use client";

import { useState, Suspense, useEffect } from "react";
import { resetPassword } from "./actions";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  
  // Store token in state so we can clear the URL without losing it
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const t = searchParams.get("token");
    if (t) {
      setToken(t);
      // Remove token from URL immediately for security
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [searchParams]);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    
    // Add token to form data
    if (token) {
      formData.set("token", token);
    }

    const result = await resetPassword(formData);
    
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    } else {
      setSuccess(true);
    }
  }

  if (!token) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">Invalid Link</h1>
          <p className="text-gray-600 mb-6">The password reset link is missing a token.</p>
          <Link href="/auth/forgot-password" className="text-sm text-blue-600 hover:underline">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md text-center">
          <h1 className="text-2xl font-bold text-green-600 mb-4">Password Reset Successful!</h1>
          <p className="text-gray-600 mb-6">You can now log in with your new password.</p>
          <Link
            href="/auth/login"
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 transition"
          >
            Go to Login
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
      <div className="w-full max-w-md bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">Reset Your Password</h1>
        
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-6">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password"
              name="password"
              required
              className="w-full px-4 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Min. 12 chars, upper, lower, digit, symbol"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2 rounded-md hover:bg-blue-700 transition disabled:opacity-50"
          >
            {loading ? "Resetting..." : "Reset Password"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
