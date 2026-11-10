"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "./modal";
import { ReminderForm } from "./reminder-form";
import { parseReminder } from "./parse-reminder";

// Mirrors the reminders table; remindAt is a UTC timestamp in milliseconds.
export type Reminder = {
  id: number;
  body: string;
  remindAt: number;
  status: "pending" | "sending" | "sent" | "failed" | "cancelled";
};

type ChatExchange = { id: number; text: string; remindAt: number };

type ApiReminder = Omit<Reminder, "remindAt"> & { remind_at: number };
type ReminderChange =
  | { kind: "save"; id?: number; body: string; remindAt: number; chatText?: string }
  | { kind: "delete"; id: number };

function fromApiReminder({ id, body, remind_at, status }: ApiReminder): Reminder {
  return { id, body, remindAt: remind_at * 1000, status };
}

type View =
  | { kind: "reminder"; id: number }
  | { kind: "day"; day: number }
  | { kind: "form"; day: number; id?: number }
  | { kind: "account" }
  | { kind: "help" };

type Account = { user: { display_name: string | null } | null } | { error: true };

const signInDraftKey = "deltatime.sign-in-draft";

const mobileTabs = [
  { id: "upcoming", label: "Upcoming", icon: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-15v5l3 2" },
  { id: "chat", label: "Chat", icon: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l1.6-3.2A8.5 8.5 0 1 1 21 11.5Z" },
  { id: "calendar", label: "Calendar", icon: "M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" },
] as const;

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const statusLabels = {
  pending: "Pending", sending: "Sending", sent: "Sent", failed: "Failed", cancelled: "Cancelled",
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const longDateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});
const monthFormat = new Intl.DateTimeFormat(undefined, {
  month: "long",
  year: "numeric",
});
const monthDayFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

// Read the clock and timezone only in the browser, so the server render
// and the first client render match.
const subscribe = () => () => {};
const getTodayStart = () => new Date().setHours(0, 0, 0, 0);
const getTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getSignInFailed = () => new URLSearchParams(window.location.search).get("signin") === "failed";

function getMonth(anchor: Date, offset: number) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth() + offset, 1);
  const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const leadingCells = first.getDay();
  const totalCells = Math.ceil((leadingCells + lastDay) / 7) * 7;
  const cells = Array.from({ length: totalCells }, (_, index) => {
    const day = index - leadingCells + 1;
    return day >= 1 && day <= lastDay
      ? new Date(first.getFullYear(), first.getMonth(), day)
      : null;
  });
  return { first, cells };
}

export function Dashboard() {
  const todayStart = useSyncExternalStore(subscribe, getTodayStart, () => 0);
  const timeZone = useSyncExternalStore(subscribe, getTimeZone, () => "");
  const signInFailed = useSyncExternalStore(subscribe, getSignInFailed, () => false);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [showYear, setShowYear] = useState(false);
  const [monthOffset, setMonthOffset] = useState(0);
  const [chat, setChat] = useState<ChatExchange[]>([]);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const mobileChatLogRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const [mobileTab, setMobileTab] = useState<(typeof mobileTabs)[number]["id"]>("chat");
  const [promptError, setPromptError] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmDoneId, setConfirmDoneId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReminders() {
      try {
        const response = await fetch("/api/reminders", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setReminders([]);
          setChat([]);
          setLoadState("signed-out");
          return;
        }
        if (!response.ok) throw new Error("Unable to load reminders");
        const { reminders: rows }: { reminders: ApiReminder[] } = await response.json();
        if (controller.signal.aborted) return;
        setReminders(rows.map(fromApiReminder).filter((reminder) =>
          reminder.status !== "cancelled" && Number.isFinite(new Date(reminder.remindAt).getTime()),
        ));
        setLoadState("ready");
      } catch {
        if (!controller.signal.aborted) setLoadState("error");
      }
    }

    function reloadFromHistory(event: PageTransitionEvent) {
      if (event.persisted) window.location.reload();
    }

    void loadReminders();
    window.addEventListener("pageshow", reloadFromHistory);
    return () => {
      controller.abort();
      window.removeEventListener("pageshow", reloadFromHistory);
    };
  }, [loadAttempt]);

  useEffect(() => {
    for (const log of [chatLogRef.current, mobileChatLogRef.current]) {
      if (log) log.scrollTop = log.scrollHeight;
    }
  }, [chat, mobileTab]);

  useEffect(() => {
    const viewport = window.visualViewport;
    const app = appRef.current;
    if (!viewport || !app) return;

    function syncViewport() {
      if (!viewport || !app || viewport.scale !== 1) return;
      app.style.setProperty("--schedule-viewport-height", `${viewport.height}px`);
      app.style.setProperty("--schedule-viewport-top", `${viewport.offsetTop}px`);
      app.classList.toggle("schedule-keyboard-open", viewport.height < window.innerHeight - 120);
    }

    syncViewport();
    viewport.addEventListener("resize", syncViewport);
    viewport.addEventListener("scroll", syncViewport);
    return () => {
      viewport.removeEventListener("resize", syncViewport);
      viewport.removeEventListener("scroll", syncViewport);
    };
  }, []);

  useEffect(() => {
    try {
      const draft = sessionStorage.getItem(signInDraftKey);
      if (draft) {
        setPrompt(draft);
        sessionStorage.removeItem(signInDraftKey);
      }
    } catch {
      // Some browser settings block session storage.
    }
  }, []);

  function rememberDraftForSignIn() {
    if (!prompt.trim()) return;
    try {
      sessionStorage.setItem(signInDraftKey, prompt);
    } catch {
      // Sign-in still works if session storage is unavailable.
    }
  }

  function submitMobileChat() {
    if (!prompt.trim() || savingRef.current) return;
    if (loadState === "signed-out") {
      rememberDraftForSignIn();
      window.location.assign("/api/auth/google");
      return;
    }
    if (loadState === "ready") submitPrompt();
  }

  async function openAccount() {
    setView({ kind: "account" });
    setAccount(null);
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load account");
      setAccount(await response.json());
    } catch {
      setAccount({ error: true });
    }
  }

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? "" : t)), 3000);
  }

  async function changeReminder(change: ReminderChange, source: "prompt" | "form") {
    if (savingRef.current || loadState !== "ready") return;

    const setError = source === "prompt" ? setPromptError : setFormError;
    const reportError = (message: string) => {
      setError(message);
      if (source === "form" && view === null) showToast(message);
    };
    const { id } = change;
    const path = id === undefined ? "/api/reminders" : `/api/reminders/${id}`;
    savingRef.current = true;
    setSaving(true);
    setError("");

    try {
      const response = await fetch(path, change.kind === "delete" ? { method: "DELETE" } : {
        method: id === undefined ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: change.body, remind_at: Math.floor(change.remindAt / 1000) }),
      });
      if (response.status === 401) {
        setReminders([]);
        setChat([]);
        setView(null);
        setLoadState("signed-out");
        return;
      }
      if (response.status === 404 && id !== undefined) {
        reportError("This reminder is no longer pending. Refresh the page to see its current status.");
        return;
      }
      if (!response.ok) {
        const details: unknown = await response.json().catch(() => null);
        const message = details && typeof details === "object" && "error" in details ? details.error : null;
        reportError(typeof message === "string" ? message : "Couldn’t save the change. Try again.");
        return;
      }

      if (change.kind === "delete") {
        setReminders((previous) => previous.filter((reminder) => reminder.id !== id));
        showToast("Reminder cancelled.");
      } else {
        const { reminder: row }: { reminder: ApiReminder } = await response.json();
        const saved = fromApiReminder(row);
        setReminders((previous) => id === undefined ? [...previous, saved] :
          previous.map((reminder) => reminder.id === id ? saved : reminder));
        if (source === "prompt") {
          setPrompt("");
          if (change.chatText) {
            const text = change.chatText;
            setChat((previous) => [...previous, { id: saved.id, text, remindAt: saved.remindAt }]);
            const date = new Date(saved.remindAt);
            const today = new Date(todayStart);
            setMonthOffset((date.getFullYear() - today.getFullYear()) * 12 + date.getMonth() - today.getMonth());
          }
        } else {
          showToast(id === undefined ? "Reminder added." : "Reminder updated.");
        }
      }
      if (source === "form") setView(null);
    } catch {
      reportError("Couldn’t reach the reminder service. Refresh the page to check whether the change was saved.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function submitPrompt() {
    const text = prompt.trim();
    if (!text) return;

    const result = parseReminder(text);
    if (!result.ok) {
      setPromptError(result.error);
      return;
    }
    if (!Number.isFinite(new Date(result.remindAt).getTime())) {
      setPromptError("Choose a valid date and time.");
      return;
    }
    void changeReminder({
      kind: "save",
      body: result.body,
      remindAt: result.remindAt,
      chatText: text,
    }, "prompt");
  }

  // Group reminders by the local day they fall on, in time order.
  const byDay = new Map<number, Reminder[]>();
  for (const r of [...reminders].sort((a, b) => a.remindAt - b.remindAt)) {
    const key = new Date(r.remindAt).setHours(0, 0, 0, 0);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }

  const today = new Date(todayStart);
  const visibleMonth = todayStart > 0 ? getMonth(today, monthOffset) : null;
  const mobileMonths = todayStart > 0
    ? Array.from({ length: showYear ? 13 : 2 }, (_, offset) => getMonth(today, offset))
    : [];

  const openReminder =
    view?.kind === "reminder" || view?.kind === "form"
      ? reminders.find((r) => r.id === view.id)
      : undefined;

  const upcoming = [...reminders]
    .filter((reminder) => reminder.status === "pending" && reminder.remindAt > Date.now())
    .sort((a, b) => a.remindAt - b.remindAt);
  const upcomingByDay = new Map<number, Reminder[]>();
  for (const reminder of upcoming) {
    const day = new Date(reminder.remindAt).setHours(0, 0, 0, 0);
    upcomingByDay.set(day, [...(upcomingByDay.get(day) ?? []), reminder]);
  }

  function renderDay(day: Date) {
    const start = day.getTime();
    const items = byDay.get(start) ?? [];
    const isPast = start < todayStart;
    return (
      <div
        key={start}
        className={[
          "day",
          start === todayStart && "day-today",
          isPast && "day-past",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="day-head">
          <span className="day-date">{day.getDate()}</span>
          {!isPast && loadState === "ready" && (
            <button
              type="button"
              className="add-button"
              aria-label={`Add reminder on ${longDateFormat.format(day)}`}
              onClick={() => setView({ kind: "form", day: start })}
            >
              +
            </button>
          )}
        </div>

        {/* Desktop: each reminder is its own button. */}
        <ul className="day-reminders">
          {items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="reminder-chip"
                onClick={() =>
                  setView({ kind: "reminder", id: r.id })
                }
              >
                <span className="chip-time">
                  {timeFormat.format(r.remindAt)}
                </span>{" "}
                {r.body}
              </button>
            </li>
          ))}
        </ul>

        {/* Mobile: only the count, which opens the day. */}
        {items.length > 0 && (
          <button
            type="button"
            className="day-count"
            aria-label={`${items.length} ${items.length === 1 ? "reminder" : "reminders"} on ${longDateFormat.format(day)}`}
            onClick={() => setView({ kind: "day", day: start })}
          >
            {items.length}
          </button>
        )}
      </div>
    );
  }

  function renderMonthGrid(cells: (Date | null)[]) {
    return (
      <div className="calendar">
        <div className="weekdays" aria-hidden="true">
          {weekdays.map((day) => <div key={day}>{day}</div>)}
        </div>
        <div className="days">
          {cells.map((day, index) => day
            ? renderDay(day)
            : <div key={`empty-${index}`} className="day schedule-day-empty" aria-hidden="true" />
          )}
        </div>
      </div>
    );
  }

  function renderMessages() {
    return chat.map(({ id, text, remindAt }) => (
      <div className="schedule-chat-exchange" key={id}>
        <p className="schedule-message schedule-message-user">{text}</p>
        <p className="schedule-message">
          Added to your calendar for {longDateFormat.format(remindAt)} at {timeFormat.format(remindAt)}.
        </p>
      </div>
    ));
  }

  function renderUpcoming() {
    if (upcoming.length === 0) {
      return (
        <p className="schedule-empty">
          {loadState === "ready" ? "No upcoming reminders yet." : "Your upcoming reminders will appear here."}
        </p>
      );
    }

    return (
      <ul className="schedule-upcoming-list">
        {upcoming.map((reminder) => (
          <li key={reminder.id}>
            <button type="button" onClick={() => setView({ kind: "reminder", id: reminder.id })}>
              <strong>{reminder.body}</strong>
              <time dateTime={new Date(reminder.remindAt).toISOString()}>
                {monthDayFormat.format(reminder.remindAt)} · {timeFormat.format(reminder.remindAt)}
              </time>
            </button>
          </li>
        ))}
      </ul>
    );
  }

  function renderMobileUpcoming() {
    if (upcoming.length === 0) return renderUpcoming();

    return (
      <div className="mobile-reminder-days">
        {[...upcomingByDay].map(([day, items]) => (
          <section key={day} className="mobile-reminder-day" aria-label={longDateFormat.format(day)}>
            <h2>{longDateFormat.format(day)}</h2>
            <ul>
              {items.map((reminder) => (
                <li key={reminder.id} className="mobile-reminder-card">
                  <button
                    type="button"
                    className="mobile-reminder-check"
                    aria-label={`Mark ${reminder.body} done`}
                    disabled={saving}
                    onClick={() => setConfirmDoneId(reminder.id)}
                  >
                    <span aria-hidden="true" />
                  </button>
                  <div className="mobile-reminder-copy">
                    <strong>{reminder.body}</strong>
                    <time dateTime={new Date(reminder.remindAt).toISOString()}>{timeFormat.format(reminder.remindAt)}</time>
                  </div>
                  <button
                    type="button"
                    className="mobile-reminder-settings"
                    aria-label={`Settings for ${reminder.body}`}
                    onClick={() => setView({ kind: "form", day, id: reminder.id })}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="schedule-app" ref={appRef}>
      <header className="topbar">
        <div className="topbar-inner schedule-topbar-inner">
          <button
            type="button"
            className="brand schedule-desktop-brand"
            aria-label="Account"
            onClick={openAccount}
          >
            <span className="brand-mark" aria-hidden="true">
              𝚫t
            </span>
            <span className="brand-name">Deltatime</span>
          </button>
          <span className="brand schedule-mobile-brand">
            <span className="brand-mark" aria-hidden="true">𝚫t</span>
            <span className="brand-name">Deltatime</span>
          </span>
          <button type="button" className={loadState === "signed-out" ? "schedule-account schedule-account-signed-out" : "schedule-account"} aria-label="Open profile" onClick={openAccount}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <circle cx="12" cy="8" r="3" />
              <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
            </svg>
            <span className="schedule-profile-label">Profile</span>
          </button>
          {loadState === "signed-out" && (
            <a href="/api/auth/google" className="mobile-sign-in" onClick={rememberDraftForSignIn}>
              Sign in
            </a>
          )}
        </div>
      </header>

      <main className="page schedule-page">
        {signInFailed && (
          <p className="field-error" role="alert">Google sign-in couldn’t be completed. Open Account to try again.</p>
        )}
        {loadState === "loading" && <p role="status">Loading reminders…</p>}
        {loadState === "signed-out" && (
          <p className="schedule-sign-in-notice">Sign in to see and save reminders.{" "}
            <button type="button" className="button" onClick={openAccount}>Open Account</button>
          </p>
        )}
        {loadState === "error" && (
          <p>Couldn’t load reminders.{" "}
            <button type="button" className="button" onClick={() => {
              setLoadState("loading");
              setLoadAttempt((attempt) => attempt + 1);
            }}>Retry</button>
          </p>
        )}

        <section className="mobile-chat" hidden={mobileTab !== "chat"} aria-labelledby="mobile-chat-title">
          <div className="mobile-view-header">
            <h1 id="mobile-chat-title">Text Delta</h1>
            <button
              type="button"
              className="mobile-help-button"
              aria-label="How to use Text Delta"
              onClick={() => setView({ kind: "help" })}
            >
              <span aria-hidden="true">?</span>
            </button>
          </div>
          <div className="mobile-chat-log" role="log" aria-label="Reminder conversation" ref={mobileChatLogRef}>
            {chat.length === 0 && loadState === "ready" && (
              <p className="schedule-empty">Send a message to set a reminder.</p>
            )}
            {renderMessages()}
          </div>
          <form
            className="mobile-chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              submitMobileChat();
            }}
          >
            {promptError && <p id="mobile-chat-error" className="field-error" role="alert">{promptError}</p>}
            <div className="mobile-chat-controls">
              <textarea
                className="input mobile-chat-input"
                rows={1}
                placeholder="Write a reminder…"
                aria-label="Write a reminder"
                aria-invalid={!!promptError}
                aria-describedby={promptError ? "mobile-chat-error" : undefined}
                enterKeyHint="send"
                value={prompt}
                readOnly={saving}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  setPromptError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button
                type="submit"
                className="button button-primary mobile-send"
                disabled={(loadState !== "ready" && loadState !== "signed-out") || saving || !prompt.trim()}
              >
                {saving ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </section>

        <section className="mobile-upcoming" hidden={mobileTab !== "upcoming"} aria-labelledby="mobile-upcoming-title">
          <div className="mobile-view-header">
            <h1 id="mobile-upcoming-title">Upcoming</h1>
          </div>
          {renderMobileUpcoming()}
        </section>

        <div className="schedule-mobile-calendar" hidden={mobileTab !== "calendar"}>
          <div className="mobile-view-header"><h1>Calendar</h1></div>
          <section className="schedule-months" aria-label="Calendar">
            {mobileMonths.map(({ first, cells }) => (
              <section className="schedule-month" key={first.getTime()}>
                <h2 className="schedule-month-title">{monthFormat.format(first)}</h2>
                {renderMonthGrid(cells)}
              </section>
            ))}
            {mobileMonths.length > 0 && (
              <button
                type="button"
                className="button schedule-more-months"
                onClick={() => setShowYear((expanded) => !expanded)}
                aria-expanded={showYear}
              >
                {showYear ? "Show fewer months" : "Show more months"}
              </button>
            )}
          </section>
        </div>

        <div className="schedule-layout">
          <section className="schedule-card schedule-desktop-calendar" aria-labelledby="schedule-title">
            <h1 id="schedule-title" className="schedule-title">Schedule</h1>
            {visibleMonth && (
              <>
                <div className="schedule-month-nav">
                  <button
                    type="button"
                    className="button schedule-month-button"
                    aria-label="Previous month"
                    onClick={() => setMonthOffset((offset) => offset - 1)}
                  >
                    <span aria-hidden="true">‹</span>
                  </button>
                  <h2 aria-live="polite">{monthFormat.format(visibleMonth.first)}</h2>
                  <button
                    type="button"
                    className="button schedule-month-button"
                    aria-label="Next month"
                    onClick={() => setMonthOffset((offset) => offset + 1)}
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                  {monthOffset !== 0 && (
                    <button type="button" className="button" onClick={() => setMonthOffset(0)}>
                      Today
                    </button>
                  )}
                </div>
                {renderMonthGrid(visibleMonth.cells)}
              </>
            )}
          </section>

          <div className="schedule-side">
            <section className="schedule-card schedule-chat" aria-labelledby="schedule-chat-title">
              <h2 id="schedule-chat-title" className="schedule-title">Reminder chat</h2>
              <div className="schedule-chat-log" role="log" aria-label="Reminder conversation" ref={chatLogRef}>
                {chat.length === 0 && (
                  <p className="schedule-empty">Try “Remind me Friday at 4 PM to send the draft.”</p>
                )}
                {renderMessages()}
              </div>
              <form
                className="schedule-composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitPrompt();
                }}
              >
                {promptError && <p className="field-error" role="alert">{promptError}</p>}
                <div className="schedule-composer-row">
                  <textarea
                    className="input schedule-chat-input"
                    rows={1}
                    placeholder="Write a reminder…"
                    aria-label="Write a reminder"
                    aria-invalid={!!promptError}
                    value={prompt}
                    disabled={loadState !== "ready"}
                    readOnly={saving}
                    onChange={(event) => {
                      setPrompt(event.target.value);
                      setPromptError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                  <button
                    type="submit"
                    className="button schedule-send"
                    aria-label={saving ? "Saving reminder" : "Send reminder"}
                    disabled={loadState !== "ready" || saving || !prompt.trim()}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m21 3-7.5 18-3.8-6.7L3 10.5 21 3ZM21 3 9.7 14.3" />
                    </svg>
                  </button>
                </div>
              </form>
            </section>

            <section className="schedule-card schedule-upcoming" aria-labelledby="schedule-upcoming-title">
              <h2 id="schedule-upcoming-title" className="schedule-title">Upcoming reminders</h2>
              {renderUpcoming()}
            </section>
          </div>
        </div>
      </main>

      <nav className="mobile-nav" aria-label="Main navigation">
        {mobileTabs.map(({ id, label, icon }) => (
          <button
            key={id}
            type="button"
            aria-current={mobileTab === id ? "page" : undefined}
            onClick={() => setMobileTab(id)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d={icon} />
            </svg>
            {label}
          </button>
        ))}
      </nav>

      {view?.kind === "help" && (
        <Modal title="Text Delta" small onClose={() => setView(null)}>
          <p className="mobile-help-intro">Tell Delta what to remember and when. For example:</p>
          <ul className="mobile-help-examples">
            <li>Remind me in 20 minutes to study.</li>
            <li>Remind me tomorrow at 9 AM to call Mom.</li>
            <li>Remind me Friday at 4 PM to send the draft.</li>
          </ul>
          <section className="mobile-help-home-screen">
            <h3>Keep Delta one tap away</h3>
            <p>On your iPhone, open Deltatime in Safari. Tap Share (or open the page menu and tap Share), then tap Add to Home Screen and Add.</p>
          </section>
          <div className="modal-actions">
            <button type="button" className="button button-primary" onClick={() => setView(null)}>
              Done
            </button>
          </div>
        </Modal>
      )}

      {confirmDoneId !== null && (
        <Modal title="Mark reminder done?" small onClose={() => setConfirmDoneId(null)}>
          <p className="modal-text">You will not get notified for this reminder.</p>
          <div className="modal-actions">
            <button type="button" className="button" disabled={saving} onClick={() => setConfirmDoneId(null)}>Keep reminder</button>
            <span className="spacer" />
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={() => {
                const id = confirmDoneId;
                setConfirmDoneId(null);
                void changeReminder({ kind: "delete", id }, "form");
              }}
            >
              Mark done
            </button>
          </div>
        </Modal>
      )}

      {/* Window B (desktop): one reminder. */}
      {view?.kind === "reminder" && openReminder && (
        <Modal title="Reminder" onClose={() => setView(null)}>
          <dl className="details">
            <dt>Description</dt>
            <dd>{openReminder.body}</dd>
            <dt>Date and time</dt>
            <dd>
              {longDateFormat.format(openReminder.remindAt)} at{" "}
              {timeFormat.format(openReminder.remindAt)}
            </dd>
            <dt>Status</dt>
            <dd>
              <StatusLabel status={openReminder.status} />
            </dd>
          </dl>
          <div className="modal-actions">
            {openReminder.status === "pending" && (
              <button
                type="button"
                className="button"
                onClick={() =>
                  setView({
                    kind: "form",
                    day: new Date(openReminder.remindAt).setHours(0, 0, 0, 0),
                    id: openReminder.id,
                  })
                }
              >
                Edit
              </button>
            )}
            <span className="spacer" />
            <button
              type="button"
              className="button button-primary"
              onClick={() => setView(null)}
            >
              Back
            </button>
          </div>
        </Modal>
      )}

      {/* Screen B (mobile): every reminder on one day. */}
      {view?.kind === "day" && (
        <Modal
          title={longDateFormat.format(view.day)}
          onClose={() => setView(null)}
        >
          <ul className="day-list">
            {(byDay.get(view.day) ?? []).map((r) => (
              <li key={r.id} className="day-list-item">
                <div>
                  <p className="day-list-time">
                    {timeFormat.format(r.remindAt)}{" "}
                    <StatusLabel status={r.status} />
                  </p>
                  <p className="day-list-body">{r.body}</p>
                </div>
                {r.status === "pending" && (
                  <button
                    type="button"
                    className="button"
                    onClick={() => setView({ kind: "form", day: view.day, id: r.id })}
                  >
                    Edit
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <span className="spacer" />
            <button
              type="button"
              className="button button-primary"
              onClick={() => setView(null)}
            >
              Back
            </button>
          </div>
        </Modal>
      )}

      {/* Window C: add or edit. */}
      {view?.kind === "form" && (view.id === undefined || openReminder?.status === "pending") && (
        <ReminderForm
          reminder={openReminder}
          day={view.day}
          saving={saving}
          error={formError}
          onSave={(body, remindAt) =>
            changeReminder({ kind: "save", body, remindAt, id: openReminder?.id }, "form")
          }
          onDelete={() => {
            if (openReminder) void changeReminder({ kind: "delete", id: openReminder.id }, "form");
          }}
          onCancel={() => {
            setFormError("");
            setView(null);
          }}
        />
      )}

      {view?.kind === "account" && (
        <Modal title="Account" onClose={() => setView(null)}>
          <dl className="details">
            <dt>Sign-in</dt>
            <dd>
              {account === null ? "Checking sign-in…" :
                "error" in account ? "Couldn’t check sign-in. Close Account and try again." :
                  account.user ? account.user.display_name ?? "Signed in" : "Not signed in"}
            </dd>
            <dt>Timezone</dt>
            <dd>{timeZone}</dd>
          </dl>
          <div className="modal-actions">
            <span className="spacer" />
            {account && "user" in account && (account.user ? (
              <form method="post" action="/api/auth/signout">
                <button type="submit" className="button">Sign out</button>
              </form>
            ) : (
              <a href="/api/auth/google" className="button button-primary">Sign in with Google</a>
            ))}
            <button type="button" className="button" onClick={() => setView(null)}>
              Back
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function StatusLabel({ status }: { status: Reminder["status"] }) {
  return (
    <span className={`status status-${status}`}>{statusLabels[status]}</span>
  );
}
