"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { LandingTide } from "./landing-tide";
import { parseReminder } from "./parse-reminder";

const examples = [
  { label: "Send the draft Friday", text: "Remind me Friday at 4 PM to send the draft" },
  { label: "Study in 20 minutes", text: "Remind me in 20 minutes to study" },
  { label: "Call Mom tomorrow", text: "Remind me to call Mom tomorrow at 9 AM" },
];

const subscribe = () => () => {};
const getSignInFailed = () => new URLSearchParams(window.location.search).get("signin") === "failed";

const previewTime = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function GoogleMark() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 48 48">
      <path fill="#4285F4" d="M43.61 24.46c0-1.36-.12-2.66-.35-3.92H24v7.43h11.03a9.43 9.43 0 0 1-4.09 6.19v5.15h6.62c3.87-3.56 6.05-8.8 6.05-14.85z" />
      <path fill="#34A853" d="M24 44c5.51 0 10.14-1.82 13.53-4.69l-6.62-5.15c-1.82 1.22-4.16 1.94-6.91 1.94-5.34 0-9.87-3.6-11.49-8.44H5.68v5.31A20 20 0 0 0 24 44z" />
      <path fill="#FBBC05" d="M12.51 27.66a12 12 0 0 1 0-7.32v-5.31H5.68a20 20 0 0 0 0 17.94z" />
      <path fill="#EA4335" d="M24 11.9c3 0 5.68 1.03 7.8 3.05l5.85-5.86C34.12 5.81 29.5 4 24 4A20 20 0 0 0 5.68 15.03l6.83 5.31C14.13 15.5 18.66 11.9 24 11.9z" />
    </svg>
  );
}

export function Landing() {
  const [exampleIndex, setExampleIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [interacting, setInteracting] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [preview, setPreview] = useState<{ task: string; time: string } | null>(null);
  const [error, setError] = useState("");
  const signInFailed = useSyncExternalStore(subscribe, getSignInFailed, () => false);
  const example = examples[exampleIndex];

  useEffect(() => {
    const controller = new AbortController();
    async function checkSession() {
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const { user }: { user: object | null } = await response.json();
        if (!controller.signal.aborted) setSignedIn(Boolean(user));
      } catch {
        // The landing page and its local preview are available without the API.
      }
    }
    function recheckSession(event: PageTransitionEvent) {
      if (event.persisted) void checkSession();
    }
    void checkSession();
    window.addEventListener("pageshow", recheckSession);
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", recheckSession);
    };
  }, []);

  useEffect(() => {
    if (interacting || draft || preview) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(() => {
      if (!motion.matches && !document.hidden) {
        setExampleIndex((index) => (index + 1) % examples.length);
      }
    }, 5400);
    return () => window.clearInterval(timer);
  }, [draft, interacting, preview]);

  function previewReminder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseReminder(draft.trim() || example.text);
    setInteracting(true);
    setPreview(null);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (!Number.isFinite(new Date(parsed.remindAt).getTime())) {
      setError("Choose a valid date and time.");
      return;
    }
    setError("");
    setPreview({ task: parsed.body, time: previewTime.format(parsed.remindAt) });
  }

  return (
    <div className="landing">
      <LandingTide />
      <header className="landing-header">
        <Link href="/" className="landing-brand" aria-label="Deltatime home">
          <span aria-hidden="true">Δt</span>
          Deltatime
        </Link>
      </header>

      <main className="landing-hero">
        <h1>Write a reminder<br className="landing-desktop-break" /> the way you’d text it.</h1>
        {signedIn ? (
          <Link href="/calendar" className="landing-signin">Open calendar <span aria-hidden="true">↗</span></Link>
        ) : (
          <a href="/api/auth/google" className="landing-signin"><GoogleMark /> Sign in with Google</a>
        )}
        {signInFailed && (
          <p className="landing-auth-error" role="alert">Google sign-in couldn’t be completed. Try signing in again.</p>
        )}

        <section className="landing-demo" aria-label="Try a reminder">
          <form className="landing-composer" onSubmit={previewReminder}>
            <div className="landing-input-wrap">
              {!draft && (
                <span key={example.text} className="landing-example" aria-hidden="true">{example.text}</span>
              )}
              <input
                type="text"
                aria-label="Try writing a reminder"
                aria-invalid={Boolean(error)}
                autoComplete="off"
                value={draft}
                onFocus={() => setInteracting(true)}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setPreview(null);
                  setError("");
                }}
              />
            </div>
            <button type="submit" aria-label="Preview reminder" className="landing-send">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12h15m-6-6 6 6-6 6" />
              </svg>
            </button>
          </form>
          <p className="landing-example-label">Try an example</p>
          <div className="landing-chips">
            {examples.filter((item) => item !== example).map((item) => (
              <button key={item.label} type="button" onClick={() => {
                setExampleIndex(examples.indexOf(item));
                setDraft(item.text);
                setInteracting(true);
                setError("");
                setPreview(null);
              }}>{item.label}</button>
            ))}
          </div>
          {error && <p className="landing-demo-message" role="alert">{error}</p>}
          {preview && (
            <div className="landing-preview" role="status">
              <span>Reminder preview</span>
              <strong>{preview.task}</strong>
              <time>{preview.time}</time>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
