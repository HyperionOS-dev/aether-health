import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  GoogleAuthProvider, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup,
} from "firebase/auth";
import { LogIn, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";
import { fb } from "@/lib/firebase/config";
import { safeReturnTo } from "@/lib/authReturnTo";

const COPY = {
  signin: { title: "Welcome back", cta: "Log in", alt: ["Create an account", "/register"] },
  signup: { title: "Create account", cta: "Sign up", alt: ["Have an account? Log in", "/login"] },
  reset: { title: "Reset password", cta: "Send reset link", alt: ["Back to login", "/login"] },
};

export default function FirebaseLogin({ mode = "signin" }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);
  const { auth } = fb();
  const copy = COPY[mode];
  const done = () => (window.location.href = safeReturnTo());

  async function run(fn) {
    setError("");
    setLoading(true);
    try { await fn(); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }

  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        return setNotice("If that email has an account, a reset link is on its way.");
      }
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(cred.user);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      done();
    });
  };

  return (
    <AuthLayout icon={LogIn} title={copy.title} footer={<Link to={copy.alt[1]} className="text-primary font-medium hover:underline">{copy.alt[0]}</Link>}>
      {mode !== "reset" && (
        <Button variant="outline" className="w-full h-12 mb-6" onClick={() => run(async () => { await signInWithPopup(auth, new GoogleAuthProvider()); done(); })}>
          <GoogleIcon className="w-5 h-5 mr-2" /> Continue with Google
        </Button>
      )}
      {error && <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>}
      {notice && <div className="mb-4 p-3 rounded-lg bg-secondary text-sm">{notice}</div>}
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" className="h-12" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode !== "reset" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              {mode === "signin" && <Link to="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>}
            </div>
            <Input id="password" type="password" className="h-12" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          </div>
        )}
        <Button type="submit" className="w-full h-12" disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {copy.cta}
        </Button>
      </form>
    </AuthLayout>
  );
}