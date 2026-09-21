import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Mic,
  Plus,
  Search,
  Settings,
  AudioLines,
  ArrowUpLeft,
  Upload,
  Square,
  Check,
  FileText,
  ListTodo,
  Sparkles,
  Download,
  Trash2,
  ShieldCheck,
  X,
  RotateCcw,
  CalendarDays,
  Clock3,
} from "lucide-react";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "./style.css";
type Meeting = {
  id: string;
  title: string;
  started_at: string;
  duration: number;
  status: string;
  audio_path: string | null;
  error: string | null;
  segments: { start: number; end: number; text: string }[];
  intelligence: null | {
    summary: string;
    decisions: string[];
    actions: {
      description: string;
      owner: string | null;
      deadline: string | null;
      done: boolean;
    }[];
    questions: string[];
    topics: string[];
  };
};
const labels: Record<string, string> = {
  queued: "در صف پردازش",
  transcribing: "در حال پیاده‌سازی",
  summarizing: "در حال خلاصه‌سازی",
  ready: "آماده",
  failed: "نیاز به بررسی",
};
const fa = (n: number) => n.toLocaleString("fa-IR");
const time = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(n % 60)
    .toString()
    .padStart(2, "0")}`;
async function api(path: string, init?: RequestInit) {
  const r = await fetch("/api" + path, init);
  if (!r.ok) {
    const body = await r
      .json()
      .catch(() => ({ detail: "خطا در ارتباط با سرور" }));
    throw Error(body.detail || "درخواست انجام نشد");
  }
  return r.status === 204 ? null : r.json();
}
const CONNECTION_ERROR =
  "ارتباط با سرور برقرار نشد. لطفاً سرویس محلی جلسه را اجرا کنید.";
function App() {
  const [savingTask, setSavingTask] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const interactionBusy = useRef(false);
  const [health, setHealth] = useState<{
    ready: boolean;
    ffmpeg: boolean;
    ollama: boolean;
    model_ready: boolean;
    speech_ready: boolean;
  } | null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(""),
    [tab, setTab] = useState("summary"),
    [modal, setModal] = useState(false),
    [settings, setSettings] = useState(false),
    [error, setError] = useState(""),
    [title, setTitle] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [busy, setBusy] = useState(false);
  const [vocabulary, setVocabulary] = useState(
    () =>
      localStorage.getItem("jalaseh-vocabulary") ||
      "CRO, CVR, Retention, Conversion Rate, GMV, A/B Test, Checkout, Cohort",
  );
  const [deleteAudio, setDeleteAudio] = useState(
    () => localStorage.getItem("jalaseh-delete") === "true",
  );
  const recorder = useRef<MediaRecorder | null>(null),
    stream = useRef<MediaStream | null>(null);
  const refresh = async () => {
    try {
      setMeetings(await api("/meetings"));
      setError((previous) => (previous === CONNECTION_ERROR ? "" : previous));
    } catch {
      setError(
        "ارتباط با سرور برقرار نشد. لطفاً سرویس محلی جلسه را اجرا کنید.",
      );
    }
  };
  useEffect(() => {
    api("/settings")
      .then((saved) => {
        setVocabulary(saved.vocabulary);
        setDeleteAudio(saved.delete_audio);
      })
      .catch(() => {});
  }, []);
  async function saveSettings() {
    try {
      await api("/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vocabulary, delete_audio: deleteAudio }),
      });
      localStorage.setItem("jalaseh-vocabulary", vocabulary);
      localStorage.setItem("jalaseh-delete", String(deleteAudio));
      setSettings(false);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    const check = () =>
      api("/health")
        .then(setHealth)
        .catch(() => setHealth(null));
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      clearInterval(timer);
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [recording]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (recording) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [recording]);
  interactionBusy.current = recording || busy;
  useEffect(() => {
    if (!modal && !settings) return;
    const previous = document.activeElement as HTMLElement | null;
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !interactionBusy.current) {
        setModal(false);
        setSettings(false);
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), textarea",
          ) || [],
        );
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [modal, settings]);
  const current = meetings.find((m) => m.id === selected);
  async function record() {
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const r = new MediaRecorder(stream.current);
      const chunks: Blob[] = [];
      let size = 0;
      r.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          size += e.data.size;
          if (size > 245 * 1024 * 1024 && r.state === "recording") {
            r.stop();
            setError("ضبط به سقف حجم رسید و متوقف شد. فایل را ذخیره کنید.");
          }
        }
      };
      r.onstop = () => {
        setFile(
          new File(
            chunks,
            "meeting." + (r.mimeType.includes("mp4") ? "m4a" : "webm"),
            { type: r.mimeType },
          ),
        );
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
      };
      r.onerror = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setError("ضبط متوقف شد. لطفاً دوباره تلاش کنید.");
      };
      recorder.current = r;
      r.start(1000);
      setSeconds(0);
      setRecording(true);
      setFile(null);
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      setError(
        "دسترسی به میکروفون امکان‌پذیر نیست. مجوز مرورگر را بررسی کنید.",
      );
    }
  }
  async function submit() {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("audio", file);
      form.append("title", title.trim() || "جلسه بدون عنوان");
      form.append("vocabulary", vocabulary);
      form.append("delete_audio", String(deleteAudio));
      const m = await api("/meetings", { method: "POST", body: form });
      setMeetings((ms) => [m, ...ms]);
      setSelected(m.id);
      setModal(false);
      setFile(null);
      setTitle("");
      setTab("summary");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function mutate(path: string, init: RequestInit) {
    try {
      await api(path, init);
      await refresh();
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    }
  }
  async function toggleAction(meeting: Meeting, index: number) {
    if (!meeting.intelligence || savingTask) return;
    setSavingTask(true);
    const done = !meeting.intelligence.actions[index].done;
    const updated = {
      ...meeting,
      intelligence: {
        ...meeting.intelligence,
        actions: meeting.intelligence.actions.map((action, i) =>
          i === index ? { ...action, done } : action,
        ),
      },
    };
    setMeetings((items) =>
      items.map((item) => (item.id === meeting.id ? updated : item)),
    );
    try {
      const saved = await api(`/meetings/${meeting.id}/actions/${index}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      });
      setMeetings((items) =>
        items.map((item) => (item.id === meeting.id ? saved : item)),
      );
    } catch (e) {
      setMeetings((items) =>
        items.map((item) => (item.id === meeting.id ? meeting : item)),
      );
      setError(String(e));
    } finally {
      setSavingTask(false);
    }
  }
  function exportMeeting(m: Meeting) {
    const i = m.intelligence;
    const body = `# ${m.title}\n\n${i ? "## خلاصه\n" + i.summary + "\n\n## تصمیم‌ها\n" + i.decisions.map((d) => "- " + d).join("\n") + "\n\n## کارها\n" + i.actions.map((a) => `- [${a.done ? "x" : " "}] ${a.description} — ${a.owner || "نامشخص"} — ${a.deadline || "بدون موعد"}`).join("\n") + "\n\n## پرسش‌ها\n" + i.questions.map((q) => "- " + q).join("\n") : ""}\n\n## متن جلسه\n${m.segments.map((s) => `[${time(s.start)}] ${s.text}`).join("\n\n")}`;
    const url = URL.createObjectURL(
      new Blob([body], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = m.title + ".md";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="app">
      <aside>
        <a className="brand" href="#" onClick={() => setSelected(null)}>
          <span className="logo">
            <AudioLines size={25} />
          </span>
          <b>
            جلسه<span>JALASEH</span>
          </b>
        </a>
        <button className="new" onClick={() => setModal(true)}>
          <Plus size={18} /> جلسه جدید
        </button>
        <div className="nav-label">فضای کاری شما</div>
        <button
          className={"nav " + (!settings ? "active" : "")}
          onClick={() => {
            setSelected(null);
            setSettings(false);
          }}
        >
          <AudioLines size={19} /> جلسه‌های من{" "}
          <span>{fa(meetings.length)}</span>
        </button>
        <button className="nav" onClick={() => setSettings(true)}>
          <Settings size={19} /> تنظیمات
        </button>
        <div className="aside-bottom">
          <ShieldCheck size={21} />
          <b>حافظه‌ای امن برای تیم شما</b>
          <p>صدا و متن جلسه‌ها روی دستگاه شما پردازش و نگهداری می‌شوند.</p>
          <div className="profile">
            <span>ش</span>
            <div>
              فضای شخصی<small>پردازش محلی · نسخه اولیه</small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header>
          <span>
            فضای کاری <span className="slash">/</span>{" "}
            {current ? "جزئیات جلسه" : "جلسه‌های من"}
          </span>
          <span className="local">
            <i style={{ background: health?.ready ? "#759366" : "#c29a51" }} />{" "}
            {health?.ready ? "هوش مصنوعی آماده · فضای خصوصی" : "فضای خصوصی"}
          </span>
        </header>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button aria-label="بستن خطا" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        {current ? (
          <>
            <div className="page-title">
              <div>
                <button className="back" onClick={() => setSelected(null)}>
                  بازگشت به جلسه‌ها ←
                </button>
                <h1>{current.title}</h1>
                <p>
                  {new Date(current.started_at).toLocaleDateString("fa-IR", {
                    dateStyle: "long",
                  })}{" "}
                  · {time(current.duration)}
                </p>
              </div>
              <div className="row">
                <button
                  className="secondary"
                  onClick={() => exportMeeting(current)}
                >
                  <Download size={17} /> دریافت متن
                </button>
                {["ready", "failed"].includes(current.status) && (
                  <button
                    className="icon"
                    aria-label="حذف جلسه"
                    onClick={() => {
                      if (confirm("این جلسه و فایل صوتی آن حذف شوند؟"))
                        mutate("/meetings/" + current.id, {
                          method: "DELETE",
                        }).then((success) => {
                          if (success) setSelected(null);
                        });
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>
            </div>
            {current.status !== "ready" && (
              <div className="status-panel">
                <AudioLines />
                <div>
                  <b>{labels[current.status]}</b>
                  <p>
                    {current.error ||
                      "پس از پردازش، نتیجه در همین صفحه نمایش داده می‌شود."}
                  </p>
                </div>
                {current.status === "failed" && (
                  <button
                    className="secondary"
                    onClick={() =>
                      mutate(`/meetings/${current.id}/retry`, {
                        method: "POST",
                      })
                    }
                  >
                    <RotateCcw size={16} /> تلاش دوباره
                  </button>
                )}
              </div>
            )}
            <div className="tabs">
              {[
                ["summary", "خلاصه جلسه"],
                ["transcript", "متن کامل"],
                ["decisions", "تصمیم‌ها"],
                ["actions", "کارها"],
              ].map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? "selected" : ""}
                  onClick={() => setTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>
            <section className="detail">
              {tab === "transcript" ? (
                <>
                  {current.audio_path && (
                    <audio controls src={`/api/meetings/${current.id}/audio`} />
                  )}{" "}
                  {current.segments.length ? (
                    current.segments.map((s, i) => (
                      <div className="segment" key={i}>
                        <time>{time(s.start)}</time>
                        <p dir="auto">{s.text}</p>
                      </div>
                    ))
                  ) : (
                    <Empty text="متن جلسه پس از پیاده‌سازی در اینجا قرار می‌گیرد." />
                  )}
                </>
              ) : !current.intelligence ? (
                <Empty text="خروجی هوش مصنوعی هنوز آماده نشده است." />
              ) : tab === "summary" ? (
                <>
                  <div className="section-title">
                    <Sparkles size={20} />
                    <h2>آنچه در جلسه گذشت</h2>
                  </div>
                  <p className="summary">{current.intelligence.summary}</p>
                  <div className="topics">
                    {current.intelligence.topics.map((t, i) => (
                      <span key={i}>{t}</span>
                    ))}
                  </div>
                  <h3>پرسش‌های باز</h3>
                  {current.intelligence.questions.length ? (
                    current.intelligence.questions.map((q, i) => (
                      <p key={i}>• {q}</p>
                    ))
                  ) : (
                    <p className="muted">پرسش بازی ثبت نشده است.</p>
                  )}
                  <p className="ai-note">
                    خروجی هوش مصنوعی را پیش از استفاده بررسی کنید.
                  </p>
                </>
              ) : tab === "decisions" ? (
                current.intelligence.decisions.length ? (
                  current.intelligence.decisions.map((d, i) => (
                    <div className="decision" key={i}>
                      <span>{fa(i + 1)}</span>
                      <p>{d}</p>
                    </div>
                  ))
                ) : (
                  <Empty text="تصمیمی در این جلسه ثبت نشده است." />
                )
              ) : current.intelligence.actions.length ? (
                current.intelligence.actions.map((a, i) => (
                  <div className={"task " + (a.done ? "done" : "")} key={i}>
                    <input
                      type="checkbox"
                      checked={a.done}
                      disabled={savingTask}
                      aria-label={a.description}
                      onChange={() => toggleAction(current, i)}
                    />
                    <div>
                      <b>{a.description}</b>
                      <p>
                        {a.owner || "مسئول مشخص نشده"} <span>·</span>{" "}
                        {a.deadline || "بدون موعد مشخص"}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                <Empty text="کاری در این جلسه ثبت نشده است." />
              )}
            </section>
          </>
        ) : (
          <>
            <div className="page-title">
              <div>
                <div className="eyebrow">هر گفتگو، یک قدم رو به جلو</div>
                <h1>
                  جلسه تمام می‌شود، <em>ایده‌ها می‌مانند.</em>
                </h1>
                <p>
                  گفتگوهایتان را به خلاصه‌های روشن، تصمیم‌ها و کارهای قابل
                  پیگیری تبدیل کنید.
                </p>
              </div>
            </div>
            <section className="hero">
              <div>
                <span className="pill">
                  <Sparkles size={13} /> دستیار هوشمند فارسی
                </span>
                <h2>
                  شما روی گفتگو تمرکز کنید.
                  <br />
                  یادداشت‌ها با جلسه.
                </h2>
                <p>
                  صدای جلسه را ضبط یا بارگذاری کنید؛
                  <br />
                  بقیه‌اش را به دستیار شخصی خود بسپارید.
                </p>
                <button className="new" onClick={() => setModal(true)}>
                  <Mic size={17} /> شروع یک جلسه <ArrowUpLeft size={17} />
                </button>
              </div>
              <div className="sound-art" aria-hidden="true">
                <div className="orbit o1" />
                <div className="orbit o2" />
                <div className="wave">
                  {[
                    18, 32, 54, 27, 70, 92, 51, 82, 110, 63, 86, 42, 64, 30, 18,
                  ].map((h, i) => (
                    <i key={i} style={{ height: h }} />
                  ))}
                </div>
                <span className="art-label">
                  <Check size={14} /> از گفتگو تا اقدام
                </span>
              </div>
            </section>
            <div className="stats">
              {[
                [AudioLines, "جلسه‌ها", meetings.length],
                [
                  FileText,
                  "خلاصه‌های آماده",
                  meetings.filter((m) => m.status === "ready").length,
                ],
                [
                  ListTodo,
                  "کارهای باز",
                  meetings.reduce(
                    (n, m) =>
                      n +
                      (m.intelligence?.actions.filter((a) => !a.done).length ||
                        0),
                    0,
                  ),
                ],
              ].map(([Icon, label, value], i) => {
                const C = Icon as typeof AudioLines;
                return (
                  <div className="stat" key={i}>
                    <span className="stat-icon">
                      <C size={21} />
                    </span>
                    <div>
                      <span>{String(label)}</span>
                      <b>{fa(value as number)}</b>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="list-heading">
              <h2>
                جلسه‌های شما <span>{fa(meetings.length)}</span>
              </h2>
              <label className="search">
                <Search size={17} />
                <input
                  placeholder="جستجو در عنوان و متن جلسه‌ها..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </div>
            <section className="meeting-list">
              {meetings
                .filter((m) =>
                  (m.title + " " + m.segments.map((s) => s.text).join(" "))
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .map((m) => (
                  <button
                    className="meeting"
                    key={m.id}
                    onClick={() => {
                      setSelected(m.id);
                      setTab("summary");
                    }}
                  >
                    <span className="meeting-icon">
                      <AudioLines size={23} />
                    </span>
                    <div>
                      <h3>{m.title}</h3>
                      <p>
                        <CalendarDays size={13} />
                        {new Date(m.started_at).toLocaleDateString(
                          "fa-IR",
                        )}{" "}
                        <Clock3 size={13} />
                        <span dir="ltr">{time(m.duration)}</span>
                      </p>
                    </div>
                    <span className={"badge " + m.status}>
                      {labels[m.status]}
                    </span>
                    <ArrowUpLeft size={18} />
                  </button>
                ))}
              {!meetings.length ? (
                <div className="empty">
                  <span>
                    <Mic size={27} />
                  </span>
                  <h3>جای اولین جلسه‌تان اینجاست</h3>
                  <p>
                    یک گفتگو را ضبط کنید یا فایل صوتی جلسه قبلی را اضافه کنید.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setModal(true)}
                  >
                    ساخت اولین جلسه <ArrowUpLeft size={15} />
                  </button>
                </div>
              ) : !meetings.some((m) =>
                  (m.title + " " + m.segments.map((s) => s.text).join(" "))
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                ) ? (
                <Empty text="جلسه‌ای با این عبارت پیدا نشد." />
              ) : null}
            </section>
            <footer>
              <ShieldCheck size={14} /> گفتگوهای شما، فقط برای شما. پردازش هوش
              مصنوعی روی دستگاه شما انجام می‌شود.
            </footer>
          </>
        )}
      </main>
      {(modal || settings) && (
        <div className="overlay">
          <section
            className="dialog"
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={settings ? "تنظیمات" : "جلسه جدید"}
          >
            <div className="dialog-heading">
              <h2>{settings ? "تنظیمات فضای کاری" : "یک گفتگوی تازه"}</h2>
              <button
                className="icon"
                aria-label="بستن"
                disabled={recording || busy}
                onClick={() => {
                  setModal(false);
                  setSettings(false);
                }}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            {settings ? (
              <>
                <div className="model-status">
                  <b>وضعیت پردازش محلی</b>
                  <p>{health?.ffmpeg ? "✓" : "○"} پردازش صدا (FFmpeg)</p>
                  <p>{health?.ollama ? "✓" : "○"} سرویس هوش مصنوعی (Ollama)</p>
                  <p>{health?.model_ready ? "✓" : "○"} مدل خلاصه‌سازی فارسی</p>
                  <p>{health?.speech_ready ? "✓" : "○"} مدل گفتار فارسی</p>
                </div>
                <label>
                  واژگان اختصاصی تیم
                  <textarea
                    maxLength={3000}
                    rows={5}
                    value={vocabulary}
                    onChange={(e) => setVocabulary(e.target.value)}
                  />
                </label>
                <p className="muted">
                  نام‌ها و اصطلاحات را با ویرگول جدا کنید. این واژه‌ها به تشخیص
                  بهتر گفتار کمک می‌کنند.
                </p>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={deleteAudio}
                    onChange={(e) => setDeleteAudio(e.target.checked)}
                  />{" "}
                  حذف فایل صوتی پس از پیاده‌سازی موفق
                </label>
                <button className="new full" onClick={saveSettings}>
                  ذخیره تنظیمات
                </button>
              </>
            ) : (
              <>
                <label>
                  عنوان جلسه
                  <input
                    autoFocus
                    maxLength={200}
                    placeholder="مثلاً: برنامه‌ریزی هفتگی محصول"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <div className={"record-box " + (recording ? "recording" : "")}>
                  <span className="mic-circle">
                    <Mic size={29} />
                  </span>
                  <strong dir="ltr">{time(seconds)}</strong>
                  <p>
                    {recording ? "در حال ضبط صدا…" : "آماده برای شنیدن گفتگو"}
                  </p>
                  <button
                    className={recording ? "stop" : "secondary"}
                    disabled={busy}
                    onClick={() =>
                      recording ? recorder.current?.stop() : record()
                    }
                  >
                    {recording ? (
                      <>
                        <Square size={15} /> توقف و ذخیره ضبط
                      </>
                    ) : (
                      <>
                        <Mic size={16} /> شروع ضبط
                      </>
                    )}
                  </button>
                </div>
                <label className="upload">
                  <Upload size={19} />
                  {file ? file.name : "یا یک فایل صوتی انتخاب کنید"}
                  <input
                    type="file"
                    accept="audio/*,.m4a,.webm"
                    disabled={recording || busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && f.size > 250 * 1024 * 1024) {
                        setError("حداکثر حجم فایل ۲۵۰ مگابایت است.");
                        return;
                      }
                      setFile(f || null);
                    }}
                  />
                </label>
                <p className="muted">
                  پیش از ضبط، شرکت‌کنندگان را مطلع کنید.{" "}
                  {deleteAudio
                    ? "صدا پس از پیاده‌سازی حذف می‌شود."
                    : "فایل صوتی روی دستگاه نگهداری می‌شود."}
                </p>
                <button
                  className="new full"
                  disabled={!file || recording || busy}
                  onClick={submit}
                >
                  <Sparkles size={17} />
                  {busy ? "در حال ذخیره…" : "ذخیره و پردازش جلسه"}
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty small">
      <FileText size={26} />
      <p>{text}</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
