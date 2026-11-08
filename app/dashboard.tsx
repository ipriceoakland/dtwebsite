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

type ApiReminder = Omit<Reminder, "remindAt"> & { remind_at: number };
type ReminderChange =
  | { kind: "save"; id?: number; body: string; remindAt: number }
  | { kind: "delete"; id: number };

function fromApiReminder({ id, body, remind_at, status }: ApiReminder): Reminder {
  return { id, body, remindAt: remind_at * 1000, status };
}

type View =
  | { kind: "reminder"; id: number }
  | { kind: "day"; day: number }
  | { kind: "form"; day: number; id?: number }
  | { kind: "account" };

type Account = { user: { display_name: string | null } | null } | { error: true };

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

export function Dashboard() {
  const todayStart = useSyncExternalStore(subscribe, getTodayStart, () => 0);
  const timeZone = useSyncExternalStore(subscribe, getTimeZone, () => "");
  const signInFailed = useSyncExternalStore(subscribe, getSignInFailed, () => false);

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "signed-out" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [view, setView] = useState<View | null>(null);
  const [weeks, setWeeks] = useState(6);
  const [prompt, setPrompt] = useState("");
  const [mobileTab, setMobileTab] = useState<"home" | "calendar">("home");
  const [lastSaved, setLastSaved] = useState<Reminder | null>(null);
  const [promptError, setPromptError] = useState("");
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadReminders() {
      try {
        const response = await fetch("/api/reminders", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 401) {
          setReminders([]);
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
        setView(null);
        setLoadState("signed-out");
        return;
      }
      if (response.status === 404 && id !== undefined) {
        setError("This reminder is no longer pending. Refresh the page to see its current status.");
        return;
      }
      if (!response.ok) {
        const details: unknown = await response.json().catch(() => null);
        const message = details && typeof details === "object" && "error" in details ? details.error : null;
        setError(typeof message === "string" ? message : "Couldn’t save the change. Try again.");
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
          setLastSaved(saved);
          showToast(`Reminder saved for ${longDateFormat.format(saved.remindAt)} at ${timeFormat.format(saved.remindAt)}.`);
        } else {
          showToast(id === undefined ? "Reminder added." : "Reminder updated.");
        }
      }
      if (source === "form") setView(null);
    } catch {
      setError("Couldn’t reach the reminder service. Refresh the page to check whether the change was saved.");
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
    void changeReminder({ kind: "save", body: result.body, remindAt: result.remindAt }, "prompt");
  }

  // Group reminders by the local day they fall on, in time order.
  const byDay = new Map<number, Reminder[]>();
  for (const r of [...reminders].sort((a, b) => a.remindAt - b.remindAt)) {
    const key = new Date(r.remindAt).setHours(0, 0, 0, 0);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }

  // Start the grid on the Sunday of the current week.
  const today = new Date(todayStart);
  const days = Array.from(
    { length: weeks * 7 },
    (_, i) =>
      new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate() - today.getDay() + i,
      ),
  );

  const openReminder =
    view?.kind === "reminder" || view?.kind === "form"
      ? reminders.find((r) => r.id === view.id)
      : undefined;

  const promptPreview = prompt.trim() ? parseReminder(prompt) : null;
  const upcoming = [...reminders]
    .filter((reminder) => reminder.status === "pending" && reminder.remindAt > Date.now())
    .sort((a, b) => a.remindAt - b.remindAt)
    .slice(0, 4);

  return (
    <div>
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand"
            aria-label="Account"
            onClick={openAccount}
          >
            <span className="brand-mark" aria-hidden="true">
              𝚫t
            </span>
            <span className="brand-name">Deltatime</span>
          </button>
        </div>
      </header>

      <main className="page">
        {signInFailed && (
          <p className="field-error" role="alert">Google sign-in couldn’t be completed. Open Account to try again.</p>
        )}
        {loadState !== "loading" && (
          <section className="mobile-home" aria-label="Quick reminders" hidden={mobileTab !== "home"}>
            <p className="mobile-eyebrow">YOUR SPACE, YOUR TIME</p>
            <h1 className="mobile-title">What do you need<br />to remember?</h1>
            <p className="mobile-intro">Write it the way you’d text it.</p>

            <form className="mobile-composer" onSubmit={(event) => { event.preventDefault(); if (loadState === "ready") submitPrompt(); else void openAccount(); }}>
              <label htmlFor="mobile-reminder" className="mobile-label">New reminder</label>
              <textarea
                id="mobile-reminder"
                rows={3}
                placeholder="Remind me Friday at 4pm to send the draft"
                value={prompt}
                disabled={saving}
                aria-invalid={!!promptError}
                onChange={(event) => { setPrompt(event.target.value); setPromptError(""); }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault(); if (loadState === "ready") submitPrompt(); else void openAccount();
                  }
                }}
              />
              {promptError && <p className="mobile-error" role="alert">{promptError}</p>}
              {promptPreview?.ok && (
                <p className="mobile-preview" aria-live="polite">
                  <span>Will remind you</span>
                  <strong>{longDateFormat.format(promptPreview.remindAt)} · {timeFormat.format(promptPreview.remindAt)}</strong>
                  <span>{promptPreview.body}</span>
                </p>
              )}
              <div className="mobile-composer-bottom">
                <span>Try a time like “tomorrow at 9”</span>
                <button type="submit" disabled={!prompt.trim() || saving}>
                  {saving ? "Saving…" : loadState === "ready" ? "Send" : "Sign in"}<span aria-hidden="true"> ↗</span>
                </button>
              </div>
            </form>

            <div className="mobile-examples" aria-label="Example reminders">
              <span>TRY AN EXAMPLE</span>
              <div>
                <button type="button" onClick={() => { setPrompt("Remind me in 20 minutes to study"); setPromptError(""); }}>Study in 20 minutes</button>
                <button type="button" onClick={() => { setPrompt("Remind me tomorrow at 9am to call Mom"); setPromptError(""); }}>Call Mom tomorrow</button>
              </div>
            </div>

            {lastSaved && (
              <div className="mobile-saved" role="status">
                <span className="mobile-saved-icon" aria-hidden="true">✓</span>
                <div><strong>Reminder saved</strong><p>{lastSaved.body} · {longDateFormat.format(lastSaved.remindAt)} at {timeFormat.format(lastSaved.remindAt)}</p></div>
              </div>
            )}

            {loadState === "ready" && <section className="mobile-upcoming" aria-label="Upcoming reminders">
              <div className="mobile-section-head"><h2>Coming up</h2><button type="button" onClick={() => setMobileTab("calendar")}>View calendar <span aria-hidden="true">↗</span></button></div>
              {upcoming.length ? (
                <ul>{upcoming.map((reminder) => (
                  <li key={reminder.id}><button type="button" onClick={() => setView({ kind: "reminder", id: reminder.id })}>
                    <span className="mobile-upcoming-date">{monthDayFormat.format(reminder.remindAt)} <span>·</span> {timeFormat.format(reminder.remindAt)}</span>
                    <strong>{reminder.body}</strong><span className="mobile-upcoming-arrow" aria-hidden="true">↗</span>
                  </button></li>
                ))}</ul>
              ) : <p className="mobile-empty">Nothing coming up yet. Your next reminder starts here.</p>}
            </section>}
          </section>
        )}
        <div className="mobile-calendar-heading" hidden={mobileTab !== "calendar"}>
          <p className="mobile-eyebrow">YOUR REMINDERS</p><h1 className="mobile-title">Calendar</h1>
        </div>
        <div className="page-header">
          <div>
            <h1 className="page-title">Schedule</h1>
            <p className="page-subtitle">
              {timeZone ? `Times shown in ${timeZone}` : " "}
            </p>
          </div>
          <div className="prompt">
            <textarea
              className="input prompt-input"
              rows={1}
              placeholder="Remind me to call mom Monday at 5pm"
              aria-label="Add a reminder"
              aria-invalid={!!promptError}
              value={prompt}
              disabled={loadState !== "ready" || saving}
              onChange={(e) => {
                setPrompt(e.target.value);
                setPromptError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submitPrompt();
                }
              }}
            />
            {promptError && <p className="field-error" role="alert">{promptError}</p>}
          </div>
        </div>

        {loadState === "loading" && <p role="status">Loading reminders…</p>}
        {loadState === "signed-out" && (
          <p>Sign in to see and save reminders.{" "}
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

        {todayStart > 0 && (
          <>
            <div className={`calendar${mobileTab === "home" ? " mobile-calendar-hidden" : ""}`}>
              <div className="weekdays" aria-hidden="true">
                {weekdays.map((day) => (
                  <div key={day}>{day}</div>
                ))}
              </div>
              <div className="days">
                {days.map((day, i) => {
                  const start = day.getTime();
                  const items = byDay.get(start) ?? [];
                  const isPast = start < todayStart;
                  const label =
                    i === 0 || day.getDate() === 1
                      ? monthDayFormat.format(day)
                      : day.getDate();

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
                        <span className="day-date">{label}</span>
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
                })}
              </div>
            </div>

            <button
              type="button"
              className={`button more-weeks${mobileTab === "home" ? " mobile-calendar-hidden" : ""}`}
              onClick={() => setWeeks((w) => w + 4)}
            >
              Show more weeks
            </button>
          </>
        )}
      </main>

      {loadState !== "loading" && (
        <nav className="mobile-nav" aria-label="Main navigation">
          <button type="button" aria-current={mobileTab === "home" ? "page" : undefined} onClick={() => { setMobileTab("home"); window.scrollTo(0, 0); }}><span aria-hidden="true">✦</span> Reminders</button>
          <button type="button" aria-current={mobileTab === "calendar" ? "page" : undefined} onClick={() => { setMobileTab("calendar"); window.scrollTo(0, 0); }}><span aria-hidden="true">▦</span> Calendar</button>
          <button type="button" onClick={openAccount}><span aria-hidden="true">◯</span> Account</button>
        </nav>
      )}

      <div className="scroll-hint" aria-hidden="true" />

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
