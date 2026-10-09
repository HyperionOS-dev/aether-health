import React, { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { AuthContext } from "@/lib/authContextObject";
import { fb } from "@/lib/firebase/config";

// Fills the same context AuthProvider does, so ProtectedRoute and useAuth() are unchanged.
export default function FirebaseAuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [checked, setChecked] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(fb().auth, (u) => {
        setUser(u ? { id: u.uid, email: u.email, full_name: u.displayName || "" } : null);
        setChecked(true);
      }),
    []
  );

  const navigateToLogin = () => {
    window.location.href = `/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  };
  const logout = async () => {
    await signOut(fb().auth);
    navigateToLogin();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoadingAuth: !checked,
        isLoadingPublicSettings: false,
        authError: null,
        appPublicSettings: null,
        authChecked: checked,
        logout,
        navigateToLogin,
        checkUserAuth: () => {},
        checkAppState: () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}