"use client";

import { useState, type FormEvent } from "react";
import { Modal } from "./modal";
import type { Reminder } from "./dashboard";

type ReminderFormProps = {
  reminder?: Reminder;
  day: number;
  onSave: (body: string, remindAt: number) => void;
  onDelete: () => void;
  onCancel: () => void;
};

const pad = (n: number) => String(n).padStart(2, "0");
const digitsOnly = (value: string) => value.replace(/\D/g, "").slice(0, 2);

// Window C in the design doc: add or edit a reminder.
export function ReminderForm({
  reminder,
  day,
  onSave,
  onDelete,
  onCancel,
}: ReminderFormProps) {
  // New reminders default to 9:00 AM, matching the parser's default.
  const initial = new Date(reminder?.remindAt ?? new Date(day).setHours(9));

  const [body, setBody] = useState(reminder?.body ?? "");
  const [date, setDate] = useState(
    `${initial.getFullYear()}-${pad(initial.getMonth() + 1)}-${pad(initial.getDate())}`,
  );
  const [hour, setHour] = useState(String(initial.getHours() % 12 || 12));
  const [minute, setMinute] = useState(pad(initial.getMinutes()));
  const [pm, setPm] = useState(initial.getHours() >= 12);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();

    const h = Number(hour);
    const m = Number(minute);
    const [year, month, dayOfMonth] = date.split("-").map(Number);
    const remindAt = new Date(
      year,
      month - 1,
      dayOfMonth,
      (h % 12) + (pm ? 12 : 0),
      m,
    ).getTime();

    const next: Record<string, string> = {};
    if (!body.trim()) next.body = "Enter a description.";
    else if (body.trim().length > 320)
      next.body = "Keep the description under 320 characters.";
    if (!date) next.date = "Choose a date.";
    if (hour === "" || minute === "" || h < 1 || h > 12 || m > 59)
      next.time = "Enter a time like 9:30.";
    else if (date && remindAt <= Date.now())
      next.time = "Choose a time in the future.";

    setErrors(next);
    if (Object.keys(next).length === 0) onSave(body.trim(), remindAt);
  }

  return (
    <>
      <Modal title={reminder ? "Edit reminder" : "New reminder"} onClose={onCancel}>
        <form
          className="form"
          onSubmit={submit}
          onChange={() => setErrors({})}
          noValidate
        >
          <div className="field">
            <label htmlFor="reminder-body">Description</label>
            <input
              id="reminder-body"
              className="input"
              value={body}
              maxLength={320}
              placeholder="Study for exam"
              aria-invalid={!!errors.body}
              onChange={(e) => setBody(e.target.value)}
            />
            {errors.body && <p className="field-error">{errors.body}</p>}
          </div>

          <div className="field">
            <label htmlFor="reminder-date">Date</label>
            <input
              id="reminder-date"
              type="date"
              className="input"
              value={date}
              aria-invalid={!!errors.date}
              onChange={(e) => setDate(e.target.value)}
            />
            {errors.date && <p className="field-error">{errors.date}</p>}
          </div>

          <div className="field">
            <span id="reminder-time-label" className="field-label">
              Time
            </span>
            <div
              className="time-row"
              role="group"
              aria-labelledby="reminder-time-label"
            >
              <input
                className="input time-input"
                inputMode="numeric"
                aria-label="Hour"
                value={hour}
                aria-invalid={!!errors.time}
                onChange={(e) => setHour(digitsOnly(e.target.value))}
              />
              <span className="time-separator">:</span>
              <input
                className="input time-input"
                inputMode="numeric"
                aria-label="Minute"
                value={minute}
                aria-invalid={!!errors.time}
                onChange={(e) => setMinute(digitsOnly(e.target.value))}
              />
              <div className="segmented">
                <button
                  type="button"
                  aria-pressed={!pm}
                  onClick={() => setPm(false)}
                >
                  AM
                </button>
                <button
                  type="button"
                  aria-pressed={pm}
                  onClick={() => setPm(true)}
                >
                  PM
                </button>
              </div>
            </div>
            {errors.time && <p className="field-error">{errors.time}</p>}
          </div>

          <div className="modal-actions">
            {reminder && (
              <button
                type="button"
                className="button button-danger"
                onClick={() => setConfirmingDelete(true)}
              >
                Delete
              </button>
            )}
            <span className="spacer" />
            <button type="button" className="button" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="button button-primary">
              Confirm
            </button>
          </div>
        </form>
      </Modal>

      {reminder && confirmingDelete && (
        <Modal
          title="Delete this reminder?"
          small
          onClose={() => setConfirmingDelete(false)}
        >
          <p className="modal-text">
            “{reminder.body}” will be removed and you won’t get a text for it.
          </p>
          <div className="modal-actions">
            <span className="spacer" />
            <button
              type="button"
              className="button"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button-danger-solid"
              onClick={onDelete}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
