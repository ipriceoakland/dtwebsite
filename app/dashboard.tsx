"use client";

import { useState, useSyncExternalStore } from "react";
import { Modal } from "./modal";
import { ReminderForm } from "./reminder-form";
import { parseReminder } from "./parse-reminder";

// Mirrors the reminders table; remindAt is a UTC timestamp in milliseconds.
export type Reminder = {
  id: number;
  body: string;
  remindAt: number;
  status: "pending" | "sent" | "failed";
};

type View =
  | { kind: "reminder"; id: number }
  | { kind: "day"; day: number }
  | { kind: "form"; day: number; id?: number }
  | { kind: "account" };

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const statusLabels = { pending: "Pending", sent: "Sent", failed: "Failed" };

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

// Read the clock and timezone only in the browser, so the server render
// and the first client render match.
const subscribe = () => () => {};
const getTodayStart = () => new Date().setHours(0, 0, 0, 0);
const getTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Dashboard() {
  const todayStart = useSyncExternalStore(subscribe, getTodayStart, () => 0);
  const timeZone = useSyncExternalStore(subscribe, getTimeZone, () => "");

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [view, setView] = useState<View | null>(null);
  const [showYear, setShowYear] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [promptError, setPromptError] = useState("");
  const [toast, setToast] = useState("");

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? "" : t)), 3000);
  }

  function saveReminder(body: string, remindAt: number, id?: number) {
    if (id === undefined) {
      setReminders((prev) => [
        ...prev,
        {
          id: Math.max(0, ...prev.map((r) => r.id)) + 1,
          body,
          remindAt,
          status: "pending",
        },
      ]);
      showToast("Reminder added.");
    } else {
      setReminders((prev) =>
        prev.map((r) => (r.id === id ? { ...r, body, remindAt } : r)),
      );
      showToast("Reminder updated.");
    }
    setView(null);
  }

  function deleteReminder(id: number) {
    setReminders((prev) => prev.filter((r) => r.id !== id));
    setView(null);
    showToast("Reminder deleted.");
  }

  function submitPrompt() {
    const text = prompt.trim();
    if (!text) return;

    const result = parseReminder(text);
    if (!result.ok) {
      setPromptError(result.error);
      return;
    }
    saveReminder(result.body, result.remindAt);
    // Say when it landed, so a misread time is easy to spot.
    showToast(
      `Reminder set for ${longDateFormat.format(result.remindAt)} at ${timeFormat.format(result.remindAt)}.`,
    );
    setPrompt("");
    setPromptError("");
  }

  // Group reminders by the local day they fall on, in time order.
  const byDay = new Map<number, Reminder[]>();
  for (const r of [...reminders].sort((a, b) => a.remindAt - b.remindAt)) {
    const key = new Date(r.remindAt).setHours(0, 0, 0, 0);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }

  // One grid per month, starting with the current one. Each grid is padded
  // with empty cells so the 1st lands under its weekday and rows stay full.
  const today = new Date(todayStart);
  // The current month, or a year ahead (through the same month next year).
  const months = Array.from({ length: showYear ? 13 : 1 }, (_, k) => {
    const first = new Date(today.getFullYear(), today.getMonth() + k, 1);
    const daysInMonth = new Date(
      first.getFullYear(),
      first.getMonth() + 1,
      0,
    ).getDate();
    const cells: (Date | null)[] = [
      ...Array<null>(first.getDay()).fill(null),
      ...Array.from(
        { length: daysInMonth },
        (_, d) => new Date(first.getFullYear(), first.getMonth(), d + 1),
      ),
    ];
    while (cells.length % 7) cells.push(null);
    return { first, cells };
  });

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
          {!isPast && (
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
                onClick={() => setView({ kind: "reminder", id: r.id })}
              >
                <span className="chip-time">
                  {timeFormat.format(r.remindAt)}
                </span>
                <span className="chip-body">{r.body}</span>
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

  const openReminder =
    view?.kind === "reminder" || view?.kind === "form"
      ? reminders.find((r) => r.id === view.id)
      : undefined;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            type="button"
            className="brand"
            aria-label="Account"
            onClick={() => setView({ kind: "account" })}
          >
            <span className="brand-mark" aria-hidden="true">
              𝚫t
            </span>
            <span className="brand-name">Deltatime</span>
          </button>
        </div>
      </header>

      <main className="page">
        <div className="page-header">
          <h1 className="page-title">Schedule</h1>
          <p className="page-subtitle">
            {timeZone ? `Times shown in ${timeZone}` : " "}
          </p>
        </div>

        <div className="layout">
          <aside className="prompt-panel">
            <h2 className="panel-title">Add a reminder</h2>
            <p className="panel-hint">
              Type it like a text message, for example “Remind me to call
              mom Monday at 5pm.”
            </p>
            <textarea
              className="input prompt-input"
              placeholder="Remind me to call mom Monday at 5pm"
              aria-label="Add a reminder"
              aria-invalid={!!promptError}
              value={prompt}
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
            {promptError && <p className="field-error">{promptError}</p>}
            <div className="panel-actions">
              <button
                type="button"
                className="button button-primary"
                onClick={submitPrompt}
              >
                Add reminder
              </button>
            </div>
          </aside>

          <section className="months" aria-label="Calendar">
            {todayStart > 0 && (
              <>
                {months.map(({ first, cells }) => (
                  <div key={first.getTime()} className="month">
                    <h2 className="month-title">{monthFormat.format(first)}</h2>
                    <div className="calendar">
                      <div className="weekdays" aria-hidden="true">
                        {weekdays.map((day) => (
                          <div key={day}>{day}</div>
                        ))}
                      </div>
                      <div className="days">
                        {cells.map((day, i) =>
                          day ? (
                            renderDay(day)
                          ) : (
                            <div key={`empty-${i}`} className="day day-empty" />
                          ),
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  className="button more-months"
                  onClick={() => setShowYear((v) => !v)}
                >
                  {showYear ? "Show fewer months" : "Show more months"}
                </button>
              </>
            )}
          </section>
        </div>
      </main>

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
                <button
                  type="button"
                  className="button"
                  onClick={() =>
                    setView({ kind: "form", day: view.day, id: r.id })
                  }
                >
                  Edit
                </button>
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
      {view?.kind === "form" && (view.id === undefined || openReminder) && (
        <ReminderForm
          reminder={openReminder}
          day={view.day}
          onSave={(body, remindAt) =>
            saveReminder(body, remindAt, openReminder?.id)
          }
          onDelete={() => openReminder && deleteReminder(openReminder.id)}
          onCancel={() => setView(null)}
        />
      )}

      {view?.kind === "account" && (
        <Modal title="Account" onClose={() => setView(null)}>
          <dl className="details">
            <dt>Phone number</dt>
            <dd>Not signed in</dd>
            <dt>Timezone</dt>
            <dd>{timeZone}</dd>
          </dl>
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
