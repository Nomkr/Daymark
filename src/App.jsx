import React, { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import ICAL from "ical.js";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleHelp,
  ClipboardList,
  Code2,
  Download,
  ExternalLink,
  FileUp,
  Folder,
  FolderKanban,
  LayoutGrid,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

const timeZone = "Asia/Shanghai";
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const emptyData = {
  version: 1,
  tasks: [],
  notes: [],
  quickNote: "",
  projects: [],
  events: [],
};
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const projectStatuses = [
  { id: "planned", label: "计划中" },
  { id: "active", label: "进行中" },
  { id: "done", label: "已完成" },
];
const eventColors = [
  { id: "blue", label: "蓝色", accent: "#5278c4", text: "#3158a3", background: "#e7eefc" },
  { id: "teal", label: "青色", accent: "#348c91", text: "#176a70", background: "#e2f3f1" },
  { id: "green", label: "绿色", accent: "#4a9a70", text: "#2a744d", background: "#e6f4e9" },
  { id: "amber", label: "黄色", accent: "#c18a2b", text: "#875d16", background: "#fff2d6" },
  { id: "coral", label: "珊瑚色", accent: "#c46c60", text: "#984b42", background: "#fbeae6" },
  { id: "violet", label: "紫色", accent: "#9271b6", text: "#684989", background: "#f0eafb" },
];
function eventColorStyle(event) {
  const color = eventColors.find((option) => option.id === event.color) || eventColors[0];
  return {
    "--event-accent": color.accent,
    "--event-text": color.text,
    "--event-background": color.background,
  };
}
function normalizeProjectStatus(status) {
  if (status === "active" || status === "done" || status === "planned") {
    return status;
  }
  if (status === "completed") return "done";
  return "planned";
}
function dateKey(date) {
  const parts = Object.fromEntries(
    dateFormatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function civilDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthLabel(date) {
  return `${date.getFullYear()}年 ${date.getMonth() + 1}月`;
}

function dayLabel(key) {
  return new Date(`${key}T00:00:00Z`).toLocaleDateString("zh-CN", {
    timeZone,
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function monthDays(month) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const daysInMonth = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  const cellCount = Math.ceil((offset + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    );
    return {
      key: civilDateKey(date),
      number: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
    };
  });
}

function byStartTime(a, b) {
  return (a.time || "").localeCompare(b.time || "");
}

function taskCalendarDate(task) {
  return task.expectedAt?.slice(0, 10) || "";
}

function dateCountdown(date, today, completed, kind) {
  if (!date) return null;
  if (completed) return { text: `${kind} ${date}`, state: "neutral" };
  const end = new Date(`${date}T00:00:00Z`).getTime();
  const start = new Date(`${today}T00:00:00Z`).getTime();
  const days = Math.round((end - start) / 86400000);
  const prefix = kind === "预计" ? "预计" : "";
  if (days < 0)
    return { text: `${prefix}逾期 ${Math.abs(days)} 天`, state: "overdue" };
  if (days === 0)
    return { text: kind === "截止" ? "今天截止" : "预计今天", state: "today" };
  if (days === 1) return { text: `${prefix}还剩 1 天`, state: "soon" };
  return { text: `${prefix}还剩 ${days} 天`, state: "future" };
}

function currentTimeKey(date = new Date()) {
  return date.toLocaleTimeString("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fromIcalTime(time) {
  const date = time.toJSDate();
  return {
    date: dateKey(date),
    time: time.isDate
      ? ""
      : date.toLocaleTimeString("zh-CN", {
          timeZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
  };
}

function parseIcs(text) {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const result = [];
  const [year, month, day] = dateKey(new Date()).split("-").map(Number);
  const until = new Date(year + 2, month - 1, day);
  const earliest = new Date(year - 1, month - 1, day);
  for (const component of calendar.getAllSubcomponents("vevent")) {
    const event = new ICAL.Event(component);
    if (!event.summary || event.isRecurrenceException()) continue;
    const occurrences = [];
    if (event.isRecurring()) {
      const iterator = event.iterator();
      let next;
      let count = 0;
      while ((next = iterator.next()) && count++ < 3000) {
        if (next.toJSDate() > until) break;
        if (next.toJSDate() >= earliest)
          occurrences.push(event.getOccurrenceDetails(next));
      }
    } else {
      occurrences.push({ startDate: event.startDate, endDate: event.endDate });
    }
    for (const occurrence of occurrences) {
      const start = fromIcalTime(occurrence.startDate);
      const end = fromIcalTime(occurrence.endDate);
      result.push({
        id: crypto.randomUUID(),
        title: event.summary.trim(),
        date: start.date,
        time: start.time,
        endTime: end.time,
        source: "ics",
        sourceId: `${event.uid || event.summary}:${occurrence.startDate.toString()}`,
      });
    }
  }
  return result;
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  className = "",
  disabled = false,
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} strokeWidth={1.8} />
    </button>
  );
}

function EmptyState({ icon: Icon, title, detail, action, onAction }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={22} strokeWidth={1.7} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action && (
        <button className="text-action" onClick={onAction}>
          {action}
          <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

function ContributionHeatmap({
  tasks,
  today,
  selectedDate,
  onSelectDate,
  title = "完成记录",
  ariaLabel = "任务完成热力图",
  variant = "tasks",
}) {
  const scrollRef = useRef(null);
  useEffect(() => {
    const showRecent = () => {
      if (scrollRef.current)
        scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    };
    showRecent();
    window.addEventListener("resize", showRecent);
    return () => window.removeEventListener("resize", showRecent);
  }, []);
  const { weeks, total, months } = useMemo(() => {
    const counts = new Map();
    for (const task of tasks) {
      if (
        !task.completed ||
        !/^\d{4}-\d{2}-\d{2}$/.test(task.completedAt || "")
      )
        continue;
      counts.set(task.completedAt, (counts.get(task.completedAt) || 0) + 1);
    }
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(
      start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - 52 * 7,
    );
    const weeks = Array.from({ length: 53 }, (_, weekIndex) =>
      Array.from({ length: 7 }, (_, dayIndex) => {
        const date = new Date(start);
        date.setUTCDate(start.getUTCDate() + weekIndex * 7 + dayIndex);
        const key = date.toISOString().slice(0, 10);
        return { key, count: counts.get(key) || 0, future: key > today };
      }),
    );
    const months = weeks.flatMap((week, index) => {
      const month = week[0].key.slice(0, 7);
      if (index && month === weeks[index - 1][0].key.slice(0, 7)) return [];
      return [{ index, label: `${Number(month.slice(5))}月` }];
    });
    return {
      weeks,
      months,
      total: weeks
        .flat()
        .reduce((sum, day) => sum + (day.future ? 0 : day.count), 0),
    };
  }, [tasks, today]);

  return (
    <section
      className={`contribution-section contribution-${variant}`}
      aria-label={ariaLabel}
    >
      <div className="contribution-head">
        <div>
          <h2>{title}</h2>
          <span>过去一年完成 {total} 项</span>
          <CircleHelp
            size={14}
            aria-label="旧版已完成任务没有完成日期，不计入热力图"
            title="旧版已完成任务没有完成日期，不计入热力图"
          />
        </div>
        {selectedDate && (
          <button
            type="button"
            className="text-action"
            onClick={() => onSelectDate("")}
          >
            清除日期筛选 <X size={13} />
          </button>
        )}
      </div>
      <div className="contribution-scroll" ref={scrollRef}>
        <div className="contribution-content">
          <div className="contribution-months">
            {months.map(({ index, label }) => (
              <span key={index} style={{ gridColumn: index + 1 }}>
                {label}
              </span>
            ))}
          </div>
          <div className="contribution-chart">
            <div className="contribution-weekdays" aria-hidden="true">
              <span>一</span>
              <span>三</span>
              <span>五</span>
            </div>
            <div className="contribution-grid">
              {weeks
                .flat()
                .map((day) =>
                  day.future ? (
                    <span key={day.key} className="contribution-day future" />
                  ) : (
                    <button
                      key={day.key}
                      type="button"
                      className={`contribution-day level-${Math.min(day.count, 4)} ${selectedDate === day.key ? "selected" : ""}`}
                      aria-label={`${day.key} 完成 ${day.count} 项任务`}
                      title={`${day.key} · 完成 ${day.count} 项任务`}
                      aria-pressed={selectedDate === day.key}
                      onClick={() => onSelectDate(day.key)}
                    />
                  ),
                )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function EditDialog({ type, item, projects, selectedDate, onClose, onSave, onNotice }) {
  const defaults =
    type === "task"
      ? {
          title: "",
          date: dateKey(new Date()),
          deadline: "",
          expectedAt: "",
          details: "",
          note: "",
          projectId: "",
          completed: false,
        }
      : type === "project"
        ? { name: "", description: "", folderPath: "", status: "planned" }
        : {
            title: "",
            date: selectedDate,
            time: "",
            endTime: "",
            color: "blue",
            source: "manual",
          };
  const [form, setForm] = useState({ ...defaults, ...item });
  const [error, setError] = useState("");
  const desktop = window.daymarkDesktop;
  const label =
    type === "task" && item?.projectId
      ? "子任务"
      : { task: "任务", project: "项目", event: "日程" }[type];
  const update = (key, value) =>
    setForm((current) => ({ ...current, [key]: value }));

  function submit(event) {
    event.preventDefault();
    const title = type === "project" ? form.name?.trim() : form.title?.trim();
    if (!title) return setError(`请输入${label}名称`);
    onSave({
      ...form,
      [type === "project" ? "name" : "title"]: title,
      id: item?.id || crypto.randomUUID(),
    });
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <form className="dialog" onSubmit={submit}>
        <div className="dialog-heading">
          <div>
            <span>
              {item ? "编辑" : "新建"}
              {label}
            </span>
            <h2>{item ? `编辑${label}` : `添加${label}`}</h2>
          </div>
          <IconButton icon={X} label="关闭" onClick={onClose} />
        </div>
        <div className="form-body">
          <label className="field">
            <span>{type === "project" ? "项目名称" : "标题"}</span>
            <input
              autoFocus
              value={type === "project" ? form.name : form.title}
              onChange={(event) =>
                update(
                  type === "project" ? "name" : "title",
                  event.target.value,
                )
              }
              placeholder={
                type === "task"
                  ? "例如：完成本周阅读"
                  : type === "event"
                    ? "例如：高等数学"
                    : "例如：毕业设计"
              }
            />
          </label>
          {type === "event" && (
            <label className="field">
              <span>日期</span>
              <input
                type="date"
                value={form.date || ""}
                onChange={(event) => update("date", event.target.value)}
                required
              />
            </label>
          )}
          {type === "task" && (
            <>
              <label className="field">
                <span>预计完成时间</span>
                <input
                  type="datetime-local"
                  value={form.expectedAt || ""}
                  onChange={(event) => update("expectedAt", event.target.value)}
                />
              </label>
              <label className="field">
                <span>截止日期</span>
                <input
                  type="date"
                  value={form.deadline || ""}
                  onChange={(event) => update("deadline", event.target.value)}
                />
              </label>
              {form.projectId && (
                <div className="field field-static">
                  <span>所属项目</span>
                  <strong>
                    {projects.find((project) => project.id === form.projectId)
                      ?.name || "项目子任务"}
                  </strong>
                </div>
              )}
              <label className="field">
                <span>备注</span>
                <textarea
                  rows="3"
                  value={form.details || ""}
                  onChange={(event) => update("details", event.target.value)}
                  placeholder="添加一些细节（可选）"
                />
              </label>
              <label className="field">
                <span>任务笔记与收获</span>
                <textarea
                  rows="4"
                  value={form.note || ""}
                  onChange={(event) => update("note", event.target.value)}
                  placeholder="记录完成过程、心得或结果（可稍后补充）"
                />
              </label>
            </>
          )}
          {type === "project" && (
            <>
              <label className="field">
                <span>项目状态</span>
                <select
                  value={normalizeProjectStatus(form.status)}
                  onChange={(event) => update("status", event.target.value)}
                >
                  {projectStatuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.label}
                    </option>
                  ))}
                </select>
              </label>
              {desktop && (
                <div className="field">
                  <span>项目文件夹</span>
                  <div className="folder-picker-row">
                    <span className="folder-path" title={form.folderPath || "尚未关联文件夹"}>
                      {form.folderPath || "尚未关联文件夹"}
                    </span>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={async () => {
                        try {
                          const folderPath = await desktop.chooseFolder();
                          if (folderPath) update("folderPath", folderPath);
                        } catch {
                          onNotice("无法打开文件夹选择窗口");
                        }
                      }}
                    >
                      <Folder size={15} />
                      {form.folderPath ? "更换" : "选择文件夹"}
                    </button>
                    {form.folderPath && (
                      <IconButton
                        icon={X}
                        label="清除文件夹"
                        onClick={() => update("folderPath", "")}
                      />
                    )}
                  </div>
                </div>
              )}
              <label className="field">
                <span>简介</span>
                <textarea
                  rows="4"
                  value={form.description || ""}
                  onChange={(event) =>
                    update("description", event.target.value)
                  }
                  placeholder="这个项目想完成什么？"
                />
              </label>
            </>
          )}
          {type === "event" && (
            <>
              <div className="field-row">
                <label className="field">
                  <span>开始时间</span>
                  <input
                    type="time"
                    value={form.time || ""}
                    onChange={(event) => update("time", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>结束时间</span>
                  <input
                    type="time"
                    value={form.endTime || ""}
                    onChange={(event) => update("endTime", event.target.value)}
                  />
                </label>
              </div>
              {form.source !== "ics" && (
                <div className="field">
                  <span id="event-color-label">日程颜色</span>
                  <div className="event-color-options" role="group" aria-labelledby="event-color-label">
                    {eventColors.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={`event-color-option ${(form.color || "blue") === option.id ? "selected" : ""}`}
                        style={{ backgroundColor: option.accent }}
                        title={option.label}
                        aria-label={option.label}
                        aria-pressed={(form.color || "blue") === option.id}
                        onClick={() => update("color", option.id)}
                      >
                        {(form.color || "blue") === option.id && <Check size={16} strokeWidth={2.5} />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="button primary">
            保存{label}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function App() {
  const [currentDay, setCurrentDay] = useState(dateKey(new Date()));
  const [nowTime, setNowTime] = useState(currentTimeKey());
  const [currentYear, currentMonth] = currentDay.split("-").map(Number);
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [view, setView] = useState("calendar");
  const [selectedDate, setSelectedDate] = useState(currentDay);
  const [month, setMonth] = useState(
    new Date(currentYear, currentMonth - 1, 1),
  );
  const [dialog, setDialog] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [taskFilter, setTaskFilter] = useState("open");
  const [completionDateFilter, setCompletionDateFilter] = useState("");
  const [projectCompletionDateFilter, setProjectCompletionDateFilter] =
    useState("");
  const [draggedProjectId, setDraggedProjectId] = useState("");
  const [projectDropTarget, setProjectDropTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const icsRef = useRef(null);
  const backupRef = useRef(null);
  const saveQueue = useRef(Promise.resolve());
  const monthTransition = useRef(null);

  useEffect(() => {
    let timer;
    const tick = () => {
      const now = new Date();
      setCurrentDay(dateKey(now));
      setNowTime(currentTimeKey(now));
      timer = window.setTimeout(
        tick,
        60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 50,
      );
    };
    tick();
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    fetch("/api/data")
      .then((response) => {
        if (!response.ok) throw new Error("无法读取本地数据");
        return response.json();
      })
      .then((value) => {
        setData({
          ...emptyData,
          ...value,
          quickNote: typeof value.quickNote === "string" ? value.quickNote : "",
          tasks: (value.tasks || []).map((task) => ({
            ...task,
            projectId: task.projectId || "",
          })),
          projects: (value.projects || []).map((project) => ({
            ...project,
            status: normalizeProjectStatus(project.status),
          })),
        });
        setLoaded(true);
      })
      .catch((error) => setLoadError(error.message));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    setSaveState("saving");
    const snapshot = JSON.stringify(data);
    saveQueue.current = saveQueue.current
      .catch(() => {})
      .then(async () => {
        const response = await fetch("/api/data", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: snapshot,
        });
        if (!response.ok) throw new Error("保存失败");
      });
    saveQueue.current
      .then(() => setSaveState("saved"))
      .catch(() => setSaveState("error"));
  }, [data, loaded]);

  const days = useMemo(() => monthDays(month), [month]);
  const personalTasks = data.tasks.filter((task) => !task.projectId);
  const projectTasks = data.tasks.filter((task) => task.projectId);
  const sidebarProjects = data.projects.filter(
    (project) => normalizeProjectStatus(project.status) !== "done",
  );
  const dayTasks = personalTasks
    .filter((task) => taskCalendarDate(task) === selectedDate)
    .sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
  const dayEvents = data.events
    .filter((event) => event.date === selectedDate)
    .sort(byStartTime);
  const openTasks = personalTasks.filter((task) => !task.completed);
  const monthEvents = data.events.filter((event) =>
    event.date.startsWith(civilDateKey(month).slice(0, 7)),
  ).length;
  const taskRows = personalTasks
    .filter((task) => {
      if (taskFilter === "open" && task.completed) return false;
      if (taskFilter === "done" && !task.completed) return false;
      if (completionDateFilter && task.completedAt !== completionDateFilter)
        return false;
      return `${task.title} ${task.details || ""} ${task.note || ""}`
        .toLowerCase()
        .includes(query.toLowerCase());
    })
    .sort((a, b) => {
      return (
        (a.expectedAt || "9999").localeCompare(b.expectedAt || "9999") ||
        (a.deadline || "9999").localeCompare(b.deadline || "9999") ||
        (a.date || "9999").localeCompare(b.date || "9999")
      );
    });
  const taskGroups = taskRows.reduce((groups, task) => {
    const expectedDate = task.expectedAt?.slice(0, 10) || "";
    const group = groups.find((item) => item.expectedDate === expectedDate);
    if (group) group.tasks.push(task);
    else groups.push({ expectedDate, tasks: [task] });
    return groups;
  }, []);
  function saveQuickNote(text) {
    setData((current) => ({ ...current, quickNote: text }));
  }

  function changeView(nextView) {
    if (nextView === view) return;
    const update = () => setView(nextView);
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      update();
      return;
    }
    document.startViewTransition(() => flushSync(update));
  }

  function showNotice(message) {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3600);
  }

  async function openProjectLocation(project, action) {
    try {
      const message = await window.daymarkDesktop?.[action](project.folderPath);
      if (message) showNotice(message);
    } catch {
      showNotice("无法打开项目文件夹");
    }
  }

  function saveItem(type, item) {
    const key = `${type}s`;
    const savedItem =
      type === "project"
        ? { ...item, status: normalizeProjectStatus(item.status) }
        : item;
    setData((current) => ({
      ...current,
      [key]: current[key].some((existing) => existing.id === item.id)
        ? current[key].map((existing) =>
            existing.id === item.id ? savedItem : existing,
          )
        : [...current[key], savedItem],
    }));
    setDialog(null);
    showNotice("已保存");
  }

  function moveProject(id, direction) {
    setData((current) => {
      const visibleProjects = current.projects.filter(
        (project) => normalizeProjectStatus(project.status) !== "done",
      );
      const visibleIndex = visibleProjects.findIndex((project) => project.id === id);
      const neighbor = visibleProjects[visibleIndex + direction];
      if (visibleIndex < 0 || !neighbor) return current;
      const projects = [...current.projects];
      const index = projects.findIndex((project) => project.id === id);
      const nextIndex = projects.findIndex((project) => project.id === neighbor.id);
      [projects[index], projects[nextIndex]] = [projects[nextIndex], projects[index]];
      return { ...current, projects };
    });
  }

  function moveProjectTo(id, targetId, after) {
    if (id === targetId) return;
    setData((current) => {
      const projects = [...current.projects];
      const sourceIndex = projects.findIndex((project) => project.id === id);
      if (sourceIndex < 0 || !projects.some((project) => project.id === targetId))
        return current;
      const [project] = projects.splice(sourceIndex, 1);
      const targetIndex = projects.findIndex((item) => item.id === targetId);
      projects.splice(targetIndex + (after ? 1 : 0), 0, project);
      return { ...current, projects };
    });
  }

  function projectDropAfter(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY >= bounds.top + bounds.height / 2;
  }

  function deleteItem(type, id, customLabel) {
    if (
      !window.confirm(
        `确定删除这条${customLabel || { task: "任务", project: "项目", event: "日程" }[type]}吗？`,
      )
    )
      return;
    const key = `${type}s`;
    setData((current) => ({
      ...current,
      [key]: current[key].filter((item) => item.id !== id),
      ...(type === "project"
        ? { tasks: current.tasks.filter((task) => task.projectId !== id) }
        : {}),
    }));
    showNotice("已删除");
  }

  function toggleTask(id) {
    const completedAt = dateKey(new Date());
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((task) =>
        task.id === id
          ? {
              ...task,
              completed: !task.completed,
              completedAt: task.completed ? "" : completedAt,
            }
          : task,
      ),
    }));
  }

  function goToday() {
    changeMonth(new Date(currentYear, currentMonth - 1, 1), currentDay);
    changeView("calendar");
  }

  function changeMonth(nextMonth, selectedDay) {
    const currentIndex = month.getFullYear() * 12 + month.getMonth();
    const nextIndex = nextMonth.getFullYear() * 12 + nextMonth.getMonth();
    if (currentIndex === nextIndex) {
      if (selectedDay) setSelectedDate(selectedDay);
      return;
    }
    const preferredDay = Number(selectedDate.slice(-2));
    const lastDay = new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1,
      0,
    ).getDate();
    const nextSelectedDay =
      selectedDay ||
      civilDateKey(
        new Date(
          nextMonth.getFullYear(),
          nextMonth.getMonth(),
          Math.min(preferredDay, lastDay),
        ),
      );
    const update = () => {
      setMonth(nextMonth);
      setSelectedDate(nextSelectedDay);
    };
    if (
      !document.startViewTransition ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      update();
      return;
    }

    monthTransition.current?.skipTransition();
    document.documentElement.dataset.monthDirection =
      nextIndex > currentIndex ? "next" : "previous";
    const transition = document.startViewTransition(() => {
      flushSync(update);
    });
    monthTransition.current = transition;
    transition.finished.finally(() => {
      if (monthTransition.current === transition) {
        monthTransition.current = null;
        delete document.documentElement.dataset.monthDirection;
      }
    });
  }

  function shiftMonth(amount) {
    changeMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  }

  async function importIcs(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const imported = parseIcs(await file.text());
      const known = new Set(
        data.events.map((item) => item.sourceId).filter(Boolean),
      );
      const fresh = imported.filter((item) => !known.has(item.sourceId));
      setData((current) => ({
        ...current,
        events: [...current.events, ...fresh],
      }));
      showNotice(`已导入 ${fresh.length} 条日程；重复条目已跳过`);
    } catch (error) {
      showNotice(`导入失败：${error.message}`);
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `daymark-backup-${dateKey(new Date())}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSettingsOpen(false);
    showNotice("备份已下载");
  }

  async function importBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const next = JSON.parse(await file.text());
      if (
        next.version !== 1 ||
        !["tasks", "notes", "projects", "events"].every((key) =>
          Array.isArray(next[key]),
        )
      )
        throw new Error("备份格式不正确");
      if (!window.confirm("导入备份会覆盖当前全部记录，确定继续吗？")) return;
      setData({
        ...emptyData,
        ...next,
        quickNote: typeof next.quickNote === "string" ? next.quickNote : "",
        tasks: next.tasks.map((task) => ({
          ...task,
          projectId: task.projectId || "",
        })),
      });
      setSettingsOpen(false);
      showNotice("备份已恢复");
    } catch (error) {
      showNotice(`恢复失败：${error.message}`);
    }
  }

  function TaskRow({ task, compact = false }) {
    const project = data.projects.find((item) => item.id === task.projectId);
    const taskLabel = task.projectId ? "子任务" : "任务";
    const deadline = dateCountdown(
      task.deadline,
      currentDay,
      task.completed,
      "截止",
    );
    const expected = dateCountdown(
      task.expectedAt?.slice(0, 10),
      currentDay,
      task.completed,
      "预计",
    );
    return (
      <div
        className={`task-row ${task.completed ? "is-done" : ""} ${compact ? "compact" : ""}`}
      >
        <button
          className="task-check"
          aria-label={task.completed ? "标记为未完成" : "标记为完成"}
          onClick={() => toggleTask(task.id)}
        >
          {task.completed && <Check size={13} strokeWidth={2.7} />}
        </button>
        <div className="task-content">
          <strong>{task.title}</strong>
          <div className="row-meta">
            {deadline && (
              <span className={`deadline-badge ${deadline.state}`}>
                {deadline.text}
              </span>
            )}
            {expected && (
              <span className={`expected-badge ${expected.state}`}>
                {expected.text}
                {task.expectedAt?.slice(11) && ` ${task.expectedAt.slice(11)}`}
              </span>
            )}
            {!compact && project && (
              <span className="project-tag">{project.name}</span>
            )}
            {!compact && task.details && (
              <span className="muted-ellipsis">{task.details}</span>
            )}
          </div>
          {!compact && task.note && (
            <button
              className="task-note-preview"
              onClick={() => setDialog({ type: "task", item: task })}
              title="打开任务笔记"
            >
              <NotebookPen size={12} />
              <span>{task.note}</span>
            </button>
          )}
        </div>
        <div className="row-actions">
          <IconButton
            icon={NotebookPen}
            label={task.note ? "编辑任务笔记" : "添加任务笔记"}
            onClick={() => setDialog({ type: "task", item: task })}
          />
          <IconButton
            icon={Pencil}
            label={`编辑${taskLabel}`}
            onClick={() => setDialog({ type: "task", item: task })}
          />
          <IconButton
            icon={Trash2}
            label={`删除${taskLabel}`}
            onClick={() => deleteItem("task", task.id, taskLabel)}
          />
        </div>
      </div>
    );
  }

  if (loadError)
    return (
      <main className="load-screen">
        <EmptyState
          icon={CircleHelp}
          title="无法打开本地数据"
          detail={loadError}
          action="重新加载"
          onAction={() => window.location.reload()}
        />
      </main>
    );
  if (!loaded)
    return (
      <main className="load-screen">
        <div className="loading-line" />
        <p>正在打开你的工作台...</p>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <span />
          </span>
          <div>
            <strong>Daymark</strong>
            <small>个人工作台</small>
          </div>
        </div>
        <nav className="main-nav" aria-label="主导航">
          {[
            { id: "calendar", label: "日历", icon: CalendarDays },
            { id: "tasks", label: "任务", icon: ClipboardList },
            { id: "projects", label: "项目", icon: FolderKanban },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${view === id ? "active" : ""}`}
              aria-label={label}
              onClick={() => {
                changeView(id);
                setQuery("");
              }}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{label}</span>
              {id === "tasks" && openTasks.length > 0 && (
                <em>{openTasks.length}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <div className="section-mini-head">
            <span>我的项目</span>
            <IconButton
              icon={Plus}
              label="新建项目"
              onClick={() => setDialog({ type: "project" })}
            />
          </div>
          {sidebarProjects.length ? (
            <div className="sidebar-project-list">
              {sidebarProjects.map((project, index) => (
                <div
                  className={`project-list-row ${draggedProjectId === project.id ? "dragging" : ""} ${projectDropTarget?.id === project.id ? (projectDropTarget.after ? "drop-after" : "drop-before") : ""}`}
                  key={project.id}
                  onDragOver={(event) => {
                    if (!draggedProjectId || draggedProjectId === project.id) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const after = projectDropAfter(event);
                    setProjectDropTarget((current) =>
                      current?.id === project.id && current.after === after
                        ? current
                        : { id: project.id, after },
                    );
                  }}
                  onDrop={(event) => {
                    if (!draggedProjectId) return;
                    event.preventDefault();
                    moveProjectTo(draggedProjectId, project.id, projectDropAfter(event));
                    setDraggedProjectId("");
                    setProjectDropTarget(null);
                  }}
                >
                  <button
                    className="project-link"
                    onClick={() => changeView("projects")}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", project.id);
                      setDraggedProjectId(project.id);
                    }}
                    onDragEnd={() => {
                      setDraggedProjectId("");
                      setProjectDropTarget(null);
                    }}
                    title={`${project.name} · ${projectStatuses.find((status) => status.id === normalizeProjectStatus(project.status))?.label} · 拖动排序`}
                  >
                    <span className={`project-dot ${normalizeProjectStatus(project.status)}`} />
                    <span className="project-link-name">{project.name}</span>
                  </button>
                  <div className="project-move-actions">
                    <IconButton
                      icon={ChevronUp}
                      label={`上移 ${project.name}`}
                      onClick={() => moveProject(project.id, -1)}
                      disabled={index === 0}
                    />
                    <IconButton
                      icon={ChevronDown}
                      label={`下移 ${project.name}`}
                      onClick={() => moveProject(project.id, 1)}
                      disabled={index === sidebarProjects.length - 1}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="sidebar-hint">暂无待关注项目</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <div className="save-status">
            <span className={`status-dot ${saveState}`} />
            {saveState === "saved"
              ? "已保存到本机"
              : saveState === "saving"
                ? "正在保存"
                : "保存失败，请检查服务"}
          </div>
          <button
            className="settings-button"
            onClick={() => setSettingsOpen((current) => !current)}
          >
            <Settings2 size={17} />
            数据与导入
            <ChevronDown size={15} />
          </button>
          {settingsOpen && (
            <div className="settings-menu">
              <button onClick={() => icsRef.current?.click()}>
                <FileUp size={16} />
                导入 .ics 日历
              </button>
              <button onClick={exportBackup}>
                <Download size={16} />
                导出数据备份
              </button>
              <button onClick={() => backupRef.current?.click()}>
                <FileUp size={16} />
                恢复数据备份
              </button>
              <p>记录保存在本机 data 文件夹。建议定期导出备份。</p>
            </div>
          )}
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            个人空间 <ChevronRight size={15} />{" "}
            <strong>
              {
                {
                  calendar: "日历",
                  tasks: "任务",
                  projects: "项目",
                }[view]
              }
            </strong>
          </div>
          <div className="top-actions">
            <span className="today-date">
              {new Date().toLocaleDateString("zh-CN", {
                timeZone,
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
            <div className="mobile-settings">
              <IconButton
                icon={Settings2}
                label="数据与导入"
                onClick={() => setSettingsOpen((current) => !current)}
              />
              {settingsOpen && (
                <div className="settings-menu">
                  <button onClick={() => icsRef.current?.click()}>
                    <FileUp size={16} />
                    导入 .ics 日历
                  </button>
                  <button onClick={exportBackup}>
                    <Download size={16} />
                    导出数据备份
                  </button>
                  <button onClick={() => backupRef.current?.click()}>
                    <FileUp size={16} />
                    恢复数据备份
                  </button>
                </div>
              )}
            </div>
            <button
              className="button primary new-button"
              onClick={() =>
                setDialog({
                  type:
                    view === "projects" ? "project" : "task",
                })
              }
            >
              <Plus size={17} />
              {view === "projects" ? "新建项目" : "新建任务"}
            </button>
          </div>
        </header>
        <main className="main-content">
          {view === "calendar" && (
            <>
              <div className="page-head calendar-head">
                <div>
                  <p className="eyebrow">YOUR TIME</p>
                  <h1 className="month-heading">{monthLabel(month)}</h1>
                </div>
                <div className="calendar-controls">
                  <button className="button secondary" onClick={goToday}>
                    今天
                  </button>
                  <label
                    className="icon-button month-picker-trigger"
                    title="跳转到月份"
                  >
                    <CalendarDays size={18} strokeWidth={1.8} />
                    <input
                      type="month"
                      aria-label="跳转到月份"
                      value={civilDateKey(month).slice(0, 7)}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        const [year, monthNumber] = event.target.value
                          .split("-")
                          .map(Number);
                        changeMonth(new Date(year, monthNumber - 1, 1));
                      }}
                    />
                  </label>
                  <IconButton
                    icon={ChevronLeft}
                    label="上个月"
                    onClick={() => shiftMonth(-1)}
                  />
                  <IconButton
                    icon={ChevronRight}
                    label="下个月"
                    onClick={() => shiftMonth(1)}
                  />
                </div>
              </div>
              <div className="calendar-layout">
                <section className="calendar-panel" aria-label="月历">
                  <div className="weekday-row">
                    {weekdays.map((day) => (
                      <span key={day}>周{day}</span>
                    ))}
                  </div>
                  <div className="month-grid">
                    {days.map((day) => {
                      const tasks = personalTasks.filter(
                        (task) => taskCalendarDate(task) === day.key,
                      ).sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
                      const events = data.events
                        .filter((event) => event.date === day.key)
                        .sort(byStartTime);
                      const nextEventIndex = events.findIndex(
                        (event) => event.time && event.time >= nowTime,
                      );
                      return (
                        <button
                          key={day.key}
                          className={`day-cell ${day.inMonth ? "" : "outside"} ${day.key === selectedDate ? "selected" : ""} ${day.key === currentDay ? "today" : ""}`}
                          aria-label={`${day.key}，${events.length} 条日程，${tasks.length} 项任务`}
                          onClick={() => {
                            if (!day.inMonth) {
                              changeMonth(
                                new Date(`${day.key}T12:00:00`),
                                day.key,
                              );
                            } else {
                              setSelectedDate(day.key);
                            }
                          }}
                        >
                          <span className="day-number">{day.number}</span>
                          <span className="day-items">
                            <span className="day-item-column">
                              <span className="day-item-label">日程</span>
                              {events.map((item, index) => (
                                <React.Fragment key={item.id}>
                                  {day.key === currentDay &&
                                    nextEventIndex === index && (
                                      <span
                                        className="calendar-now-marker"
                                        title={`当前时间 ${nowTime}`}
                                      >
                                        <time>{nowTime}</time>
                                      </span>
                                    )}
                                  <span
                                    className="calendar-event"
                                    style={eventColorStyle(item)}
                                    title={`${item.time ? `${item.time} ` : ""}${item.title}`}
                                  >
                                    {item.time && <b>{item.time}</b>}{" "}
                                    {item.title}
                                  </span>
                                </React.Fragment>
                              ))}
                              {day.key === currentDay &&
                                nextEventIndex === -1 && (
                                  <span
                                    className="calendar-now-marker"
                                    title={`当前时间 ${nowTime}`}
                                  >
                                    <time>{nowTime}</time>
                                  </span>
                                )}
                            </span>
                            <span className="day-item-column">
                              <span className="day-item-label">任务</span>
                              {tasks.map((item) => (
                                <span
                                  className={`calendar-task ${item.completed ? "done" : ""}`}
                                  key={item.id}
                                  title={item.title}
                                >
                                  <i />
                                  {item.title}
                                </span>
                              ))}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <aside className="day-panel">
                  <div className="day-panel-head">
                    <div>
                      <span className="day-kicker">所选日期</span>
                      <h2>{dayLabel(selectedDate)}</h2>
                    </div>
                    <button
                      className="day-add"
                      onClick={() => setDialog({ type: "event" })}
                      title="添加日程"
                      aria-label="添加日程"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <section className="day-section">
                    <div className="day-section-head">
                      <h3>日程</h3>
                      <span>{dayEvents.length}</span>
                    </div>
                    {dayEvents.length ? (
                      <div className="event-list">
                        {dayEvents.map((event, index) => {
                          const nowIndex = dayEvents.findIndex(
                            (item) => item.time && item.time >= nowTime,
                          );
                          return (
                            <React.Fragment key={event.id}>
                              {selectedDate === currentDay &&
                                nowIndex === index && (
                                  <div className="now-marker">
                                    <span>{nowTime}</span>
                                  </div>
                                )}
                              <div className="event-row" style={eventColorStyle(event)}>
                                <time>{event.time || "全天"}</time>
                                <div>
                                  <strong>{event.title}</strong>
                                  {event.endTime && (
                                    <small>至 {event.endTime}</small>
                                  )}
                                </div>
                                <div className="row-actions">
                                  <IconButton
                                    icon={Pencil}
                                    label="编辑日程"
                                    onClick={() =>
                                      setDialog({ type: "event", item: event })
                                    }
                                  />
                                  <IconButton
                                    icon={Trash2}
                                    label="删除日程"
                                    onClick={() =>
                                      deleteItem("event", event.id)
                                    }
                                  />
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })}
                        {selectedDate === currentDay &&
                          !dayEvents.some(
                            (event) => event.time && event.time >= nowTime,
                          ) && (
                            <div className="now-marker">
                              <span>{nowTime}</span>
                            </div>
                          )}
                      </div>
                    ) : (
                      <>
                        {selectedDate === currentDay && (
                          <div className="now-marker">
                            <span>{nowTime}</span>
                          </div>
                        )}
                        <p className="day-empty">今天还没有日程</p>
                      </>
                    )}
                  </section>
                  <section className="day-section">
                    <div className="day-section-head">
                      <h3>待办</h3>
                      <span>{dayTasks.length}</span>
                    </div>
                    {dayTasks.length ? (
                      dayTasks.map((task) => (
                        <TaskRow key={task.id} task={task} compact />
                      ))
                    ) : (
                      <p className="day-empty">今天还没有任务</p>
                    )}
                    <button
                      className="inline-add"
                      onClick={() => setDialog({ type: "task" })}
                    >
                      <Plus size={15} />
                      添加任务
                    </button>
                  </section>
                  <section className="day-section quick-note-section">
                    <div className="day-section-head">
                      <h3>随手记</h3>
                      {data.quickNote && (
                        <IconButton
                          icon={Trash2}
                          label="删除随手记"
                          onClick={() => saveQuickNote("")}
                        />
                      )}
                    </div>
                    <textarea
                      className="quick-note-input"
                      value={data.quickNote}
                      onChange={(event) => saveQuickNote(event.target.value)}
                      placeholder="写点什么..."
                      aria-label="随手记"
                      rows={5}
                    />
                  </section>
                </aside>
              </div>
              <div className="calendar-footer">
                <span>
                  <i className="legend-dot event" />
                  日程 <i className="legend-dot task" />
                  任务
                </span>
                <span>
                  本月 {monthEvents} 条日程 · {openTasks.length} 项待完成
                </span>
              </div>
            </>
          )}

          {view === "tasks" && (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow">GET THINGS DONE</p>
                  <h1>任务清单</h1>
                  <p className="page-subtitle">
                    这里只显示我的任务；项目子任务在项目中单独管理。
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setDialog({ type: "task" })}
                >
                  <Plus size={17} />
                  添加任务
                </button>
              </div>
              <ContributionHeatmap
                tasks={personalTasks}
                today={currentDay}
                title="我的任务完成记录"
                ariaLabel="我的任务完成热力图"
                selectedDate={completionDateFilter}
                onSelectDate={(date) => {
                  setCompletionDateFilter(date);
                  if (date) setTaskFilter("done");
                }}
              />
              <div className="list-toolbar">
                <div className="segmented">
                  {[
                    ["open", "待完成"],
                    ["all", "全部"],
                    ["done", "已完成"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={taskFilter === id ? "active" : ""}
                      onClick={() => setTaskFilter(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="toolbar-right">
                  <label className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="搜索任务"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="搜索任务"
                    />
                  </label>
                </div>
              </div>
              <div className="list-surface">
                {taskRows.length ? (
                  taskGroups.map((group) => (
                    <section className="task-group" key={group.expectedDate}>
                      <header className="task-group-head">
                        <div>
                          <h2>
                            {group.expectedDate
                              ? `预计 ${group.expectedDate} 完成`
                              : "未设预计完成时间"}
                          </h2>
                          <span>{group.tasks.length} 项</span>
                        </div>
                        {group.expectedDate && (
                          <span
                            className={`expected-badge ${
                              dateCountdown(
                                group.expectedDate,
                                currentDay,
                                group.tasks.every((task) => task.completed),
                                "预计",
                              ).state
                            }`}
                          >
                            {
                              dateCountdown(
                                group.expectedDate,
                                currentDay,
                                group.tasks.every((task) => task.completed),
                                "预计",
                              ).text
                            }
                          </span>
                        )}
                      </header>
                      {group.tasks.map((task) => (
                        <TaskRow key={task.id} task={task} />
                      ))}
                    </section>
                  ))
                ) : (
                  <EmptyState
                    icon={ClipboardList}
                    title={
                      personalTasks.length
                        ? "没有符合条件的任务"
                        : "从第一项任务开始"
                    }
                    detail={
                      completionDateFilter
                        ? `${completionDateFilter} 没有符合当前筛选条件的已完成任务。`
                        : personalTasks.length
                          ? "试试切换筛选条件或搜索词。"
                          : "把一件要做的事写下来，日程就有了起点。"
                    }
                    action={personalTasks.length ? null : "添加任务"}
                    onAction={() => setDialog({ type: "task" })}
                  />
                )}
              </div>
            </>
          )}


          {view === "projects" && (
            <>
              <div className="page-head">
                <div>
                  <p className="eyebrow">YOUR PROJECTS</p>
                  <h1>项目</h1>
                  <p className="page-subtitle">
                    项目和子任务在这里单独管理。
                  </p>
                </div>
                <button
                  className="button secondary"
                  onClick={() => setDialog({ type: "project" })}
                >
                  <Plus size={17} />
                  新建项目
                </button>
              </div>
              <ContributionHeatmap
                tasks={projectTasks}
                today={currentDay}
                title="子任务完成记录"
                ariaLabel="项目子任务完成热力图"
                variant="projects"
                selectedDate={projectCompletionDateFilter}
                onSelectDate={setProjectCompletionDateFilter}
              />
              {data.projects.length ? (
                <div className="project-board">
                  {projectStatuses.map((status) => {
                    const statusProjects = data.projects.filter(
                      (project) => normalizeProjectStatus(project.status) === status.id,
                    );
                    return (
                      <section className="project-column" key={status.id}>
                        <div className="project-column-head">
                          <h2>{status.label}</h2>
                          <span>{statusProjects.length}</span>
                        </div>
                        <div className="project-column-body">
                          {statusProjects.length ? statusProjects.map((project) => {
                            const tasks = data.tasks.filter(
                              (task) => task.projectId === project.id,
                            );
                            return (
                              <article
                                className="project-card"
                                key={project.id}
                              >
                                <div className="project-card-top">
                                  <span className="project-card-icon">
                                    <LayoutGrid size={18} />
                                  </span>
                                  <div className="project-card-actions">
                                    {window.daymarkDesktop && project.folderPath && (
                                      <>
                                        <IconButton
                                          icon={ExternalLink}
                                          label="打开项目文件夹"
                                          onClick={() => openProjectLocation(project, "openFolder")}
                                        />
                                        <IconButton
                                          icon={Code2}
                                          label="用 VS Code 打开"
                                          onClick={() => openProjectLocation(project, "openVscode")}
                                        />
                                      </>
                                    )}
                                    <IconButton
                                      icon={Pencil}
                                      label="编辑项目"
                                      onClick={() =>
                                        setDialog({
                                          type: "project",
                                          item: project,
                                        })
                                      }
                                    />
                                    <IconButton
                                      icon={Trash2}
                                      label="删除项目"
                                      onClick={() =>
                                        deleteItem("project", project.id)
                                      }
                                    />
                                  </div>
                                </div>
                                <button
                                  className="project-title"
                                  onClick={() => {
                                    changeView("projects");
                                  }}
                                >
                                  {project.name}
                                </button>
                                <p>{project.description || "还没有项目简介"}</p>
                                <div className="project-card-footer">
                                  <span>
                                    {tasks.length
                                      ? `${tasks.length} 项子任务`
                                      : "还没有子任务"}
                                  </span>
                                </div>
                                {tasks.length > 0 && (
                                  <div className="subtask-list" aria-label={`${project.name} 子任务`}>
                                    {tasks.map((task) => (
                                      <TaskRow key={task.id} task={task} compact />
                                    ))}
                                  </div>
                                )}
                                <button
                                  className="inline-add project-subtask-add"
                                  onClick={() => setDialog({ type: "task", item: { projectId: project.id, date: currentDay } })}
                                >
                                  <Plus size={15} /> 添加子任务
                                </button>
                              </article>
                            );
                          }) : (
                            <div className="project-column-empty">暂无项目</div>
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : (
                <div className="list-surface">
                  <EmptyState
                    icon={FolderKanban}
                    title="让想做的事成为项目"
                    detail="建立项目，再在项目下单独添加子任务。"
                    action="新建项目"
                    onAction={() => setDialog({ type: "project" })}
                  />
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <input
        ref={icsRef}
        type="file"
        accept=".ics,text/calendar"
        hidden
        onChange={importIcs}
      />
      <input
        ref={backupRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={importBackup}
      />
      {dialog && (
        <EditDialog
          type={dialog.type}
          item={dialog.item}
          projects={data.projects}
          selectedDate={selectedDate}
          onClose={() => setDialog(null)}
          onSave={(item) => saveItem(dialog.type, item)}
          onNotice={showNotice}
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}
